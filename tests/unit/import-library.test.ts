import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importLibrary } from '../../tools/miniatures/import-library';
import { MiniLibrary } from '../../shared/minis';

const box = (s: number, h: number) => ({ vertices: [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [0, 0, h]], triangles: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] });

describe('miniature library import', () => {
  it('copies only mesh fields and writes a valid index from a viewer catalogue', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-lib-'));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.mkdirSync(path.join(dir, 'm'));
    fs.writeFileSync(path.join(dir, 'm', 'a.parts.json'), JSON.stringify([{ name: 'Figure', color: '#123456', printStl: 'print/x.stl', note: 'n', explode: [0, 0, 1], ...box(12.5, 40) }]));
    fs.writeFileSync(path.join(dir, 'data', 'catalog.json'), JSON.stringify({ lines: [{ id: 'fantasy', repo: 'Org/fantasy' }], models: [
      { id: 'knight', name: 'Knight', family: 'Heroes', line: 'fantasy', model: { format: 'parts', url: './m/a.parts.json' } },
      { id: 'cottage', name: 'Cottage', family: 'Buildings', model: { format: 'stl', url: './m/c.stl' } },
    ] }));
    const lib = importLibrary(dir, path.join(dir, 'out'), path.join(dir, 'out', 'library.json'));
    expect(lib.items).toHaveLength(1); // non-parts models are skipped
    expect(lib.items[0]).toMatchObject({ id: 'knight', kind: 'figure', cells: 1, heightMm: 40, source: { repo: 'Org/fantasy', path: 'knight' } });
    const mesh = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'knight.parts.json'), 'utf8'));
    expect(Object.keys(mesh[0]).sort()).toEqual(['color', 'name', 'triangles', 'vertices']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the bundled libraries validate and every mesh they name is in public/minis', () => {
    // library.json (imported from the private viewer) is git-ignored; the sample library always ships
    for (const f of ['web/src/minis/library.sample.json', 'web/src/minis/library.json'].filter((f) => fs.existsSync(f))) {
      const lib = MiniLibrary.parse(JSON.parse(fs.readFileSync(f, 'utf8')));
      expect(lib.items.length).toBeGreaterThan(0);
      for (const i of lib.items) expect(fs.existsSync(path.join('public/minis', i.model))).toBe(true);
    }
  });
});

describe('placing a library mini', () => {
  it('snaps by footprint and locks scenery', async () => {
    const { placeMini } = await import('../../shared/minis');
    const { GridConfig } = await import('../../shared/grid');
    const g = GridConfig.parse({});
    const { libraryItem } = await import('../../shared/minis');
    const fig = libraryItem({ id: 'hooded-wanderer', name: 'Hooded Wanderer', family: 'Heroes' }, [{ name: 'f', ...box(12.5, 40) }]);
    const well = libraryItem({ id: 'village-well', name: 'Village Well', family: 'Terrain & Scatter' }, [{ name: 'w', ...box(25, 50) }]);
    expect(placeMini(fig, { x: 100, y: 100 }, g)).toMatchObject({ x: 105, y: 105, size: 1, miniId: 'hooded-wanderer', locked: false });
    expect(placeMini(well, { x: 150, y: 120 }, g)).toMatchObject({ x: 140, y: 140, size: 2, locked: true, category: 'object' }); // 2x2 snaps to a grid corner
  });
});
