/**
 * Bring-your-own figures (ADR 0011): STL (binary/ASCII), OBJ and glTF (GLB or .gltf with embedded buffers) to the
 * library's compact parts mesh (shared/minis.ts MeshPart: mm, z up). Runs on the server and in the browser's local
 * mode, so it is plain TypeScript over bytes. The type is decided from the content, never from the file name.
 * Units are guessed (STL/OBJ carry none; glTF is metres) unless the uploader gives a height.
 */
import type { MeshPart } from './minis';

export const MAX_UPLOAD_TRIANGLES = 500_000;
const MAX_INPUT_TRIANGLES = 5_000_000; // what we are willing to read before decimating
export type MeshFormat = 'stl' | 'obj' | 'glb' | 'gltf';
export type Units = 'mm' | 'cm' | 'in' | 'm' | 'custom';
export class MeshError extends Error {}

interface RawPart { name: string; color: string; pos: number[]; idx: number[] }
const DEFAULT_COLOR = '#9a9a9a';
const text = (b: Uint8Array, n = b.length) => new TextDecoder().decode(b.subarray(0, n));

export function sniffMesh(b: Uint8Array): 'glb' | 'gltf' | 'stl-binary' | 'stl-ascii' | 'obj' | null {
  if (b.length >= 12 && text(b, 4) === 'glTF') return 'glb';
  if (b.length >= 84) { const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true); if (n > 0 && 84 + 50 * n === b.length) return 'stl-binary'; }
  const head = text(b, 4096).replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('{') && head.includes('"asset"')) return 'gltf';
  if (/^solid\b/.test(head) && /\bfacet\b/.test(head)) return 'stl-ascii';
  if (/^v\s+-?[\d.]/m.test(head)) return 'obj';
  return null;
}

/** Shares identical corner positions (STL lists every triangle corner separately). */
function welder() {
  const pos: number[] = [], idx: number[] = [], seen = new Map<string, number>();
  return { pos, idx, add(x: number, y: number, z: number) {
    const k = x + ',' + y + ',' + z;
    let i = seen.get(k);
    if (i === undefined) { i = pos.length / 3; seen.set(k, i); pos.push(x, y, z); }
    idx.push(i);
  } };
}

function stlBinary(b: Uint8Array): RawPart[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  if (n > MAX_INPUT_TRIANGLES) throw new MeshError('Too many triangles (' + n + ')');
  const w = welder();
  for (let t = 0; t < n; t++) for (let c = 0; c < 3; c++) { const o = 84 + t * 50 + 12 + c * 12; w.add(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)); }
  return [{ name: 'Figure', color: DEFAULT_COLOR, pos: w.pos, idx: w.idx }];
}

function stlAscii(s: string): RawPart[] {
  const w = welder(), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(s))) { if (++n > MAX_INPUT_TRIANGLES * 3) throw new MeshError('Too many triangles'); w.add(Number(m[1]), Number(m[2]), Number(m[3])); }
  if (n % 3) throw new MeshError('Broken ASCII STL (vertex count is not a multiple of 3)');
  return [{ name: 'Figure', color: DEFAULT_COLOR, pos: w.pos, idx: w.idx }];
}

function obj(s: string): RawPart[] {
  const pos: number[] = [], idx: number[] = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') pos.push(Number(t[1]), Number(t[2]), Number(t[3]));
    else if (t[0] === 'f') {
      const nv = pos.length / 3;
      const f = t.slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? nv + i : i - 1; });
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]); // fan-triangulate polygons
      if (idx.length > MAX_INPUT_TRIANGLES * 3) throw new MeshError('Too many triangles');
    }
  }
  return [{ name: 'Figure', color: DEFAULT_COLOR, pos, idx }];
}

// ---- glTF 2.0 ----
type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function trs(n: any): M4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number);
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const hex = (f: number[] | undefined) => (f ? '#' + f.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('') : DEFAULT_COLOR);

