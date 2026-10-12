/**
 * Character service. Same rules as everything else in services.ts: every call takes the acting user id
 * and authorizes itself. GMs see and manage every character in their campaign; players see and edit only
 * characters they own and may create characters for themselves; spectators see none.
 */
import type { Services } from './services';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { newId } from './ids';
import { can } from '../shared/permissions';
import { getRuleset } from '../shared/rules/registry';
import { validateSheetPatch, applySheetPatch, SheetError, type CharacterCreate, type CharacterUpdate, type CharacterView, type SheetData } from '../shared/characters';
import type { Queryable } from './db/index';

const view = (r: any): CharacterView => ({
  id: r.id, campaignId: r.campaign_id, name: r.name, ownerId: r.owner_id, ownerName: r.owner_name ?? null,
  portraitAssetId: r.portrait_asset_id, rulesetId: r.ruleset_id, sheetSchemaVersion: r.sheet_schema_version,
  data: r.data ?? {}, version: r.version, updatedAt: new Date(r.updated_at).toISOString(),
});
const SELECT = 'SELECT ch.*, u.display_name AS owner_name FROM characters ch LEFT JOIN users u ON u.id = ch.owner_id';

export class CharacterService {
  constructor(private svc: Services) {}

  private async role(userId: string, campaignId: string, q: Queryable = this.svc.db) {
    const role = await this.svc.roleFor(userId, campaignId, q);
    if (!role) throw notFound('Campaign not found');
    return role;
  }
  private sheet(rulesetId: string, patch: Record<string, unknown>) {
    try { return validateSheetPatch(getRuleset(rulesetId), patch); } catch (e) { if (e instanceof SheetError) throw badRequest(e.message); throw e; }
  }
  private async checkMember(q: Queryable, campaignId: string, userId: string) {
    if (!(await this.svc.roleFor(userId, campaignId, q))) throw badRequest('Owner must be a campaign member');
  }
  private async checkAsset(q: Queryable, campaignId: string, assetId: string) {
    if (!(await q.query('SELECT 1 FROM assets WHERE id = $1 AND campaign_id = $2', [assetId, campaignId]))[0]) throw badRequest('Portrait must be an image uploaded to this campaign');
  }

  async list(userId: string, campaignId: string): Promise<CharacterView[]> {
    const role = await this.role(userId, campaignId);
    const rows = can(role, 'character.manage')
      ? await this.svc.db.query(SELECT + ' WHERE ch.campaign_id = $1 ORDER BY ch.name, ch.id', [campaignId])
      : await this.svc.db.query(SELECT + ' WHERE ch.campaign_id = $1 AND ch.owner_id = $2 ORDER BY ch.name, ch.id', [campaignId, userId]);
    return rows.map(view);
  }

  /** Loads a character the user may see; anything else is indistinguishable from "doesn't exist". */
  async get(userId: string, characterId: string, q: Queryable = this.svc.db, lock = false) {
    const r = (await q.query(SELECT + ' WHERE ch.id = $1' + (lock ? ' FOR UPDATE OF ch' : ''), [characterId]))[0];
    if (!r) throw notFound('Character not found');
    const role = await this.svc.roleFor(userId, r.campaign_id, q);
    if (!role || (!can(role, 'character.manage') && r.owner_id !== userId)) throw notFound('Character not found');
    return { row: r, role, character: view(r) };
  }

  async create(userId: string, campaignId: string, input: CharacterCreate): Promise<CharacterView> {
    return this.svc.db.tx(async (t) => {
      const role = await this.role(userId, campaignId, t);
      const gm = can(role, 'character.manage');
      if (!gm && !can(role, 'character.create_own')) throw forbidden('Spectators cannot create characters');
      let ownerId = input.ownerId === undefined ? (gm ? null : userId) : input.ownerId;
      if (!gm && ownerId !== userId) throw forbidden('Players can only create characters for themselves');
      if (ownerId) await this.checkMember(t, campaignId, ownerId);
      if (input.portraitAssetId) await this.checkAsset(t, campaignId, input.portraitAssetId);
      const rulesetId = (await t.query('SELECT ruleset_id FROM campaigns WHERE id = $1', [campaignId]))[0].ruleset_id;
      const rs = getRuleset(rulesetId);
      const data = applySheetPatch({}, this.sheet(rs.manifest.id, input.data ?? {}));
      const id = newId('chr');
      await t.query('INSERT INTO characters (id, campaign_id, owner_id, name, portrait_asset_id, ruleset_id, sheet_schema_version, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
        [id, campaignId, ownerId, input.name, input.portraitAssetId ?? null, rs.manifest.id, rs.sheet.schemaVersion, JSON.stringify(data), userId]);
      return view((await t.query(SELECT + ' WHERE ch.id = $1', [id]))[0]);
    });
  }

  async update(userId: string, characterId: string, input: CharacterUpdate): Promise<CharacterView> {
    return this.svc.db.tx(async (t) => {
      const { row, role } = await this.get(userId, characterId, t, true);
      const gm = can(role, 'character.manage');
      if (input.ownerId !== undefined && input.ownerId !== row.owner_id && !gm) throw forbidden('Only the GM can assign or transfer characters');
      if (row.version !== input.baseVersion) throw new HttpError(409, 'stale', 'This character changed since you loaded it; reload and try again');
      if (input.ownerId) await this.checkMember(t, row.campaign_id, input.ownerId);
      if (input.portraitAssetId) await this.checkAsset(t, row.campaign_id, input.portraitAssetId);
      let data: SheetData = row.data ?? {};
      let schema = row.sheet_schema_version;
      if (input.data) { data = applySheetPatch(data, this.sheet(row.ruleset_id, input.data)); schema = getRuleset(row.ruleset_id).sheet.schemaVersion; }
      await t.query('UPDATE characters SET name = COALESCE($2, name), owner_id = CASE WHEN $3 THEN $4 ELSE owner_id END, portrait_asset_id = CASE WHEN $5 THEN $6 ELSE portrait_asset_id END, data = $7::jsonb, sheet_schema_version = $8, version = version + 1, updated_at = now() WHERE id = $1',
        [characterId, input.name ?? null, input.ownerId !== undefined, input.ownerId ?? null, input.portraitAssetId !== undefined, input.portraitAssetId ?? null, JSON.stringify(data), schema]);
      return view((await t.query(SELECT + ' WHERE ch.id = $1', [characterId]))[0]);
    });
  }

  async remove(userId: string, characterId: string) {
    await this.svc.db.tx(async (t) => {
      const { row, role } = await this.get(userId, characterId, t, true);
      if (!can(role, 'character.manage') && row.owner_id !== userId) throw forbidden();
      await t.query('DELETE FROM characters WHERE id = $1', [characterId]);
    });
    return { ok: true };
  }
}
