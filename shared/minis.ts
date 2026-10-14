/**
 * Physical scale and the miniature library for the 3D table (docs/decisions/0010-3d-scene.md).
 * One grid cell is one inch (25.4 mm) on the physical table, which is 5 ft at 28 mm heroic scale, so the
 * 3D scene works in millimetres and converts map pixels with the map's cellSize.
 */
import { z } from 'zod';
import { snapPoint, type GridConfig, type Point } from './grid';
import type { DrawingShape } from './protocol';

export const MM_PER_CELL = 25.4;

/** Millimetres per map pixel for a grid. */
export const mmPerPx = (g: Pick<GridConfig, 'cellSize'>) => MM_PER_CELL / g.cellSize;

/** Catalogue id of a miniature (miniature-viewer model id); tokens store it as miniId. */
export const MiniId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * Grid cells a base covers: 25, 32 and 40 mm bases (anything up to 42 mm) take one square; larger bases take
 * the nearest whole number of squares, at least 2 (50 mm = 2 x 2, 75 mm = 3 x 3, a 100 mm tower = 4 x 4).
 */
export function cellsForBase(mm: number): number {
  return mm <= 42 ? 1 : Math.max(2, Math.round(mm / MM_PER_CELL));
}

export interface MeshPart { name: string; color?: string; vertices: number[][]; triangles: number[][] }
const GROUND_MM = 1; // vertices this close to the lowest z are the ground contact (same rule as render-token.ts)

/** Ground-contact box of a z-up mm model: centre, size (larger side) and height. Overhangs don't widen it. */
export function groundFootprint(parts: MeshPart[]) {
  let zMin = Infinity, zMax = -Infinity;
  for (const p of parts) for (const v of p.vertices) { zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); }
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of parts) for (const v of p.vertices) if (v[2] <= zMin + GROUND_MM) for (const k of [0, 1]) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return { cx: (lo[0] + hi[0]) / 2, cy: (lo[1] + hi[1]) / 2, sizeMm: Math.max(hi[0] - lo[0], hi[1] - lo[1]), zMin, heightMm: zMax - zMin };
}

const Round = (n: number) => Math.round(n * 10) / 10;
export const MiniItem = z.object({
  id: MiniId,
  name: z.string().min(1).max(60),
  family: z.string().max(60).default(''),
  /** figure = a playing piece (token); scenery = terrain placed as a locked object token */
  kind: z.enum(['figure', 'scenery']),
  category: z.enum(['pc', 'npc', 'monster', 'object', 'generic']).default('npc'),
  footprintMm: z.number().positive().max(1000),
  cells: z.number().int().min(1).max(10),
  heightMm: z.number().positive().max(2000),
  /** parts mesh, relative to the library's meshes folder (public/minis/) */
  model: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,80}\.parts\.json$/),
  description: z.string().max(2000).default(''),
  source: z.object({ repo: z.string().max(120), path: z.string().max(120) }).optional(),
});
export type MiniItem = z.infer<typeof MiniItem>;
export const MiniLibrary = z.object({
  format: z.literal('open-dungeon.mini-library'),
  version: z.literal(1),
  name: z.string().max(80),
  items: z.array(MiniItem).max(2000),
});
export type MiniLibrary = z.infer<typeof MiniLibrary>;

export interface WallSeg { x1: number; y1: number; x2: number; y2: number; width: number }
/**
 * Wall segments (map px) for the 3D view from table drawings: lines (arrows are annotations, skipped), the four sides
 * of rectangles, and freehand paths thinned to steps of at least half a cell. Circles and text are not walls.
 * shortcut: there is no wall layer yet (roadmap walls/vision); switch to it when it exists.
 */
export function wallSegments(drawings: { shape: DrawingShape }[], cellSize: number, max = 3000): WallSeg[] {
  const out: WallSeg[] = [];
  const seg = (a: Point, b: Point, width: number) => { if (out.length < max && Math.hypot(b.x - a.x, b.y - a.y) > 1) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width }); };
  for (const { shape: s } of drawings) {
    if (s.kind === 'line' && !s.arrow) seg(s.from, s.to, s.width);
    else if (s.kind === 'rect') {
      const x0 = Math.min(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), x1 = Math.max(s.x, s.x + s.w), y1 = Math.max(s.y, s.y + s.h);
      const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      c.forEach((p, i) => seg(p, c[(i + 1) % 4], s.width));
    } else if (s.kind === 'path') {
      let last = s.points[0];
      s.points.forEach((p, i) => { if (Math.hypot(p.x - last.x, p.y - last.y) >= cellSize / 2 || (i === s.points.length - 1 && p !== last)) { seg(last, p, s.width); last = p; } });
    }
  }
  return out;
}

/** token.create for dropping a library item at a map point: snapped by footprint, scenery placed locked. */
export function placeMini(item: MiniItem, p: Point, grid: GridConfig) {
  const q = snapPoint(grid, p, item.cells);
  return {
    type: 'token.create' as const, name: item.name, category: item.category, color: item.kind === 'scenery' ? '#6b5a45' : '#c0392b',
    x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100, size: item.cells, miniId: item.id, locked: item.kind === 'scenery',
  };
}

/** Library entry for one miniature-viewer catalogue model and its parts mesh. */
export function libraryItem(model: { id: string; name: string; family?: string; description?: string }, parts: MeshPart[], source?: { repo: string; path: string }): MiniItem {
  const f = groundFootprint(parts);
  const scenery = /terrain|scatter|building|scenery/i.test(model.family ?? '');
  return MiniItem.parse({
    id: model.id, name: model.name.slice(0, 60), family: model.family ?? '', kind: scenery ? 'scenery' : 'figure', category: scenery ? 'object' : 'npc',
    footprintMm: Round(f.sizeMm), cells: cellsForBase(f.sizeMm), heightMm: Round(f.heightMm), model: model.id + '.parts.json',
    description: (model.description ?? '').slice(0, 2000), source,
  });
}