function gltf(json: any, bin: Uint8Array | null): RawPart[] {
  if (!json?.asset || String(json.asset.version ?? '').split('.')[0] !== '2') throw new MeshError('Only glTF 2.0 is supported');
  const req: string[] = json.extensionsRequired ?? [];
  if (req.length) throw new MeshError('Unsupported glTF extension: ' + req.join(', ') + ' (export without compression)');
  const buffers: Uint8Array[] = (json.buffers ?? []).map((b: any, i: number) => {
    if (b.uri === undefined) { if (i === 0 && bin) return bin; throw new MeshError('Missing GLB binary chunk'); }
    const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(b.uri));
    if (!m) throw new MeshError('External .bin files are not supported; upload a .glb (or embed the buffers)');
    const raw = atob(m[1]); const u = new Uint8Array(raw.length); for (let k = 0; k < raw.length; k++) u[k] = raw.charCodeAt(k); return u;
  });
  const read = (ai: number, wantFloat: boolean): number[] => {
    const a = json.accessors?.[ai]; if (!a) throw new MeshError('Bad accessor');
    if (a.sparse) throw new MeshError('Sparse accessors are not supported');
    const comps = ({ SCALAR: 1, VEC3: 3 } as Record<string, number>)[a.type]; if (!comps) throw new MeshError('Unexpected accessor type ' + a.type);
    const size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
    if (!size || (wantFloat !== (a.componentType === 5126))) throw new MeshError('Unsupported accessor component type');
    const bv = json.bufferViews?.[a.bufferView]; if (!bv) throw new MeshError('Bad buffer view');
    const buf = buffers[bv.buffer]; if (!buf) throw new MeshError('Bad buffer');
    const count = Number(a.count), stride = bv.byteStride || comps * size, start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (!(count >= 0) || count > MAX_INPUT_TRIANGLES * 3 || start + stride * (count - 1) + comps * size > buf.length) throw new MeshError('Accessor outside its buffer');
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out: number[] = new Array(count * comps);
    for (let i = 0; i < count; i++) for (let c = 0; c < comps; c++) {
      const o = start + i * stride + c * size;
      out[i * comps + c] = a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true) : dv.getUint8(o);
    }
    return out;
  };
  const parts = new Map<string, RawPart>();
  let budget = 0;
  const visit = (ni: number, parent: M4, depth: number) => {
    const n = json.nodes?.[ni]; if (!n || depth > 64) return;
    const m = mul(parent, trs(n));
    const mesh = n.mesh !== undefined ? json.meshes?.[n.mesh] : null;
    for (const p of mesh?.primitives ?? []) {
      if ((p.mode ?? 4) !== 4 || p.attributes?.POSITION === undefined) continue;
      const v = read(p.attributes.POSITION, true);
      const ix = p.indices !== undefined ? read(p.indices, false) : Array.from({ length: v.length / 3 }, (_, i) => i);
      if ((budget += ix.length / 3) > MAX_INPUT_TRIANGLES) throw new MeshError('Too many triangles');
      const color = hex(json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorFactor);
      let part = parts.get(color);
      if (!part) { part = { name: String(mesh.name || json.materials?.[p.material]?.name || 'Part ' + (parts.size + 1)).slice(0, 40), color, pos: [], idx: [] }; parts.set(color, part); }
      const base = part.pos.length / 3, nv = v.length / 3;
      for (let i = 0; i < nv; i++) { const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2]; part.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]); }
      for (const i of ix) { if (i >= nv) throw new MeshError('Index outside the vertex list'); part.idx.push(base + i); }
    }
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i).filter((i: number) => !(json.nodes ?? []).some((n: any) => (n.children ?? []).includes(i)));
  for (const r of roots) visit(r, I4, 0);
  return [...parts.values()];
}

function glb(b: Uint8Array): RawPart[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(4, true) !== 2) throw new MeshError('Only glTF 2.0 is supported');
  let json: any = null, bin: Uint8Array | null = null;
  for (let o = 12; o + 8 <= b.length;) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    if (o + 8 + len > b.length) throw new MeshError('Truncated GLB');
    const chunk = b.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(text(chunk)); else if (type === 0x004e4942 && !bin) bin = chunk;
    o += 8 + len;
  }
  if (!json) throw new MeshError('GLB has no JSON chunk');
  return gltf(json, bin);
}

