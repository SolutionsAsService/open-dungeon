import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSources, readerFor, MiniSources } from '../../server/minisources';

const box = (s: number, h: number) => ({ vertices: [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [0, 0, h]], triangles: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] });
const catalog = { lines: [{ id: 'fantasy', repo: 'Org/fantasy' }], models: [{ id: 'knight', name: 'Knight', family: 'Heroes', line: 'fantasy', model: { format: 'parts', url: './assets/k.parts.json' } }] };
const files: Record<string, unknown> = { 'data/catalog.json': catalog, 'assets/k.parts.json': [{ name: 'Figure', color: '#123456', printStl: 'secret/print.stl', ...box(12.5, 40) }] };

/** Fake api.github.com: serves files from the fake repo, records requests. */
function fakeGithub() {
  const calls: { url: string; auth?: string }[] = [];
  const f = vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    const m = /\/repos\/Org\/viewer\/contents\/(.+)\?ref=v2$/.exec(String(url));
    const body = m && files[decodeURIComponent(m[1]).replace(/^site\//, '')];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('mini library sources', () => {
  it('parses github, https and folder sources and rejects other schemes', () => {
    expect(parseSources('github:Org/viewer@v2:site, https://x.example/viewer  ./lib')).toEqual([
      { kind: 'github', repo: 'Org/viewer', ref: 'v2', dir: 'site' },
      { kind: 'https', base: 'https://x.example/viewer/' },
      { kind: 'dir', dir: path.resolve('lib') },
    ]);
    expect(parseSources('github:Org/viewer')[0]).toMatchObject({ ref: 'main', dir: '' });
    expect(parseSources(undefined)).toEqual([]);
    expect(() => parseSources('http://plain.example/')).toThrow();
    expect(() => parseSources('github:not a repo')).toThrow();
  });

  it('reads a private GitHub catalogue with the token, serves stripped meshes and never exposes the token', async () => {
    const { f, calls } = fakeGithub();
    const src = new MiniSources(parseSources('github:Org/viewer@v2:site'), { token: 'ghp_secret', fetch: f });
    const items = await src.library();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'knight', cells: 1, heightMm: 40, source: { repo: 'Org/fantasy' } });
    expect(calls.every((c) => c.url.startsWith('https://api.github.com/repos/Org/viewer/contents/site/') && c.auth === 'Bearer ghp_secret')).toBe(true);
    const mesh = JSON.parse((await src.mesh('knight'))!.toString());
    expect(Object.keys(mesh[0]).sort()).toEqual(['color', 'name', 'triangles', 'vertices']);
    expect(JSON.stringify(items) + JSON.stringify(mesh)).not.toContain('ghp_secret');
    expect(await src.mesh('nope')).toBeNull();
    await src.library(); // cached: no new requests
    expect(calls).toHaveLength(2);
  });

  it('keeps the last good copy when a refresh fails', async () => {
    const { f } = fakeGithub();
    let fail = false;
    const flaky = (async (u: any, i: any) => (fail ? new Response('down', { status: 502 }) : f(u, i))) as typeof fetch;
    const src = new MiniSources(parseSources('github:Org/viewer@v2:site'), { fetch: flaky, ttlMs: -1 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await src.library()).toHaveLength(1);
    fail = true;
    await src.library(); await new Promise((r) => setTimeout(r, 10));
    expect(await src.library()).toHaveLength(1);
  });

  it('folder and https readers stay inside the catalogue root', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-src-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'ok');
    const read = readerFor({ kind: 'dir', dir });
    expect((await read('./a.txt')).toString()).toBe('ok');
    await expect(read('../etc/passwd')).rejects.toThrow(/outside/);
    await expect(read('/etc/passwd')).rejects.toThrow(/outside/);
    const f = vi.fn(async () => new Response('x')) as unknown as typeof fetch;
    const web = readerFor({ kind: 'https', base: 'https://x.example/viewer/' }, { fetch: f, token: 'never-sent' });
    await web('data/catalog.json');
    expect(String((f as any).mock.calls[0][0])).toBe('https://x.example/viewer/data/catalog.json');
    expect(JSON.stringify((f as any).mock.calls[0][1])).not.toContain('never-sent');
    await expect(web('https://evil.example/x')).rejects.toThrow(/outside/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
