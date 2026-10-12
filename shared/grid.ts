/**
 * Grid geometry for the tabletop. Pure functions, no rendering and no ruleset logic.
 * Rulesets plug in movement costs through MovementPolicy (see shared/rules); this module
 * only answers geometric questions: which cell is this point in, where is that cell's
 * centre, and how far apart are two points in cells and in map units.
 */
import { z } from 'zod';

export const GridType = z.enum(['square', 'hex', 'none']);
export type GridType = z.infer<typeof GridType>;

/** How diagonal steps are counted on square grids. */
export const DiagonalRule = z.enum(['chebyshev', 'alternating', 'manhattan', 'euclidean']);
export type DiagonalRule = z.infer<typeof DiagonalRule>;

export const GridConfig = z.object({
  type: GridType.default('square'),
  /** Square: side length in world px. Hex: distance between opposite flat sides. Gridless: length of one unit step used for measurement. */
  cellSize: z.number().min(8).max(1024).default(70),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  hexOrientation: z.enum(['pointy', 'flat']).default('pointy'),
  /** Map units represented by one cell (or by cellSize px on gridless maps). */
  unitsPerCell: z.number().positive().max(1e6).default(5),
  unit: z.string().min(0).max(16).default('ft'),
  diagonal: DiagonalRule.default('chebyshev'),
  snap: z.boolean().default(true),
  visible: z.boolean().default(true),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  opacity: z.number().min(0).max(1).default(0.25),
});
export type GridConfig = z.infer<typeof GridConfig>;
export const defaultGrid = (): GridConfig => GridConfig.parse({});

export interface Point { x: number; y: number }
/** Square cells use (col,row); hex cells use axial (q,r). */
export interface Cell { a: number; b: number }

const SQRT3 = Math.sqrt(3);
const hexSize = (g: GridConfig) => g.cellSize / SQRT3; // centre-to-corner radius

function cubeRound(q: number, r: number): Cell {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { a: rq + 0, b: rr + 0 };
}

export function worldToCell(g: GridConfig, p: Point): Cell {
  const x = p.x - g.offsetX, y = p.y - g.offsetY;
  if (g.type === 'hex') {
    const size = hexSize(g);
    if (g.hexOrientation === 'pointy') {
      return cubeRound(((SQRT3 / 3) * x - (1 / 3) * y) / size, ((2 / 3) * y) / size);
    }
    return cubeRound(((2 / 3) * x) / size, ((-1 / 3) * x + (SQRT3 / 3) * y) / size);
  }
  return { a: Math.floor(x / g.cellSize), b: Math.floor(y / g.cellSize) };
}

export function cellCenter(g: GridConfig, c: Cell): Point {
  if (g.type === 'hex') {
    const size = hexSize(g);
    if (g.hexOrientation === 'pointy') {
      return { x: g.offsetX + size * (SQRT3 * c.a + (SQRT3 / 2) * c.b), y: g.offsetY + size * 1.5 * c.b };
    }
    return { x: g.offsetX + size * 1.5 * c.a, y: g.offsetY + size * ((SQRT3 / 2) * c.a + SQRT3 * c.b) };
  }
  return { x: g.offsetX + (c.a + 0.5) * g.cellSize, y: g.offsetY + (c.b + 0.5) * g.cellSize };
}

/** Corner points of a hex cell, for rendering. */
export function hexCorners(g: GridConfig, c: Cell): Point[] {
  const ctr = cellCenter(g, c), size = hexSize(g);
  const start = g.hexOrientation === 'pointy' ? 30 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const ang = ((start + 60 * i) * Math.PI) / 180;
    return { x: ctr.x + size * Math.cos(ang), y: ctr.y + size * Math.sin(ang) };
  });
}

/**
 * Snap a token position. 'footprint' is the token size in cells: odd sizes snap to cell centres,
 * even sizes (on square grids) snap to grid intersections so a 2x2 token covers 4 cells.
 */
export function snapPoint(g: GridConfig, p: Point, footprint = 1): Point {
  if (!g.snap || g.type === 'none') return { ...p };
  if (g.type === 'square' && footprint % 2 === 0) {
    const s = g.cellSize;
    return { x: g.offsetX + Math.round((p.x - g.offsetX) / s) * s, y: g.offsetY + Math.round((p.y - g.offsetY) / s) * s };
  }
  return cellCenter(g, worldToCell(g, p));
}

export function hexDistance(a: Cell, b: Cell): number {
  const dq = a.a - b.a, dr = a.b - b.b;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Distance in cells between two cells under the grid's diagonal rule. */
export function cellDistance(g: GridConfig, from: Cell, to: Cell): number {
  if (g.type === 'hex') return hexDistance(from, to);
  const dx = Math.abs(to.a - from.a), dy = Math.abs(to.b - from.b);
  switch (g.diagonal) {
    case 'manhattan': return dx + dy;
    case 'euclidean': return Math.hypot(dx, dy);
    case 'alternating': { const d = Math.min(dx, dy), s = Math.max(dx, dy) - d; return s + d + Math.floor(d / 2); }
    default: return Math.max(dx, dy);
  }
}

export interface Measurement { cells: number; units: number; label: string }

/** Measure between two world points. Gridless maps use calibrated straight-line distance. */
export function measure(g: GridConfig, a: Point, b: Point): Measurement {
  const cells = g.type === 'none'
    ? Math.hypot(b.x - a.x, b.y - a.y) / g.cellSize
    : cellDistance(g, worldToCell(g, a), worldToCell(g, b));
  const units = cells * g.unitsPerCell;
  return { cells, units, label: formatUnits(units, g.unit) };
}

/** Multi-segment path measurement: sum of segment measurements. */
export function measurePath(g: GridConfig, pts: Point[]): Measurement {
  let cells = 0;
  for (let i = 1; i < pts.length; i++) cells += measure(g, pts[i - 1], pts[i]).cells;
  const units = cells * g.unitsPerCell;
  return { cells, units, label: formatUnits(units, g.unit) };
}

export function formatUnits(v: number, unit: string): string {
  const r = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
  return unit ? r + ' ' + unit : r;
}
