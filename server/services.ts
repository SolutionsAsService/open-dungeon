/**
 * Application services: every read and write goes through here, and every function takes the
 * acting user's id and checks campaign membership/role itself. HTTP routes and the realtime hub
 * are thin adapters over these functions, so both get identical authorization.
 */
import type { Db, Queryable } from './db/index';
import type { Storage } from './storage';
import { sniffImage } from './storage';
import { newId, randomToken, sha256 } from './ids';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { Role, can, canEditToken, isGmRole } from '../shared/permissions';
import { GridConfig, defaultGrid } from '../shared/grid';
import { isPointRevealed, type FogRegion } from '../shared/fog';
import { rollDice, DiceError } from '../shared/dice';
import { getRuleset } from '../shared/rules/registry';
import type { Command, TokenView, MapView, FogRegionView, DrawingView, ChatView, InitiativeView, SessionSnapshot, ServerEvent, Visibility } from '../shared/protocol';

export type Audience = { kind: 'all' } | { kind: 'gm' } | { kind: 'users'; ids: string[] } | { kind: 'gmAndUsers'; ids: string[] };
export type Effect =
  | { kind: 'event'; audience: Audience; event: ServerEvent }
  | { kind: 'tokens'; tokens: { token: TokenView; revealed: boolean }[]; removedIds: string[] }
  | { kind: 'initiative' };
export class CommandError extends Error {
  constructor(public code: 'invalid' | 'forbidden' | 'stale' | 'not_found' | 'closed', message: string, public current?: TokenView) { super(message); }
}

const SESSION_TTL_DAYS = 30;
const EVENT_RETENTION = 1000;

// ---------- row mappers ----------
const tokenView = (r: any): TokenView => ({
  id: r.id, mapId: r.map_id, name: r.name, category: r.category, assetId: r.asset_id, color: r.color,
  x: Number(r.x), y: Number(r.y), rotation: Number(r.rotation), size: Number(r.size), hidden: r.hidden, locked: r.locked,
  ownerIds: r.owner_ids ?? [], hp: r.hp, hpMax: r.hp_max, conditions: r.conditions ?? [], version: r.version,
});
const mapView = (r: any): MapView => ({ id: r.id, name: r.name, backgroundAssetId: r.background_asset_id, width: r.width, height: r.height, grid: GridConfig.parse(r.grid), fogEnabled: r.fog_enabled, version: r.version });
const fogView = (r: any): FogRegionView => ({ id: r.id, mode: r.mode, shape: r.shape });
const drawingView = (r: any): DrawingView => ({ id: r.id, authorId: r.author_id, gmOnly: r.gm_only, shape: r.shape, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null });
const chatView = (r: any): ChatView => ({
  id: r.id, userId: r.user_id, userName: r.user_name ?? 'System', kind: r.kind, body: r.body, visibility: r.visibility,
  createdAt: new Date(r.created_at).toISOString(),
  ...(r.roll_result ? { roll: { expression: r.roll_expression, total: r.roll_total, terms: r.roll_result.terms, label: r.roll_result.label } } : {}),
});

export function canSee(role: Role | null, userId: string, visibility: Visibility, authorId: string | null): boolean {
  if (visibility === 'public') return true;
  if (authorId === userId) return true;
  return visibility === 'gm' && isGmRole(role);
}

export class Services {
  constructor(public db: Db, public storage: Storage, public opts: { maxUploadBytes: number }) {}

