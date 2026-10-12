/**
 * Journal/handout service. Authorization lives here (shared/journal.ts holds the rules): unreadable entries
 * are indistinguishable from missing ones, players can only write private notes, and only GM roles can
 * share or reveal entries. Mutations return the before/after views so the hub can fan changes out per user.
 */
import type { Services } from './services';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { newId } from './ids';
import { isGmRole } from '../shared/permissions';
import { canReadEntry, canEditEntry, canUseVisibility, type JournalCreate, type JournalUpdate, type JournalView } from '../shared/journal';
import type { Queryable } from './db/index';

const view = (r: any): JournalView => ({
  id: r.id, campaignId: r.campaign_id, authorId: r.author_id, authorName: r.author_name ?? null, kind: r.kind, title: r.title, body: r.body,
  imageAssetId: r.image_asset_id, visibility: r.visibility, sharedWith: r.shared_with ?? [], version: r.version,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});
const SELECT = 'SELECT j.*, u.display_name AS author_name FROM journal_entries j LEFT JOIN users u ON u.id = j.author_id';

export interface JournalChange { campaignId: string; before: JournalView | null; after: JournalView | null }

export class JournalService {
  constructor(private svc: Services) {}

  private async role(userId: string, campaignId: string, q: Queryable = this.svc.db) {
    const role = await this.svc.roleFor(userId, campaignId, q);
    if (!role) throw notFound('Campaign not found');
    return role;
  }
  private async checkShared(q: Queryable, campaignId: string, ids: string[]) {
    if (!ids.length) return;
    const ok = await q.query('SELECT user_id FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2)', [campaignId, ids]);
    if (ok.length !== new Set(ids).size) throw badRequest('Handouts can only be shared with campaign members');
  }
  private async checkAsset(q: Queryable, campaignId: string, assetId: string) {
    if (!(await q.query('SELECT 1 FROM assets WHERE id = $1 AND campaign_id = $2', [assetId, campaignId]))[0]) throw badRequest('Image must be uploaded to this campaign');
  }

  async list(userId: string, campaignId: string): Promise<JournalView[]> {
    const role = await this.role(userId, campaignId);
    const rows = (await this.svc.db.query(SELECT + ' WHERE j.campaign_id = $1 ORDER BY j.updated_at DESC, j.id', [campaignId])).map(view);
    return rows.filter((e) => canReadEntry(role, userId, e));
  }

  async get(userId: string, id: string, q: Queryable = this.svc.db, lock = false) {
    const r = (await q.query(SELECT + ' WHERE j.id = $1' + (lock ? ' FOR UPDATE OF j' : ''), [id]))[0];
    if (!r) throw notFound('Entry not found');
    const role = await this.svc.roleFor(userId, r.campaign_id, q);
    const entry = view(r);
    if (!canReadEntry(role, userId, entry)) throw notFound('Entry not found');
    return { entry, role: role! };
  }

  async create(userId: string, campaignId: string, input: JournalCreate): Promise<JournalChange> {
    return this.svc.db.tx(async (t) => {
      const role = await this.role(userId, campaignId, t);
      if (role === 'spectator') throw forbidden('Spectators cannot write journal entries');
      const visibility = input.visibility ?? (isGmRole(role) ? 'gm' : 'private');
      if (!canUseVisibility(role, visibility)) throw forbidden('Players can only keep private notes; ask the GM to share a handout');
      const shared = visibility === 'players' ? [...new Set(input.sharedWith ?? [])] : [];
      await this.checkShared(t, campaignId, shared);
      if (input.imageAssetId) await this.checkAsset(t, campaignId, input.imageAssetId);
      const id = newId('jrn');
      await t.query('INSERT INTO journal_entries (id, campaign_id, author_id, kind, title, body, image_asset_id, visibility, shared_with) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, campaignId, userId, input.kind, input.title, input.body, input.imageAssetId ?? null, visibility, shared]);
      return { campaignId, before: null, after: view((await t.query(SELECT + ' WHERE j.id = $1', [id]))[0]) };
    });
  }

  async update(userId: string, id: string, input: JournalUpdate): Promise<JournalChange> {
    return this.svc.db.tx(async (t) => {
      const { entry, role } = await this.get(userId, id, t, true);
      if (!canEditEntry(role, userId, entry)) throw forbidden('You can read this entry but not change it');
      if (entry.version !== input.baseVersion) throw new HttpError(409, 'stale', 'This entry changed since you loaded it; reload and try again');
      const visibility = input.visibility ?? entry.visibility;
      if ((input.visibility !== undefined || input.sharedWith !== undefined) && !canUseVisibility(role, visibility)) throw forbidden('Only the GM can share entries');
      const shared = visibility === 'players' ? [...new Set(input.sharedWith ?? entry.sharedWith)] : [];
      await this.checkShared(t, entry.campaignId, shared);
      if (input.imageAssetId) await this.checkAsset(t, entry.campaignId, input.imageAssetId);
      await t.query('UPDATE journal_entries SET title = COALESCE($2, title), kind = COALESCE($3, kind), body = COALESCE($4, body), image_asset_id = CASE WHEN $5 THEN $6 ELSE image_asset_id END, visibility = $7, shared_with = $8, version = version + 1, updated_at = now() WHERE id = $1',
        [id, input.title ?? null, input.kind ?? null, input.body ?? null, input.imageAssetId !== undefined, input.imageAssetId ?? null, visibility, shared]);
      return { campaignId: entry.campaignId, before: entry, after: view((await t.query(SELECT + ' WHERE j.id = $1', [id]))[0]) };
    });
  }

  async remove(userId: string, id: string): Promise<JournalChange> {
    return this.svc.db.tx(async (t) => {
      const { entry, role } = await this.get(userId, id, t, true);
      if (!canEditEntry(role, userId, entry)) throw forbidden();
      await t.query('DELETE FROM journal_entries WHERE id = $1', [id]);
      return { campaignId: entry.campaignId, before: entry, after: null };
    });
  }
}
