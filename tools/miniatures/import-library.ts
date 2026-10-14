/**
 * Import a miniature-viewer catalogue into OPEN TABLETOP's bundled 3D miniature library (build time).
 *
 *   npx tsx tools/miniatures/import-library.ts [source]
 *
 * source: a viewer checkout folder (default ../miniature-viewer), github:Owner/repo[@ref][:path] or an https:// viewer URL
 * (server/minisources.ts). GitHub sources use MINI_LIBRARY_TOKEN, GITHUB_TOKEN or GH_TOKEN, else \`gh auth token\`, so a
 * Docker/Shadw build can pull the private minis at deploy time. Writes:
 *   public/minis/<id>.parts.json   only name, colour, vertices and triangles (no print/STL/notes fields)
 *   web/src/minis/library.json     the bundled index (shared/minis.ts MiniLibrary): footprint, cells, height
 * Both are git-ignored. Anything bundled is served to anyone who can load the site; for a private library on a
 * multiplayer server prefer MINI_LIBRARY_SOURCES (served to campaign members only). See docs/development/deployment.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSources, readerFor, readCatalogue } from '../../server/minisources';

function githubToken() {
  const env = process.env.MINI_LIBRARY_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

export async function importLibrary(source: string, outMeshes: string, outIndex: string, opts: { fetch?: typeof fetch; token?: string | null } = {}) {
  const [spec] = parseSources(source);
  if (!spec) throw new Error('No library source given');
  const token = spec.kind === 'github' ? (opts.token !== undefined ? opts.token : githubToken()) : null;
  const { lib, meshes } = await readCatalogue(readerFor(spec, { token, fetch: opts.fetch }));
  fs.mkdirSync(outMeshes, { recursive: true });
  for (const item of lib.items) fs.writeFileSync(path.join(outMeshes, item.model), JSON.stringify(meshes.get(item.id)));
  fs.mkdirSync(path.dirname(outIndex), { recursive: true });
  fs.writeFileSync(outIndex, JSON.stringify(lib, null, 1) + '\n');
  return lib;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const arg = process.argv[2] ?? '../miniature-viewer';
  const lib = await importLibrary(arg, path.resolve('public/minis'), path.resolve('web/src/minis/library.json'));
  for (const i of lib.items) console.log(i.id.padEnd(22), i.kind.padEnd(8), i.footprintMm + ' mm', '-> ' + i.cells + ' cell(s)', i.heightMm + ' mm tall');
  if (!lib.items.length) process.exitCode = 1;
}
