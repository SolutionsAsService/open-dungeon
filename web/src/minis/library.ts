/**
 * The miniature library the table shows, from three places (first id wins):
 * - bundled: library.sample.json (two simple pieces, always there) and library.json, written at build time by
 *   tools/miniatures/import-library.ts and git-ignored (this repo is public; the fantasy designs are not);
 *   meshes are static files under /minis/.
 * - library: private sources the server reads (MINI_LIBRARY_SOURCES), served to campaign members by the API.
 * - uploaded: figures members uploaded to this campaign (STL/OBJ/glTF converted by the server).
 * Loaded per campaign by loadCampaignMinis(); the 3D view re-renders tokens when it changes.
 */
import { create } from 'zustand';
import sample from './library.sample.json';
import { MiniLibrary, type MiniItem, type MeshPart } from '../../../shared/minis';
import { api, ApiError } from '../api';
import { localModeSync } from '../local/mode';

export type MiniOrigin = 'bundled' | 'library' | 'uploaded';
export type MiniEntry = MiniItem & { origin: MiniOrigin; url: string; ownerId?: string; ownerName?: string; canEdit?: boolean };

const imported = Object.values(import.meta.glob('./library.json', { eager: true, import: 'default' }));
const bundled: MiniEntry[] = [];
for (const lib of [...imported, sample]) for (const i of MiniLibrary.parse(lib).items) if (!bundled.some((b) => b.id === i.id)) bundled.push({ ...i, origin: 'bundled', url: import.meta.env.BASE_URL + 'minis/' + i.model });

export const useMinis = create<{ items: MiniEntry[]; campaignId: string | null; playerUploads: boolean; canUpload: boolean }>(() => ({ items: bundled, campaignId: null, playerUploads: false, canUpload: false }));

export const miniById = (id: string | null | undefined): MiniEntry | undefined => (id ? useMinis.getState().items.find((i) => i.id === id) : undefined);
export const MINI_MIME = 'application/x-od-mini';

type Uploaded = MiniItem & { ownerId: string; ownerName: string; canEdit: boolean };
/** Fetch the campaign's server-side minis and merge them after the bundled ones. */
export async function loadCampaignMinis(campaignId: string) {
  lastLoad = Date.now();
  const r = await api<{ library: MiniItem[]; uploaded: Uploaded[]; playerUploads: boolean; canUpload: boolean }>('GET', '/api/campaigns/' + campaignId + '/minis');
  const base = '/api/campaigns/' + campaignId + '/minis/';
  const items = [...bundled];
  for (const [list, origin] of [[r.library, 'library'], [r.uploaded, 'uploaded']] as const) for (const i of list) if (!items.some((x) => x.id === i.id)) items.push({ ...i, origin, url: base + i.id + '/mesh' });
  useMinis.setState({ items, campaignId, playerUploads: r.playerUploads, canUpload: r.canUpload });
}
let lastLoad = 0;
/** A token names a mini we don't know yet (someone just uploaded it): reload the list, at most every 5 s. */
export function ensureMini(id: string | null | undefined) {
  const cid = useMinis.getState().campaignId;
  if (id && cid && !miniById(id) && Date.now() - lastLoad > 5000) loadCampaignMinis(cid).catch(() => undefined);
}

/** Parts mesh for an entry; API meshes go through the in-browser backend in local mode. */
export async function fetchMesh(item: MiniEntry): Promise<MeshPart[]> {
  if (item.origin !== 'bundled' && localModeSync()) {
    const { localFetch } = await import('../local/backend');
    const r = await localFetch('GET', item.url, {});
    if (r.status !== 200 || !r.binary) throw new ApiError(r.status, 'Mesh not found');
    return JSON.parse(new TextDecoder().decode(r.binary));
  }
  const r = await fetch(item.url, { credentials: 'same-origin' });
  if (!r.ok) throw new ApiError(r.status, 'Mesh not found');
  return r.json();
}
