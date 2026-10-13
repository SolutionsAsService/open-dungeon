/**
 * Proof for docs/integration/miniatures-and-terrain.md: render a top-down token PNG (transparent background)
 * from a miniature package's viewer/<id>.parts.json, sized to the base footprint on a 1 in (= one 5 ft cell) grid.
 *
 *   npx tsx tools/miniatures/render-token.ts <parts.json> <out.png> [--px-per-cell 140] [--cells N] [--max-z mm]
 *
 * Orthographic view straight down the model's -z axis (model units mm, z up, base on z = 0), z-buffered,
 * Lambert-shaded with each part's colour, 2x supersampled. No dependencies beyond node:zlib.
 * --max-z cuts the model at a height (roof off), for building and wall tiles seen as a floor plan.
 * shortcut: flat colour shading, no shadows or materials; swap for a three.js/Blender render once the asset
 * pipeline runs in the miniature repos' CI (plan phase M1).
 */
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';

export const MM_PER_CELL = 25.4;

export interface Part { name: string; color?: string; vertices: number[][]; triangles: number[][] }
export interface RenderOpts { pxPerCell?: number; cells?: number; maxZ?: number; light?: [number, number, number] }

const GROUND_MM = 1; // vertices this close to the lowest z are the ground contact (base or terrain underside)
const SNAP_TOL_MM = 2; // same tolerance as miniature_terrain_grid_check
export interface Image { width: number; height: number; cells: number; rgba: Uint8Array }

const hex = (c = '#999999') => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) || 0);

/** Plan bounds of the ground contact (overhanging roofs, staffs and cloaks don't widen the footprint). */
function planBounds(parts: Part[]) {
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  let zMax = 0, zMin = Infinity;
  for (const p of parts) for (const v of p.vertices) { zMax = Math.max(zMax, v[2]); zMin = Math.min(zMin, v[2]); }
  for (const p of parts) for (const v of p.vertices) if (v[2] <= zMin + GROUND_MM) {
    for (const k of [0, 1]) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  }
  return { lo, hi, zMax };
}

/** Footprint in whole grid cells: the larger ground-contact dimension, rounded up past a 2 mm tolerance (min 1). */
export function footprintCells(parts: Part[]): number {
  const { lo, hi } = planBounds(parts);
  return Math.max(1, Math.ceil((Math.max(hi[0] - lo[0], hi[1] - lo[1]) - SNAP_TOL_MM) / MM_PER_CELL));
}

export function renderTopDown(parts: Part[], opts: RenderOpts = {}): Image {
  if (!Array.isArray(parts) || !parts.length) throw new Error('parts.json must be a non-empty array of parts');
  const cells = opts.cells ?? footprintCells(parts);
  const ppc = opts.pxPerCell ?? 140;
  const S = 2, W = cells * ppc, N = W * S; // supersampled canvas N x N
  const L = opts.light ?? [-0.35, 0.45, 0.82];
  const ln = Math.hypot(...L), light = L.map((v) => v / ln);
  const { lo, hi, zMax } = planBounds(parts);
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, k = (ppc * S) / MM_PER_CELL; // mm -> supersampled px
  const zbuf = new Float32Array(N * N).fill(-Infinity);
  const col = new Uint8ClampedArray(N * N * 3);
  for (const p of parts) {
    const base = hex(p.color);
    for (const t of p.triangles) {
      const [a, b, c] = t.map((i) => p.vertices[i]);
      if (!a || !b || !c) throw new Error('part ' + p.name + ': triangle index out of range');
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const nl = Math.hypot(n[0], n[1], n[2]); if (!nl) continue;
      const lambert = Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl); // two-sided: winding varies
      // screen: x right, image y down (model +y points up the image)
      const P = [a, b, c].map((v) => [(v[0] - cx) * k + N / 2, (cy - v[1]) * k + N / 2, v[2]]);
      const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(area) < 1e-9) continue; // vertical faces are invisible from above
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], i = y * N + x;
        if (z <= zbuf[i] || (opts.maxZ !== undefined && z > opts.maxZ)) continue;
        zbuf[i] = z;
        const shade = (0.3 + 0.7 * lambert) * (0.7 + 0.3 * (zMax ? Math.max(0, z) / zMax : 1)); // height cue reads depth
        for (let ch = 0; ch < 3; ch++) col[i * 3 + ch] = base[ch] * shade;
      }
    }
  }
  // box-filter down to W x W; alpha = coverage
  const rgba = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, cov = 0;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const i = (y * S + dy) * N + x * S + dx;
      if (zbuf[i] === -Infinity) continue;
      cov++; r += col[i * 3]; g += col[i * 3 + 1]; b += col[i * 3 + 2];
    }
    const o = (y * W + x) * 4;
    if (cov) { rgba[o] = r / cov; rgba[o + 1] = g / cov; rgba[o + 2] = b / cov; rgba[o + 3] = Math.round((255 * cov) / (S * S)); }
  }
  return { width: W, height: W, cells, rgba };
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Minimal RGBA8 PNG encoder (filter 0 on every row). */
export function encodePng(img: Pick<Image, 'width' | 'height' | 'rgba'>): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const row = img.width * 4, raw = Buffer.alloc((row + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && /render-token\.ts$/.test(process.argv[1])) {
  const [inp, out, ...rest] = process.argv.slice(2);
  if (!inp || !out) { console.error('usage: render-token.ts <parts.json> <out.png> [--px-per-cell 140] [--cells N] [--max-z mm]'); process.exit(2); }
  const flag = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? Number(rest[i + 1]) : undefined; };
  const img = renderTopDown(JSON.parse(fs.readFileSync(inp, 'utf8')), { pxPerCell: flag('--px-per-cell'), cells: flag('--cells'), maxZ: flag('--max-z') });
  fs.writeFileSync(out, encodePng(img));
  console.log(JSON.stringify({ out, width: img.width, height: img.height, cells: img.cells }));
}
