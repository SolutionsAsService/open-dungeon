import { describe, it, expect } from 'vitest';
import { wallSegments, mmPerPx, cellsForBase, groundFootprint, libraryItem, MiniLibrary, MM_PER_CELL, type MeshPart } from '../../shared/minis';

// a box from (x0,y0,0) to (x1,y1,h) as a minimal z-up mesh
const box = (x0: number, y0: number, x1: number, y1: number, h: number, z0 = 0): MeshPart => ({
  name: 'box', color: '#888888',
  vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0 + h], [x1, y0, z0 + h], [x1, y1, z0 + h], [x0, y1, z0 + h]],
  triangles: [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
});

describe('3D scale', () => {
  it('one grid cell is one inch whatever the cell size in px', () => {
    expect(mmPerPx({ cellSize: 70 }) * 70).toBeCloseTo(MM_PER_CELL);
    expect(mmPerPx({ cellSize: 140 }) * 140 * 3).toBeCloseTo(76.2);
  });
  it('25/32/40 mm bases take one square, larger bases at least 2 x 2', () => {
    expect([25, 32, 40, 42].map(cellsForBase)).toEqual([1, 1, 1, 1]);
    expect([50, 60, 75, 80.4, 100].map(cellsForBase)).toEqual([2, 2, 3, 3, 4]);
  });
});

describe('3D walls from drawings', () => {
  it('extrudes lines, rectangle sides and thinned paths; skips arrows, circles and text', () => {
    const segs = wallSegments([
      { shape: { kind: 'line', from: { x: 0, y: 0 }, to: { x: 140, y: 0 }, color: '#ffffff', width: 6 } },
      { shape: { kind: 'line', from: { x: 0, y: 0 }, to: { x: 70, y: 70 }, color: '#ffffff', width: 4, arrow: true } },
      { shape: { kind: 'rect', x: 210, y: 210, w: -70, h: 140, color: '#ffffff', width: 4 } },
      { shape: { kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 45, y: 0 }], color: '#ffffff', width: 4 } },
      { shape: { kind: 'circle', x: 0, y: 0, r: 30, color: '#ffffff', width: 4 } },
      { shape: { kind: 'text', x: 0, y: 0, text: 'hi', color: '#ffffff', size: 16 } },
    ], 70);
    expect(segs).toHaveLength(1 + 4 + 2);
    expect(segs[1]).toEqual({ x1: 140, y1: 210, x2: 210, y2: 210, width: 4 }); // normalised negative-width rect
    expect(segs.slice(5).map((s) => [s.x1, s.x2])).toEqual([[0, 40], [40, 45]]);
    expect(wallSegments([{ shape: { kind: 'rect', x: 0, y: 0, w: 70, h: 70, color: '#ffffff', width: 4 } }], 70, 3)).toHaveLength(3);
  });
});

describe('miniature library', () => {
  it('footprint is the ground contact, not overhangs, and height spans the model', () => {
    const f = groundFootprint([box(-12.5, -12.5, 12.5, 12.5, 3), box(-30, -5, 30, 5, 2, 40)]); // base + a wide staff/cloak up high
    expect(f.sizeMm).toBeCloseTo(25);
    expect(f.heightMm).toBeCloseTo(42);
    expect([f.cx, f.cy]).toEqual([0, 0]);
  });
  it('maps catalogue families to figure or scenery and validates', () => {
    const fig = libraryItem({ id: 'hooded-wanderer', name: 'Hooded Wanderer', family: 'Heroes' }, [box(-12.5, -12.5, 12.5, 12.5, 40)]);
    expect(fig).toMatchObject({ kind: 'figure', category: 'npc', cells: 1, model: 'hooded-wanderer.parts.json' });
    const well = libraryItem({ id: 'village-well', name: 'Village Well', family: 'Terrain & Scatter' }, [box(-25, -25, 25, 25, 50)]);
    expect(well).toMatchObject({ kind: 'scenery', category: 'object', cells: 2 });
    expect(MiniLibrary.safeParse({ format: 'open-dungeon.mini-library', version: 1, name: 'x', items: [fig, well] }).success).toBe(true);
    expect(() => libraryItem({ id: '../etc', name: 'x' }, [box(0, 0, 1, 1, 1)])).toThrow();
  });
});
