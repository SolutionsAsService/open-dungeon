import { describe, it, expect } from 'vitest';
import { GridConfig, worldToCell, cellCenter, snapPoint, measure, measurePath, cellDistance, hexDistance } from '../../shared/grid';

const sq = (o: Partial<GridConfig> = {}) => GridConfig.parse({ type: 'square', cellSize: 50, ...o });
const hex = (o: Partial<GridConfig> = {}) => GridConfig.parse({ type: 'hex', cellSize: 60, ...o });

describe('square grid', () => {
  it('converts world points to cells and back', () => {
    const g = sq();
    expect(worldToCell(g, { x: 0, y: 0 })).toEqual({ a: 0, b: 0 });
    expect(worldToCell(g, { x: 74, y: 101 })).toEqual({ a: 1, b: 2 });
    expect(worldToCell(g, { x: -1, y: -1 })).toEqual({ a: -1, b: -1 });
    expect(cellCenter(g, { a: 1, b: 2 })).toEqual({ x: 75, y: 125 });
  });
  it('respects grid offset', () => {
    const g = sq({ offsetX: 10, offsetY: 20 });
    expect(worldToCell(g, { x: 9, y: 25 })).toEqual({ a: -1, b: 0 });
    expect(cellCenter(g, { a: 0, b: 0 })).toEqual({ x: 35, y: 45 });
  });
  it('snaps odd footprints to centres and even to intersections', () => {
    const g = sq();
    expect(snapPoint(g, { x: 61, y: 12 })).toEqual({ x: 75, y: 25 });
    expect(snapPoint(g, { x: 61, y: 12 }, 2)).toEqual({ x: 50, y: 0 });
    expect(snapPoint(sq({ snap: false }), { x: 61, y: 12 })).toEqual({ x: 61, y: 12 });
  });
  it('applies diagonal rules', () => {
    const a = { a: 0, b: 0 }, b = { a: 3, b: 2 };
    expect(cellDistance(sq({ diagonal: 'chebyshev' }), a, b)).toBe(3);
    expect(cellDistance(sq({ diagonal: 'manhattan' }), a, b)).toBe(5);
    expect(cellDistance(sq({ diagonal: 'alternating' }), a, b)).toBe(4); // 1 straight + 2 diag (1 + 2)
    expect(cellDistance(sq({ diagonal: 'euclidean' }), a, b)).toBeCloseTo(Math.hypot(3, 2));
  });
  it('measures in configured units, not assuming 5 ft', () => {
    const g = sq({ unitsPerCell: 1.5, unit: 'm' });
    const m = measure(g, { x: 25, y: 25 }, { x: 225, y: 25 });
    expect(m.cells).toBe(4);
    expect(m.units).toBe(6);
    expect(m.label).toBe('6 m');
  });
  it('sums multi-segment paths', () => {
    const g = sq();
    expect(measurePath(g, [{ x: 25, y: 25 }, { x: 125, y: 25 }, { x: 125, y: 125 }]).cells).toBe(4);
  });
});

describe('hex grid', () => {
  for (const hexOrientation of ['pointy', 'flat'] as const) {
    it(hexOrientation + ': cell centre round-trips through worldToCell', () => {
      const g = hex({ hexOrientation });
      for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
        const c = cellCenter(g, { a: q, b: r });
        expect(worldToCell(g, c)).toEqual({ a: q, b: r });
        expect(worldToCell(g, { x: c.x + 5, y: c.y - 5 })).toEqual({ a: q, b: r });
      }
    });
    it(hexOrientation + ': adjacent cell centres are cellSize apart', () => {
      const g = hex({ hexOrientation });
      const a = cellCenter(g, { a: 0, b: 0 }), b = cellCenter(g, { a: 1, b: 0 });
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(60);
    });
  }
  it('computes hex distance', () => {
    expect(hexDistance({ a: 0, b: 0 }, { a: 2, b: -1 })).toBe(2);
    expect(hexDistance({ a: 0, b: 0 }, { a: -3, b: 3 })).toBe(3);
    expect(measure(hex({ unitsPerCell: 1, unit: 'hex' }), cellCenter(hex(), { a: 0, b: 0 }), cellCenter(hex(), { a: 3, b: 0 })).label).toBe('3 hex');
  });
});

describe('gridless', () => {
  it('measures straight-line distance calibrated by cellSize', () => {
    const g = GridConfig.parse({ type: 'none', cellSize: 100, unitsPerCell: 10, unit: 'yd' });
    const m = measure(g, { x: 0, y: 0 }, { x: 300, y: 400 });
    expect(m.cells).toBe(5);
    expect(m.label).toBe('50 yd');
    expect(snapPoint(g, { x: 13, y: 7 })).toEqual({ x: 13, y: 7 });
  });
});
