import { describe, it, expect } from 'vitest';
import { mmPerPx, cellsForBase, groundFootprint, libraryItem, MiniLibrary, MM_PER_CELL, type MeshPart } from '../../shared/minis';

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
