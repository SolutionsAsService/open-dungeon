/**
 * Private miniature libraries (ADR 0011). A library source is a miniature-viewer catalogue
 * (data/catalog.json + viewer parts meshes) in a local folder, at an HTTPS URL, or in a GitHub repo at a ref:
 *
 *   MINI_LIBRARY_SOURCES="github:SolutionsAsService/miniature-viewer@main /srv/minis https://minis.example.com/viewer/"
 *
 * Read server-side only. A GitHub token (MINI_LIBRARY_TOKEN, else GITHUB_TOKEN) is sent to api.github.com and nowhere
 * else, and never reaches the browser; clients get the converted index and stripped part meshes (name, colour,
 * vertices, triangles) through campaign-member API routes. Node only: never import this from web/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { libraryItem, MiniLibrary, type MeshPart, type MiniItem } from '../shared/minis';

export type SourceSpec = { kind: 'dir'; dir: string } | { kind: 'https'; base: string } | { kind: 'github'; repo: string; ref: string; dir: string };
/** Reads a catalogue file by its path relative to the viewer root ("./assets/…" or "data/catalog.json"). */
export type Reader = (rel: string) => Promise<Buffer>;

const MAX_FILE = 64 * 1024 * 1024;

/** Whitespace- or comma-separated list: github:Owner/repo[@ref][:sub/dir], https://…/ (viewer root URL), or a folder path. */
export function parseSources(spec: string | undefined): SourceSpec[] {
  return (spec ?? '').split(/[\s,]+/).filter(Boolean).map((s): SourceSpec => {
    const gh = /^github:([\w.-]+\/[\w.-]+)(?:@([\w./-]+?))?(?::([\w./-]*))?$/.exec(s);
    if (gh) return { kind: 'github', repo: gh[1], ref: gh[2] || 'main', dir: (gh[3] ?? '').replace(/^\/+|\/+$/g, '') };
    if (s.startsWith('github:')) throw new Error('Bad library source ' + s + ' (expected github:Owner/repo@ref:path)');
    if (/^https:\/\//i.test(s)) return { kind: 'https', base: s.endsWith('/') ? s : s + '/' };
    if (/^[a-z]+:\/\//i.test(s)) throw new Error('Library sources must be https://, github: or a folder: ' + s);
    return { kind: 'dir', dir: path.resolve(s) };
  });
}

/** Catalogue-relative path, normalised; null if it tries to leave the catalogue root. */
function cleanRel(rel: string) {
  const p = path.posix.normalize(rel.replace(/\\/g, '/').replace(/^\.\//, ''));
  return p.startsWith('..') || p.startsWith('/') || p === '.' || /^[a-z]+:/i.test(p) ? null : p;
}

async function readCapped(r: Response, what: string) {
  if (!r.ok) throw new Error(what + ': HTTP ' + r.status);
  if (Number(r.headers.get('content-length') ?? 0) > MAX_FILE) throw new Error(what + ': too large');
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > MAX_FILE) throw new Error(what + ': too large');
  return b;
}

export function readerFor(s: SourceSpec, opts: { token?: string | null; fetch?: typeof fetch } = {}): Reader {
  const f = opts.fetch ?? fetch;
  return async (rel) => {
    const p = cleanRel(rel);
    if (!p) throw new Error('Path outside the catalogue: ' + rel);
    if (s.kind === 'dir') return fs.readFile(path.join(s.dir, p));
    if (s.kind === 'https') return readCapped(await f(new URL(p, s.base), { redirect: 'error' }), p);
    const file = (s.dir ? s.dir + '/' : '') + p;
    const url = 'https://api.github.com/repos/' + s.repo + '/contents/' + file.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(s.ref);
    const headers: Record<string, string> = { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'open-tabletop', 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    return readCapped(await f(url, { headers }), s.repo + '/' + file);
  };
}

/** Viewer catalogue -> library index + stripped meshes. Models without a readable parts mesh are skipped with a warning. */
export async function readCatalogue(read: Reader, warn: (m: string) => void = console.warn) {
  const catalog = JSON.parse((await read('data/catalog.json')).toString('utf8'));
  const lines = new Map<string, string>((catalog.lines ?? []).map((l: any) => [l.id, l.repo]));
  const items: MiniItem[] = [];
  const meshes = new Map<string, MeshPart[]>();
  for (const m of catalog.models ?? []) {
    if (m.model?.format !== 'parts' || typeof m.model.url !== 'string') { warn('skip ' + m.id + ': no parts model'); continue; }
    try {
      const raw = JSON.parse((await read(m.model.url)).toString('utf8'));
      const parts: MeshPart[] = (Array.isArray(raw) ? raw : raw.parts).map((p: any) => ({ name: String(p.name), color: p.color, vertices: p.vertices, triangles: p.triangles }));
      const repo = m.source?.repo ?? lines.get(m.line) ?? '';
      const item = libraryItem(m, parts, repo ? { repo, path: m.source?.path ?? m.id } : undefined);
      items.push(item); meshes.set(item.id, parts);
    } catch (e) { warn('skip ' + m.id + ': ' + (e as Error).message); }
  }
  const lib = MiniLibrary.parse({ format: 'open-dungeon.mini-library', version: 1, name: 'SolutionsAsService miniatures', items });
  return { lib, meshes };
}

/** What Services needs from a library (lets the browser's local mode run without one). */
export interface MiniLibrarySource { library(): Promise<MiniItem[]>; mesh(id: string): Promise<Buffer | null> }

/**
 * The configured sources, read lazily and cached in memory; refreshed after ttlMs (a failed refresh keeps the old copy).
 * The first source that defines an id wins.
 * shortcut: every parts mesh is held in memory (viewer meshes are a few hundred kB each); move to a disk cache past ~100 minis.
 */
export class MiniSources implements MiniLibrarySource {
  private cache: { at: number; items: MiniItem[]; meshes: Map<string, Buffer> } | null = null;
  private loading: Promise<void> | null = null;
  constructor(private specs: SourceSpec[], private opts: { token?: string | null; ttlMs?: number; fetch?: typeof fetch } = {}) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env) {
    const specs = parseSources(env.MINI_LIBRARY_SOURCES);
    return specs.length ? new MiniSources(specs, { token: env.MINI_LIBRARY_TOKEN || env.GITHUB_TOKEN || null, ttlMs: Number(env.MINI_LIBRARY_TTL_SECONDS || 3600) * 1000 }) : null;
  }

  private async refresh() {
    const items: MiniItem[] = [], meshes = new Map<string, Buffer>();
    for (const s of this.specs) {
      try {
        const { lib, meshes: m } = await readCatalogue(readerFor(s, this.opts), () => undefined);
        for (const i of lib.items) if (!meshes.has(i.id)) { items.push(i); meshes.set(i.id, Buffer.from(JSON.stringify(m.get(i.id)))); }
      } catch (e) {
        // the token is only ever in a request header, so the message can't contain it
        console.error('mini library source failed (' + s.kind + '):', (e as Error).message);
      }
    }
    if (items.length || !this.cache) this.cache = { at: Date.now(), items, meshes };
    else this.cache.at = Date.now();
  }
  private async ready() {
    const stale = !this.cache || Date.now() - this.cache.at > (this.opts.ttlMs ?? 3600_000);
    if (stale) { this.loading ??= this.refresh().finally(() => { this.loading = null; }); if (!this.cache) await this.loading; }
    return this.cache!;
  }
  async library(): Promise<MiniItem[]> { return (await this.ready()).items; }
  async mesh(id: string): Promise<Buffer | null> { return (await this.ready()).meshes.get(id) ?? null; }
}
