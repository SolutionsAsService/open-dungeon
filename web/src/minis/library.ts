/**
 * The miniature library the table shows, from three places (first id wins):
 * - bundled: library.sample.json (two simple pieces, always there) and library.json, written at build time by
 *   tools/miniatures/import-library.ts and git-ignored (this repo is public; the fantasy designs are not);
 *   meshes are static files under /minis/.
 * - library: private sources the server reads (MINI_LIBRARY_SOURCES), served to campaign members by the API.
 * Loaded per campaign by loadCampaignMinis(); the 3D view re-renders tokens when it changes.
 */
import { create } from 'zustand';
import sample from './library.sample.json';
import { MiniLibrary, type MiniItem, type MeshPart } from '../../../shared/minis';
import { api, ApiError } from '../api';
import { localModeSync } from '../local/mode';

export type MiniOrigin = 'bundled' | 'library';
export type MiniEntry = MiniItem & { origin: MiniOrigin; url: string };

const imported = Object.values(import.meta.glob('./library.json', { eager: true, import: 'default' }));
const bundled: MiniEntry[] = [];
for (const lib of [...imported, sample]) for (const i of MiniLibrary.parse(lib).items) if (!bundled.some((b) => b.id === i.id)) bundled.push({ ...i, origin: 'bundled', url: import.meta.env.BASE_URL + 'minis/' + i.model });

export const useMinis = create<{ items: MiniEntry[]; campaignId: string | null }>(() => ({ items: bundled, campaignId: null }));

export const miniById = (id: string | null | undefined): MiniEntry | undefined => (id ? useMinis.getState().items.find((i) => i.id === id) : undefined);
export const MINI_MIME = 'application/x-od-mini';

/** Fetch the campaign's server-side minis and merge them after the bundled ones. */
export async function loadCampaignMinis(campaignId: string) {
  const r = await api<{ library: MiniItem[] }>('GET', '/api/campaigns/' + campaignId + '/minis');
  const base = '/api/campaigns/' + campaignId + '/minis/';
  const items = [...bundled];
  for (const i of r.library) if (!items.some((x) => x.id === i.id)) items.push({ ...i, origin: 'library', url: base + i.id + '/mesh' });
  useMinis.setState({ items, campaignId });
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