/** Vertex clustering: snap vertices to a grid that grows until the mesh fits the triangle budget. */
export function decimate(parts: { pos: number[]; idx: number[] }[], maxTriangles: number) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p.pos[i]); hi[i % 3] = Math.max(hi[i % 3], p.pos[i]); }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  for (let cell = size / 1024; ; cell *= 1.4) {
    const out = parts.map((p) => {
      const ids = new Map<string, number>(), sum: number[] = [], cnt: number[] = [], remap = new Array(p.pos.length / 3);
      for (let i = 0; i < remap.length; i++) {
        const k = Math.floor((p.pos[i * 3] - lo[0]) / cell) + ',' + Math.floor((p.pos[i * 3 + 1] - lo[1]) / cell) + ',' + Math.floor((p.pos[i * 3 + 2] - lo[2]) / cell);
        let j = ids.get(k); if (j === undefined) { j = cnt.length; ids.set(k, j); cnt.push(0); sum.push(0, 0, 0); }
        remap[i] = j; cnt[j]++; for (let c = 0; c < 3; c++) sum[j * 3 + c] += p.pos[i * 3 + c];
      }
      const idx: number[] = [];
      for (let t = 0; t < p.idx.length; t += 3) { const a = remap[p.idx[t]], b = remap[p.idx[t + 1]], c = remap[p.idx[t + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
      return { ...p, pos: sum.map((v, i) => v / cnt[Math.floor(i / 3)]), idx };
    });
    if (out.reduce((n, p) => n + p.idx.length / 3, 0) <= maxTriangles) return out;
  }
}

/** Guess the file's unit from the model's largest extent (in file units) for a tabletop piece. */
export function guessUnits(maxExtent: number, format: MeshFormat): { units: Units; scale: number } {
  if (format === 'glb' || format === 'gltf') return maxExtent * 1000 > 3000 ? { units: 'mm', scale: 1 } : { units: 'm', scale: 1000 }; // glTF is metres unless clearly authored in mm
  if (maxExtent < 0.5) return { units: 'm', scale: 1000 };
  if (maxExtent < 2.5) return { units: 'in', scale: 25.4 };
  if (maxExtent < 15) return { units: 'cm', scale: 10 };
  return { units: 'mm', scale: 1 };
}

export interface ConvertOptions { up?: 'auto' | 'y' | 'z'; heightMm?: number | null; maxTriangles?: number }
export interface Converted { parts: MeshPart[]; format: MeshFormat; units: Units; scale: number; triangles: number; sourceTriangles: number; decimated: boolean }

export function convertMesh(data: Uint8Array, opts: ConvertOptions = {}): Converted {
  const kind = sniffMesh(data);
  if (!kind) throw new MeshError('Not an STL, OBJ or glTF/GLB file');
  const format: MeshFormat = kind === 'stl-binary' || kind === 'stl-ascii' ? 'stl' : kind;
  let raw: RawPart[];
  try {
    raw = kind === 'stl-binary' ? stlBinary(data) : kind === 'stl-ascii' ? stlAscii(text(data)) : kind === 'obj' ? obj(text(data)) : kind === 'glb' ? glb(data) : gltf(JSON.parse(text(data)), null);
  } catch (e) { throw e instanceof MeshError ? e : new MeshError('Could not read the ' + format.toUpperCase() + ' file'); }
  raw = raw.filter((p) => p.idx.length >= 3);
  if (!raw.length) throw new MeshError('The file has no triangles');
  for (const p of raw) {
    const nv = p.pos.length / 3;
    if (!p.pos.every(Number.isFinite)) throw new MeshError('The file has invalid (NaN or infinite) coordinates');
    if (!p.idx.every((i) => Number.isInteger(i) && i >= 0 && i < nv)) throw new MeshError('A face points at a vertex that does not exist');
  }
  // to z-up: glTF and OBJ (Blender's default export) are y-up, STL is z-up
  const up = opts.up && opts.up !== 'auto' ? opts.up : format === 'stl' ? 'z' : 'y';
  if (up === 'y') for (const p of raw) for (let i = 0; i < p.pos.length; i += 3) { const y = p.pos[i + 1]; p.pos[i + 1] = -p.pos[i + 2]; p.pos[i + 2] = y; }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of raw) for (let i = 0; i < p.pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p.pos[i]); hi[i % 3] = Math.max(hi[i % 3], p.pos[i]); }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(extent > 0)) throw new MeshError('The model is flat or empty');
  let { units, scale } = guessUnits(extent, format);
  if (opts.heightMm) {
    if (!(hi[2] - lo[2] > 0)) throw new MeshError('The model has no height on the chosen up axis');
    units = 'custom'; scale = opts.heightMm / (hi[2] - lo[2]);
  }
  if (extent * scale > 1000) throw new MeshError('The model would be ' + Math.round(extent * scale) + ' mm across; set its height');
  const sourceTriangles = raw.reduce((n, p) => n + p.idx.length / 3, 0), max = opts.maxTriangles ?? MAX_UPLOAD_TRIANGLES;
  const decimated = sourceTriangles > max;
  const fit = decimated ? decimate(raw, max) : raw;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const parts: MeshPart[] = fit.map((p, k) => {
    const vertices: number[][] = [], triangles: number[][] = [];
    // centre on x/y, base on z = 0, in mm
    for (let i = 0; i < p.pos.length; i += 3) vertices.push([r2((p.pos[i] - (lo[0] + hi[0]) / 2) * scale), r2((p.pos[i + 1] - (lo[1] + hi[1]) / 2) * scale), r2((p.pos[i + 2] - lo[2]) * scale)]);
    for (let i = 0; i < p.idx.length; i += 3) triangles.push([p.idx[i], p.idx[i + 1], p.idx[i + 2]]);
    return { name: raw[k].name, color: raw[k].color, vertices, triangles };
  });
  return { parts, format, units, scale, triangles: parts.reduce((n, p) => n + p.triangles.length, 0), sourceTriangles, decimated };
}
