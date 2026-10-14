/**
 * Miniatures served by the server (ADR 0011):
 * - the private library sources configured with MINI_LIBRARY_SOURCES (server/minisources.ts, Node only, injected by
 *   server/main.ts), and
 * - figures uploaded to a campaign (STL/OBJ/glTF converted by shared/meshimport.ts, stored through Storage).
 * Every call checks campaign membership; meshes are only served to members, never as public static files.
 */
import { z } from 'zod';
import type { Services } from './services';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { can, isGmRole, type Role } from '../shared/permissions';
import { cellsForBase, libraryItem, MiniItem } from '../shared/minis';
import { convertMesh, MeshError } from '../shared/meshimport';

export const MAX_UPLOADED_MINIS = 500; // per campaign
export const UploadOptions = z.object({
  name: z.string().trim().min(1).max(60),
  up: z.enum(['auto', 'y', 'z']).default('auto'),
  heightMm: z.coerce.number().min(5).max(1000).optional(),
  baseMm: z.coerce.number().min(5).max(500).optional(),
  kind: z.enum(['figure', 'scenery']).default('figure'),
});
export type UploadOptions = z.infer<typeof UploadOptions>;
export type UploadedMini = MiniItem & { ownerId: string; ownerName: string; canEdit: boolean };

const randomId = () => 'u-' + [...globalThis.crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class MiniService {
  constructor(private svc: Services) {}

  private async role(userId: string, campaignId: string) {
    const role = await this.svc.roleFor(userId, campaignId);
    if (!role) throw notFound('Campaign not found');
    return role;
  }
  private async playerUploads(campaignId: string) {
    return !!(await this.svc.db.query('SELECT player_mini_uploads FROM campaigns WHERE id = $1', [campaignId]))[0]?.player_mini_uploads;
  }
  /** GMs always; players only when the campaign allows it; spectators never. */
  private mayUpload(role: Role, allowed: boolean) { return can(role, 'token.create') || (allowed && can(role, 'token.edit_owned')); }

  async list(userId: string, campaignId: string) {
    const role = await this.role(userId, campaignId);
    const playerUploads = await this.playerUploads(campaignId);
    const rows = await this.svc.db.query('SELECT m.*, u.display_name FROM uploaded_minis m JOIN users u ON u.id = m.owner_id WHERE m.campaign_id = $1 ORDER BY m.created_at, m.id', [campaignId]);
    const uploaded: UploadedMini[] = rows.map((r) => ({ ...MiniItem.parse(r.item), name: r.name, ownerId: r.owner_id, ownerName: r.display_name, canEdit: isGmRole(role) || r.owner_id === userId }));
    return { library: (await this.svc.opts.miniLibrary?.library()) ?? [], uploaded, playerUploads, canUpload: this.mayUpload(role, playerUploads) };
  }

  /** Parts mesh JSON (name, colour, vertices, triangles) for a library or uploaded miniature. */
  async mesh(userId: string, campaignId: string, miniId: string): Promise<Buffer> {
    await this.role(userId, campaignId);
    const lib = await this.svc.opts.miniLibrary?.mesh(miniId);
    if (lib) return lib;
    const r = (await this.svc.db.query('SELECT storage_key FROM uploaded_minis WHERE id = $1 AND campaign_id = $2', [miniId, campaignId]))[0];
    const data = r && (await this.svc.storage.get(r.storage_key));
    if (!data) throw notFound('Miniature not found');
    return data;
  }

  /**
   * Validate and convert an uploaded STL/OBJ/glTF, store it, and add it to the campaign's library.
   * shortcut: conversion runs on the request thread (about a second for a 20 MB STL); move to a worker if uploads get busy.
   */
  async upload(userId: string, campaignId: string, data: Buffer, opts: UploadOptions) {
    const role = await this.role(userId, campaignId);
    if (!this.mayUpload(role, await this.playerUploads(campaignId))) throw forbidden(can(role, 'token.edit_owned') ? 'The GM has not allowed players to upload figures' : undefined);
    if (data.length === 0) throw badRequest('Empty upload');
    if (data.length > this.svc.opts.maxUploadBytes) throw new HttpError(413, 'too_large', 'File is larger than the upload limit');
    const n = Number((await this.svc.db.query('SELECT count(*)::int AS n FROM uploaded_minis WHERE campaign_id = $1', [campaignId]))[0].n);
    if (n >= MAX_UPLOADED_MINIS) throw new HttpError(409, 'limit', 'This campaign already has ' + MAX_UPLOADED_MINIS + ' uploaded figures; delete some first');
    let conv;
    try { conv = convertMesh(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { up: opts.up, heightMm: opts.heightMm }); } catch (e) {
      if (e instanceof MeshError) throw new HttpError(415, 'unsupported', e.message);
      throw e;
    }
    const id = randomId();
    let item = libraryItem({ id, name: opts.name, family: 'Uploaded' }, conv.parts);
    if (opts.baseMm) item = { ...item, footprintMm: opts.baseMm, cells: cellsForBase(opts.baseMm) };
    if (opts.kind === 'scenery') item = { ...item, kind: 'scenery', category: 'object' };
    item = MiniItem.parse(item);
    const mesh = Buffer.from(JSON.stringify(conv.parts));
    const key = 'mini_' + id;
    await this.svc.storage.put(key, mesh);
    await this.svc.db.query('INSERT INTO uploaded_minis (id, campaign_id, owner_id, name, item, storage_key, bytes) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)', [id, campaignId, userId, item.name, JSON.stringify(item), key, mesh.length]);
    return { item, conversion: { format: conv.format, units: conv.units, triangles: conv.triangles, sourceTriangles: conv.sourceTriangles, decimated: conv.decimated } };
  }

  private async editable(userId: string, campaignId: string, miniId: string) {
    const role = await this.role(userId, campaignId);
    const r = (await this.svc.db.query('SELECT * FROM uploaded_minis WHERE id = $1 AND campaign_id = $2', [miniId, campaignId]))[0];
    if (!r) throw notFound('Miniature not found');
    if (!isGmRole(role) && r.owner_id !== userId) throw forbidden('Only the GM or the uploader can change this figure');
    return r;
  }
  async rename(userId: string, campaignId: string, miniId: string, name: string) {
    const r = await this.editable(userId, campaignId, miniId);
    await this.svc.db.query("UPDATE uploaded_minis SET name = $2, item = jsonb_set(item, '{name}', to_jsonb($2::text)) WHERE id = $1", [r.id, name]);
    return { ok: true };
  }
  /** Tokens that used it fall back to a plain pawn. */
  async remove(userId: string, campaignId: string, miniId: string) {
    const r = await this.editable(userId, campaignId, miniId);
    await this.svc.db.query('DELETE FROM uploaded_minis WHERE id = $1', [r.id]);
    await this.svc.storage.delete(r.storage_key);
    return { ok: true };
  }
  async setPlayerUploads(userId: string, campaignId: string, on: boolean) {
    if (!can(await this.role(userId, campaignId), 'session.manage')) throw forbidden();
    await this.svc.db.query('UPDATE campaigns SET player_mini_uploads = $2 WHERE id = $1', [campaignId, on]);
    return { playerUploads: on };
  }
}
