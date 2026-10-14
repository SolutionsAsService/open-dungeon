/**
 * Import the miniature-viewer catalogue into OPEN TABLETOP's 3D miniature library.
 *
 *   npx tsx tools/miniatures/import-library.ts [../miniature-viewer]
 *
 * Reads <viewer>/data/catalog.json and each model's viewer parts.json (mm, z up), and writes:
 *   public/minis/<id>.parts.json   only name, colour, vertices and triangles (no print/STL/notes fields)
 *   web/src/minis/library.json     the bundled index (shared/minis.ts MiniLibrary): footprint, cells, height
 * Re-run after new minis are registered in the viewer; models whose format isn't "parts" are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { libraryItem, MiniLibrary, type MeshPart } from '../../shared/minis';

export function importLibrary(viewerDir: string, outMeshes: string, outIndex: string) {
  const catalog = JSON.parse(fs.readFileSync(path.join(viewerDir, 'data', 'catalog.json'), 'utf8'));
  const lines = new Map<string, string>((catalog.lines ?? []).map((l: any) => [l.id, l.repo]));
  fs.mkdirSync(outMeshes, { recursive: true });
  const items = [];
  for (const m of catalog.models ?? []) {
    if (m.model?.format !== 'parts' || typeof m.model.url !== 'string') { console.warn('skip ' + m.id + ': no parts model'); continue; }
    const raw = JSON.parse(fs.readFileSync(path.join(viewerDir, m.model.url), 'utf8'));
    const parts: MeshPart[] = (Array.isArray(raw) ? raw : raw.parts).map((p: any) => ({ name: String(p.name), color: p.color, vertices: p.vertices, triangles: p.triangles }));
    const repo = m.source?.repo ?? lines.get(m.line) ?? '';
    const item = libraryItem(m, parts, repo ? { repo, path: m.source?.path ?? m.id } : undefined);
    fs.writeFileSync(path.join(outMeshes, item.model), JSON.stringify(parts));
    items.push(item);
  }
  const lib = MiniLibrary.parse({ format: 'open-dungeon.mini-library', version: 1, name: 'SolutionsAsService miniatures', items });
  fs.mkdirSync(path.dirname(outIndex), { recursive: true });
  fs.writeFileSync(outIndex, JSON.stringify(lib, null, 1) + '\n');
  return lib;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const viewer = path.resolve(process.argv[2] ?? '../miniature-viewer');
  const lib = importLibrary(viewer, path.resolve('public/minis'), path.resolve('web/src/minis/library.json'));
  for (const i of lib.items) console.log(i.id.padEnd(22), i.kind.padEnd(8), i.footprintMm + ' mm', '-> ' + i.cells + ' cell(s)', i.heightMm + ' mm tall');
}
