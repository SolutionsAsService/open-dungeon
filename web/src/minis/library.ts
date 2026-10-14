/**
 * The bundled miniature library; meshes are served from /minis/.
 * library.sample.json (two simple pieces) is always there. library.json is written by
 * tools/miniatures/import-library.ts from the private miniature-viewer and is git-ignored: this repo is public and
 * the fantasy-miniatures designs are not, so imported meshes stay on the machine that builds the app.
 */
import sample from './library.sample.json';
import { MiniLibrary, type MiniItem } from '../../../shared/minis';

const imported = Object.values(import.meta.glob('./library.json', { eager: true, import: 'default' }));
const items = new Map<string, MiniItem>();
for (const lib of [...imported, sample]) for (const i of MiniLibrary.parse(lib).items) if (!items.has(i.id)) items.set(i.id, i);

export const LIBRARY = { items: [...items.values()] };
export const miniById = (id: string | null | undefined): MiniItem | undefined => (id ? items.get(id) : undefined);
export const meshUrl = (item: MiniItem) => import.meta.env.BASE_URL + 'minis/' + item.model;
export const MINI_MIME = 'application/x-od-mini';