  // ---------- identity ----------
  /** Development sign-in: creates a user for a display name and returns an opaque session token. */
  async devSignIn(displayName: string): Promise<{ user: { id: string; displayName: string }; token: string }> {
    const name = displayName.trim();
    if (name.length < 1 || name.length > 40) throw badRequest('Display name must be 1-40 characters');
    const id = newId('usr');
    await this.db.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [id, name]);
    const token = randomToken();
    await this.db.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)", [sha256(token), id, String(SESSION_TTL_DAYS)]);
    return { user: { id, displayName: name }, token };
  }
  async userForToken(token: string | undefined | null): Promise<{ id: string; displayName: string } | null> {
    if (!token || token.length > 200) return null;
    const rows = await this.db.query('SELECT u.id, u.display_name FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [sha256(token)]);
    return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
  }
  async signOut(token: string) { await this.db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [sha256(token)]); }

  // ---------- membership ----------
  async roleFor(userId: string, campaignId: string, q: Queryable = this.db): Promise<Role | null> {
    const r = await q.query('SELECT role FROM campaign_members WHERE campaign_id = $1 AND user_id = $2', [campaignId, userId]);
    return r[0] ? Role.parse(r[0].role) : null;
  }
  private async requireRole(userId: string, campaignId: string, q: Queryable = this.db): Promise<Role> {
    const role = await this.roleFor(userId, campaignId, q);
    if (!role) throw notFound('Campaign not found'); // don't reveal existence to non-members
    return role;
  }
  async sessionContext(userId: string, sessionId: string, q: Queryable = this.db) {
    const s = (await q.query('SELECT gs.*, c.name AS campaign_name, c.ruleset_id FROM game_sessions gs JOIN campaigns c ON c.id = gs.campaign_id WHERE gs.id = $1', [sessionId]))[0];
    if (!s) throw notFound('Session not found');
    const role = await this.roleFor(userId, s.campaign_id, q);
    if (!role) throw notFound('Session not found');
    return { session: s, role };
  }

  // ---------- campaigns ----------
  async listCampaigns(userId: string) {
    const rows = await this.db.query(
      'SELECT c.id, c.name, c.description, c.ruleset_id, m.role, c.updated_at, (SELECT count(*)::int FROM game_sessions s WHERE s.campaign_id = c.id) AS session_count FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = $1 ORDER BY c.updated_at DESC', [userId]);
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, rulesetId: r.ruleset_id, role: r.role, sessionCount: r.session_count, updatedAt: new Date(r.updated_at).toISOString() }));
  }
  async createCampaign(userId: string, input: { name: string; description?: string; rulesetId?: string }) {
    const id = newId('cmp');
    await this.db.tx(async (t) => {
      await t.query('INSERT INTO campaigns (id, name, description, ruleset_id, owner_id) VALUES ($1, $2, $3, $4, $5)', [id, input.name, input.description ?? '', input.rulesetId ?? 'generic', userId]);
      await t.query("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'owner')", [id, userId]);
    });
    return { id };
  }
  async getCampaign(userId: string, campaignId: string) {
    const role = await this.requireRole(userId, campaignId);
    const c = (await this.db.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]))[0];
    const members = await this.db.query('SELECT m.user_id, m.role, u.display_name FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = $1 ORDER BY m.joined_at', [campaignId]);
    const sessions = await this.db.query('SELECT id, name, status, updated_at FROM game_sessions WHERE campaign_id = $1 ORDER BY created_at DESC', [campaignId]);
    return {
      id: c.id, name: c.name, description: c.description, rulesetId: c.ruleset_id, role,
      members: members.map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role })),
      sessions: sessions.map((s) => ({ id: s.id, name: s.name, status: s.status, updatedAt: new Date(s.updated_at).toISOString() })),
    };
  }
  async setMemberRole(userId: string, campaignId: string, targetId: string, role: Role) {
    const mine = await this.requireRole(userId, campaignId);
    if (!can(mine, 'campaign.manage')) throw forbidden();
    if (role === 'owner' || targetId === userId) throw badRequest('Use ownership transfer to change the owner');
    const r = await this.db.query('UPDATE campaign_members SET role = $3 WHERE campaign_id = $1 AND user_id = $2 RETURNING user_id', [campaignId, targetId, role]);
    if (!r[0]) throw notFound('Member not found');
  }

  // ---------- invitations ----------
  async createInvite(userId: string, campaignId: string, input: { role: 'assistant_gm' | 'player' | 'spectator'; expiresInHours?: number | null; maxUses?: number | null }) {
    const role = await this.requireRole(userId, campaignId);
    if (!can(role, 'campaign.invite')) throw forbidden();
    const token = randomToken();
    const id = newId('inv');
    await this.db.query(
      "INSERT INTO invitations (id, campaign_id, token_hash, role, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int || ' hours')::interval END, $7)",
      [id, campaignId, sha256(token), input.role, userId, input.expiresInHours ?? null, input.maxUses ?? null]);
    return { id, token };
  }
  async previewInvite(token: string) {
    const r = (await this.db.query('SELECT i.*, c.name AS campaign_name FROM invitations i JOIN campaigns c ON c.id = i.campaign_id WHERE i.token_hash = $1', [sha256(token)]))[0];
    if (!r || r.revoked || (r.expires_at && new Date(r.expires_at) < new Date()) || (r.max_uses != null && r.uses >= r.max_uses)) throw notFound('This invitation is invalid or has expired');
    return { campaignId: r.campaign_id, campaignName: r.campaign_name, role: r.role };
  }
  async acceptInvite(userId: string, token: string) {
    return this.db.tx(async (t) => {
      const r = (await t.query('SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE', [sha256(token)]))[0];
      if (!r || r.revoked || (r.expires_at && new Date(r.expires_at) < new Date()) || (r.max_uses != null && r.uses >= r.max_uses)) throw notFound('This invitation is invalid or has expired');
      const existing = await this.roleFor(userId, r.campaign_id, t);
      if (!existing) {
        await t.query('INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, $3)', [r.campaign_id, userId, r.role]);
        await t.query('UPDATE invitations SET uses = uses + 1 WHERE id = $1', [r.id]);
      }
      return { campaignId: r.campaign_id as string };
    });
  }

  // ---------- sessions & maps ----------
  async createSession(userId: string, campaignId: string, input: { name: string }) {
    const role = await this.requireRole(userId, campaignId);
    if (!can(role, 'session.manage')) throw forbidden();
    const id = newId('ses');
    await this.db.tx(async (t) => {
      let mapId = (await t.query('SELECT active_map_id FROM game_sessions WHERE campaign_id = $1 AND active_map_id IS NOT NULL ORDER BY created_at DESC LIMIT 1', [campaignId]))[0]?.active_map_id;
      if (!mapId) {
        mapId = newId('map');
        const rs = getRuleset((await t.query('SELECT ruleset_id FROM campaigns WHERE id = $1', [campaignId]))[0].ruleset_id);
        const grid = GridConfig.parse({ ...defaultGrid(), unitsPerCell: rs.distance.unitsPerCell, unit: rs.distance.unit, diagonal: rs.distance.diagonal });
        await t.query('INSERT INTO maps (id, campaign_id, name, grid) VALUES ($1, $2, $3, $4::jsonb)', [mapId, campaignId, 'Untitled map', JSON.stringify(grid)]);
      }
      await t.query('INSERT INTO game_sessions (id, campaign_id, name, active_map_id) VALUES ($1, $2, $3, $4)', [id, campaignId, input.name, mapId]);
      await t.query('INSERT INTO encounters (id, session_id) VALUES ($1, $2)', [newId('enc'), id]);
      await t.query('UPDATE campaigns SET updated_at = now() WHERE id = $1', [campaignId]);
    });
    return { id };
  }
  async setSessionStatus(userId: string, sessionId: string, status: 'open' | 'paused' | 'closed') {
    const { session, role } = await this.sessionContext(userId, sessionId);
    if (!can(role, 'session.manage')) throw forbidden();
    await this.db.query('UPDATE game_sessions SET status = $2, updated_at = now() WHERE id = $1', [sessionId, status]);
    if (status === 'closed') {
      // temporary annotations end with the session
      await this.db.query('DELETE FROM drawings WHERE map_id = $1 AND expires_at IS NOT NULL', [session.active_map_id]);
    }
    return { status };
  }

  // ---------- assets ----------
  async uploadImage(userId: string, campaignId: string, data: Buffer, meta: { name?: string; kind?: string }) {
    const role = await this.requireRole(userId, campaignId);
    if (!can(role, 'map.edit') && !can(role, 'token.create')) throw forbidden();
    if (data.length === 0) throw badRequest('Empty upload');
    if (data.length > this.opts.maxUploadBytes) throw new HttpError(413, 'too_large', 'File is larger than the upload limit');
    const img = sniffImage(data);
    if (!img) throw new HttpError(415, 'unsupported', 'Only PNG, JPEG, WebP and GIF images are supported');
    const id = newId('ast');
    const key = id;
    await this.storage.put(key, data);
    await this.db.query('INSERT INTO assets (id, owner_id, campaign_id, kind, mime, bytes, width, height, storage_key, name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, userId, campaignId, meta.kind ?? 'image', img.mime, data.length, img.width, img.height, key, (meta.name ?? '').slice(0, 120)]);
    return { id, mime: img.mime, width: img.width, height: img.height };
  }
  async readAsset(userId: string, assetId: string) {
    const a = (await this.db.query('SELECT * FROM assets WHERE id = $1', [assetId]))[0];
    if (!a) throw notFound();
    if (a.owner_id !== userId && !(a.campaign_id && (await this.roleFor(userId, a.campaign_id)))) throw notFound();
    const data = await this.storage.get(a.storage_key);
    if (!data) throw notFound();
    return { mime: a.mime as string, data };
  }

  // ---------- realtime state ----------
  private async fogState(mapId: string, q: Queryable = this.db) {
    const m = (await q.query('SELECT fog_enabled FROM maps WHERE id = $1', [mapId]))[0];
    const regions = (await q.query('SELECT * FROM fog_regions WHERE map_id = $1 ORDER BY created_at, id', [mapId])).map(fogView) as FogRegion[];
    return { enabled: !!m?.fog_enabled, regions };
  }
  async initiativeFull(sessionId: string, q: Queryable = this.db): Promise<InitiativeView & { encounterId: string }> {
    const e = (await q.query('SELECT * FROM encounters WHERE session_id = $1', [sessionId]))[0];
    const parts = await q.query('SELECT * FROM encounter_participants WHERE encounter_id = $1 ORDER BY initiative DESC NULLS LAST, sort_order, id', [e.id]);
    const participants = parts.map((p) => ({ id: p.id, tokenId: p.token_id, name: p.name, initiative: p.initiative == null ? null : Number(p.initiative), hidden: p.hidden }));
    const idx = participants.length ? Math.min(e.turn_index, participants.length - 1) : 0;
    return { encounterId: e.id, round: e.round, turnIndex: idx, active: e.active, activeId: e.active && participants[idx] ? participants[idx].id : null, participants };
  }
  /** Players never receive hidden combatants; if the active one is hidden they see no active marker. */
  filterInitiative(full: InitiativeView, role: Role | null): InitiativeView {
    const { encounterId: _e, ...view } = full as any;
    if (isGmRole(role)) return view;
    const participants = view.participants.filter((p: any) => !p.hidden);
    return { ...view, participants, activeId: participants.some((p: any) => p.id === view.activeId) ? view.activeId : null };
  }
  static tokenVisibleTo(role: Role | null, userId: string, t: TokenView, revealed: boolean) {
    if (isGmRole(role)) return true;
    if (t.hidden) return false;
    return revealed || t.ownerIds.includes(userId);
  }

  async snapshot(userId: string, sessionId: string, online: Set<string> = new Set()): Promise<SessionSnapshot> {
    const { session, role } = await this.sessionContext(userId, sessionId);
    const me = (await this.db.query('SELECT display_name FROM users WHERE id = $1', [userId]))[0];
    const members = (await this.db.query('SELECT m.user_id, m.role, u.display_name FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = $1 ORDER BY m.joined_at', [session.campaign_id]))
      .map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role, online: online.has(m.user_id) }));
    let map: MapView | null = null, tokens: TokenView[] = [], fog: FogRegionView[] = [], drawings: DrawingView[] = [];
    if (session.active_map_id) {
      const mr = (await this.db.query('SELECT * FROM maps WHERE id = $1', [session.active_map_id]))[0];
      map = mapView(mr);
      const fs = await this.fogState(map.id);
      fog = fs.regions;
      tokens = (await this.db.query('SELECT * FROM tokens WHERE map_id = $1 ORDER BY updated_at, id', [map.id])).map(tokenView)
        .filter((t) => Services.tokenVisibleTo(role, userId, t, isPointRevealed(fs.enabled, fs.regions, t)));
      drawings = (await this.db.query('SELECT * FROM drawings WHERE map_id = $1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at', [map.id])).map(drawingView)
        .filter((d) => !d.gmOnly || isGmRole(role));
    }
    const chatRows = await this.db.query(
      'SELECT * FROM (SELECT cm.*, u.display_name AS user_name, r.expression AS roll_expression, r.total AS roll_total, r.result AS roll_result FROM chat_messages cm LEFT JOIN users u ON u.id = cm.user_id LEFT JOIN dice_rolls r ON r.id = cm.roll_id WHERE cm.session_id = $1 ORDER BY cm.created_at DESC, cm.id DESC LIMIT 200) x ORDER BY created_at, id', [sessionId]);
    const chat = chatRows.map(chatView).filter((c) => canSee(role, userId, c.visibility, c.userId)).slice(-100);
    return {
      seq: Number(session.seq),
      me: { id: userId, displayName: me.display_name, role },
      session: { id: session.id, name: session.name, status: session.status, campaignId: session.campaign_id, campaignName: session.campaign_name, rulesetId: session.ruleset_id },
      members, map, tokens, fog, drawings,
      initiative: this.filterInitiative(await this.initiativeFull(sessionId), role),
      chat,
    };
  }

  async setMapBackground(userId: string, sessionId: string, assetId: string | null) {
    return this.applyCommandRaw(userId, sessionId, async (ctx, t) => {
      if (!can(ctx.role, 'map.edit')) throw new CommandError('forbidden', 'Only the GM can change the map');
      let w: number | null = null, h: number | null = null;
      if (assetId) {
        const a = (await t.query('SELECT * FROM assets WHERE id = $1 AND campaign_id = $2', [assetId, ctx.session.campaign_id]))[0];
        if (!a) throw new CommandError('not_found', 'Asset not found');
        w = a.width; h = a.height;
      }
      const r = (await t.query('UPDATE maps SET background_asset_id = $2, width = COALESCE($3, width), height = COALESCE($4, height), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [ctx.mapId, assetId, w, h]))[0];
      return [{ kind: 'event', audience: { kind: 'all' }, event: { type: 'map.updated', map: mapView(r) } }];
    }, 'map.background');
  }

  /** Validate-authorize-apply a realtime command atomically. Returns the new sequence number and effects to broadcast. */
  async applyCommand(userId: string, sessionId: string, cmd: Command): Promise<{ seq: number; effects: Effect[] }> {
    return this.applyCommandRaw(userId, sessionId, (ctx, t) => this.execute(userId, ctx, t, cmd), cmd.type, cmd);
  }

  private async applyCommandRaw(userId: string, sessionId: string, fn: (ctx: { session: any; role: Role; mapId: string }, t: Queryable) => Promise<Effect[]>, type: string, payload?: Command) {
    return this.db.tx(async (t) => {
      const { session, role } = await this.sessionContext(userId, sessionId, t);
      if (session.status === 'closed') throw new CommandError('closed', 'This session is closed');
      if (session.status === 'paused' && !isGmRole(role)) throw new CommandError('closed', 'The GM has paused this session');
      if (!session.active_map_id) throw new CommandError('not_found', 'This session has no map');
      const effects = await fn({ session, role, mapId: session.active_map_id }, t);
      if (type === 'ping') return { seq: Number(session.seq), effects };
      const seq = Number((await t.query('UPDATE game_sessions SET seq = seq + 1, updated_at = now() WHERE id = $1 RETURNING seq', [sessionId]))[0].seq);
      // Event log keeps type and target ids only, never chat bodies or note text.
      const logged = payload ? { id: (payload as any).id ?? null } : {};
      await t.query('INSERT INTO session_events (session_id, seq, type, actor_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)', [sessionId, seq, type, userId, JSON.stringify(logged)]);
      if (seq % 100 === 0) await t.query('DELETE FROM session_events WHERE session_id = $1 AND seq <= $2', [sessionId, seq - EVENT_RETENTION]);
      return { seq, effects };
    });
  }

  private async tokenEffect(t: Queryable, mapId: string, tokens: TokenView[], removedIds: string[] = []): Promise<Effect> {
    const fs = await this.fogState(mapId, t);
    return { kind: 'tokens', tokens: tokens.map((tk) => ({ token: tk, revealed: isPointRevealed(fs.enabled, fs.regions, tk) })), removedIds };
  }
  private async allTokensEffect(t: Queryable, mapId: string): Promise<Effect> {
    const all = (await t.query('SELECT * FROM tokens WHERE map_id = $1', [mapId])).map(tokenView);
    return this.tokenEffect(t, mapId, all);
  }

  private async execute(userId: string, ctx: { session: any; role: Role; mapId: string }, t: Queryable, cmd: Command): Promise<Effect[]> {
    const { role, mapId, session } = ctx;
    const deny = (m = 'You do not have permission to do that') => { throw new CommandError('forbidden', m); };
    const loadToken = async (id: string) => {
      const r = (await t.query('SELECT * FROM tokens WHERE id = $1 AND map_id = $2 FOR UPDATE', [id, mapId]))[0];
      if (!r || (r.hidden && !isGmRole(role))) throw new CommandError('not_found', 'Token not found');
      return tokenView(r);
    };
    switch (cmd.type) {
      case 'token.create': {
        if (!can(role, 'token.create')) deny('Only the GM can place tokens');
        const id = newId('tok');
        const r = (await t.query('INSERT INTO tokens (id, map_id, name, category, color, x, y, size, hidden, owner_ids, asset_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
          [id, mapId, cmd.name, cmd.category, cmd.color, cmd.x, cmd.y, cmd.size, cmd.hidden, cmd.ownerIds, cmd.assetId]))[0];
        return [await this.tokenEffect(t, mapId, [tokenView(r)])];
      }
      case 'token.move': {
        const tok = await loadToken(cmd.id);
        if (!canEditToken(role, userId, tok)) deny('You can only move your own tokens');
        if (cmd.baseVersion !== tok.version) {
          // Visible tokens get their current state echoed so the client can roll back; hidden ones look like not_found.
          throw new CommandError('stale', 'Someone else moved this token first', tok);
        }
        const r = (await t.query('UPDATE tokens SET x = $2, y = $3, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [cmd.id, cmd.x, cmd.y]))[0];
        return [await this.tokenEffect(t, mapId, [tokenView(r)])];
      }
      case 'token.update': {
        const tok = await loadToken(cmd.id);
        if (!canEditToken(role, userId, tok)) deny('You can only edit your own tokens');
        const p = cmd.patch;
        const gmOnlyFields: (keyof typeof p)[] = ['hidden', 'locked', 'ownerIds', 'category'];
        if (!isGmRole(role) && gmOnlyFields.some((k) => p[k] !== undefined)) deny('Only the GM can change visibility, locking, ownership or category');
        if (cmd.baseVersion !== tok.version) throw new CommandError('stale', 'This token changed before your edit arrived', tok);
        const cols: Record<string, string> = { name: 'name', category: 'category', color: 'color', rotation: 'rotation', size: 'size', hidden: 'hidden', locked: 'locked', ownerIds: 'owner_ids', hp: 'hp', hpMax: 'hp_max', conditions: 'conditions', assetId: 'asset_id' };
        const sets: string[] = []; const vals: unknown[] = [cmd.id];
        for (const [k, col] of Object.entries(cols)) if ((p as any)[k] !== undefined) { vals.push((p as any)[k]); sets.push(col + ' = $' + vals.length); }
        if (p.ownerIds) {
          const ok = await t.query('SELECT user_id FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2)', [session.campaign_id, p.ownerIds]);
          if (ok.length !== new Set(p.ownerIds).size) throw new CommandError('invalid', 'Owners must be campaign members');
        }
        if (!sets.length) return [];
        const r = (await t.query('UPDATE tokens SET ' + sets.join(', ') + ', version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', vals))[0];
        return [await this.tokenEffect(t, mapId, [tokenView(r)])];
      }
      case 'token.delete': {
        if (!can(role, 'token.edit_any')) deny('Only the GM can delete tokens');
        await loadToken(cmd.id);
        await t.query('DELETE FROM tokens WHERE id = $1', [cmd.id]);
        return [await this.tokenEffect(t, mapId, [], [cmd.id]), { kind: 'initiative' }];
      }
      case 'map.update': {
        if (!can(role, 'map.edit')) deny('Only the GM can change the map');
        const cur = (await t.query('SELECT * FROM maps WHERE id = $1 FOR UPDATE', [mapId]))[0];
        const grid = cmd.grid ? GridConfig.parse({ ...cur.grid, ...cmd.grid }) : GridConfig.parse(cur.grid);
        const r = (await t.query('UPDATE maps SET name = COALESCE($2, name), width = COALESCE($3, width), height = COALESCE($4, height), grid = $5::jsonb, fog_enabled = COALESCE($6, fog_enabled), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *',
          [mapId, cmd.name ?? null, cmd.width ?? null, cmd.height ?? null, JSON.stringify(grid), cmd.fogEnabled ?? null]))[0];
        const effects: Effect[] = [{ kind: 'event', audience: { kind: 'all' }, event: { type: 'map.updated', map: mapView(r) } }];
        if (cmd.fogEnabled !== undefined && cmd.fogEnabled !== cur.fog_enabled) {
          effects.push({ kind: 'event', audience: { kind: 'all' }, event: { type: 'fog.updated', fog: (await this.fogState(mapId, t)).regions, fogEnabled: r.fog_enabled } });
          effects.push(await this.allTokensEffect(t, mapId));
        }
        return effects;
      }
      case 'fog.add':
      case 'fog.reset': {
        if (!can(role, 'fog.edit')) deny('Only the GM can change fog of war');
        if (cmd.type === 'fog.add') {
          await t.query('INSERT INTO fog_regions (id, map_id, mode, shape) VALUES ($1, $2, $3, $4::jsonb)', [newId('fog'), mapId, cmd.mode, JSON.stringify(cmd.shape)]);
        } else {
          await t.query('DELETE FROM fog_regions WHERE map_id = $1', [mapId]);
          await t.query('UPDATE maps SET fog_enabled = $2, version = version + 1 WHERE id = $1', [mapId, cmd.enabled]);
        }
        const fs = await this.fogState(mapId, t);
        return [{ kind: 'event', audience: { kind: 'all' }, event: { type: 'fog.updated', fog: fs.regions, fogEnabled: fs.enabled } }, await this.allTokensEffect(t, mapId)];
      }
      case 'drawing.add': {
        if (!can(role, 'drawing.create')) deny();
        if (cmd.gmOnly && !can(role, 'drawing.create_gm')) deny('Only the GM can make private annotations');
        const r = (await t.query("INSERT INTO drawings (id, map_id, author_id, gm_only, shape, expires_at) VALUES ($1,$2,$3,$4,$5::jsonb, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int || ' seconds')::interval END) RETURNING *",
          [newId('drw'), mapId, userId, cmd.gmOnly, JSON.stringify(cmd.shape), cmd.ttlSeconds ?? null]))[0];
        return [{ kind: 'event', audience: cmd.gmOnly ? { kind: 'gm' } : { kind: 'all' }, event: { type: 'drawing.added', drawing: drawingView(r) } }];
      }
      case 'drawing.delete': {
        const d = (await t.query('SELECT * FROM drawings WHERE id = $1 AND map_id = $2', [cmd.id, mapId]))[0];
        if (!d || (d.gm_only && !isGmRole(role))) throw new CommandError('not_found', 'Drawing not found');
        if (d.author_id !== userId && !isGmRole(role)) deny('You can only erase your own drawings');
        await t.query('DELETE FROM drawings WHERE id = $1', [cmd.id]);
        return [{ kind: 'event', audience: d.gm_only ? { kind: 'gm' } : { kind: 'all' }, event: { type: 'drawing.removed', ids: [cmd.id] } }];
      }
      case 'drawing.clear': {
        if (!isGmRole(role)) deny('Only the GM can clear all drawings');
        const ids = (await t.query('DELETE FROM drawings WHERE map_id = $1 RETURNING id', [mapId])).map((r) => r.id);
        return [{ kind: 'event', audience: { kind: 'all' }, event: { type: 'drawing.removed', ids } }];
      }
      case 'dice.roll': {
        if (!can(role, 'dice.roll')) deny('Spectators cannot roll');
        let result;
        try { result = rollDice(cmd.expression); } catch (e) { if (e instanceof DiceError) throw new CommandError('invalid', e.message); throw e; }
        const stored = { terms: result.terms, label: cmd.label };
        const rollId = newId('rol');
        await t.query('INSERT INTO dice_rolls (id, session_id, user_id, expression, result, total, visibility) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)', [rollId, session.id, userId, result.expression, JSON.stringify(stored), result.total, cmd.visibility]);
        const msg = (await t.query("INSERT INTO chat_messages (id, session_id, user_id, kind, body, roll_id, visibility) VALUES ($1,$2,$3,'roll',$4,$5,$6) RETURNING *", [newId('msg'), session.id, userId, cmd.label ?? '', rollId, cmd.visibility]))[0];
        const name = (await t.query('SELECT display_name FROM users WHERE id = $1', [userId]))[0].display_name;
        const view = chatView({ ...msg, user_name: name, roll_expression: result.expression, roll_total: result.total, roll_result: stored });
        return [{ kind: 'event', audience: this.audienceFor(cmd.visibility, userId), event: { type: 'chat.message', message: view } }];
      }
      case 'chat.send': {
        if (!can(role, 'chat.send')) deny('Spectators cannot chat');
        const msg = (await t.query("INSERT INTO chat_messages (id, session_id, user_id, kind, body, visibility) VALUES ($1,$2,$3,'text',$4,$5) RETURNING *", [newId('msg'), session.id, userId, cmd.body, cmd.visibility]))[0];
        const name = (await t.query('SELECT display_name FROM users WHERE id = $1', [userId]))[0].display_name;
        return [{ kind: 'event', audience: this.audienceFor(cmd.visibility, userId), event: { type: 'chat.message', message: chatView({ ...msg, user_name: name }) } }];
      }
      case 'init.add': case 'init.update': case 'init.remove': case 'init.advance': case 'init.reset': {
        if (!can(role, 'initiative.manage')) deny('Only the GM can manage initiative');
        const full = await this.initiativeFull(session.id, t);
        const enc = full.encounterId;
        const rollInit = (expr: string | undefined) => { if (!expr) return undefined; try { return rollDice(expr).total; } catch (e) { throw new CommandError('invalid', (e as Error).message); } };
        if (cmd.type === 'init.add') {
          if (cmd.tokenId) await loadToken(cmd.tokenId);
          const rolled = rollInit(cmd.rollExpression);
          await t.query('INSERT INTO encounter_participants (id, encounter_id, token_id, name, initiative, hidden, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', [newId('ini'), enc, cmd.tokenId, cmd.name, rolled ?? cmd.initiative, cmd.hidden, full.participants.length]);
        } else if (cmd.type === 'init.update') {
          const rolled = rollInit(cmd.rollExpression);
          if (rolled !== undefined) (cmd as any).initiative = rolled;
          const r = await t.query('UPDATE encounter_participants SET initiative = CASE WHEN $3 THEN $2 ELSE initiative END, name = COALESCE($4, name), hidden = COALESCE($5, hidden) WHERE id = $1 AND encounter_id = $6 RETURNING id',
            [cmd.id, cmd.initiative ?? null, cmd.initiative !== undefined, cmd.name ?? null, cmd.hidden ?? null, enc]);
          if (!r[0]) throw new CommandError('not_found', 'Combatant not found');
        } else if (cmd.type === 'init.remove') {
          await t.query('DELETE FROM encounter_participants WHERE id = $1 AND encounter_id = $2', [cmd.id, enc]);
        } else if (cmd.type === 'init.advance') {
          const n = full.participants.length;
          if (!n) throw new CommandError('invalid', 'Add combatants first');
          if (!full.active) {
            await t.query('UPDATE encounters SET active = true, round = 1, turn_index = 0 WHERE id = $1', [enc]);
          } else {
            let idx = full.turnIndex + cmd.dir, round = full.round;
            if (idx >= n) { idx = 0; round++; }
            if (idx < 0) { if (round > 1) { idx = n - 1; round--; } else idx = 0; }
            await t.query('UPDATE encounters SET turn_index = $2, round = $3 WHERE id = $1', [enc, idx, round]);
          }
        } else {
          await t.query('DELETE FROM encounter_participants WHERE encounter_id = $1', [enc]);
          await t.query('UPDATE encounters SET active = false, round = 1, turn_index = 0 WHERE id = $1', [enc]);
        }
        return [{ kind: 'initiative' }];
      }
      case 'ping': {
        if (!can(role, 'measure') && !can(role, 'chat.send')) deny();
        return [{ kind: 'event', audience: { kind: 'all' }, event: { type: 'ping', x: cmd.x, y: cmd.y, userId, color: '#f1c40f' } }];
      }
    }
  }

  private audienceFor(v: Visibility, userId: string): Audience {
    return v === 'public' ? { kind: 'all' } : v === 'gm' ? { kind: 'gmAndUsers', ids: [userId] } : { kind: 'users', ids: [userId] };
  }
}
