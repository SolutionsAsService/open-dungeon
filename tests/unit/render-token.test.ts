import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng, footprintCells, renderTopDown, type Part } from '../../tools/miniatures/render-token';
import { sniffImage } from '../../server/storage';

// square prism of half-size s and height h, centred on the origin
const box = (s: number, h: number, color: string): Part => {
  const v = [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [-s, -s, h], [s, -s, h], [s, s, h], [-s, s, h]];
  const t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { name: color, color, vertices: v, triangles: t };
};
// a 22 mm grey base (one 1 in cell) with a 10 mm red block on it
const parts = [box(11, 3, '#404040'), box(5, 10, '#ff0000')];

describe('top-down token render', () => {
  it('sizes to the footprint in 1 in cells', () => {
    expect(footprintCells(parts)).toBe(1);
    expect(footprintCells([box(25.4, 3, '#000000')])).toBe(2); // 50.8 mm square -> 2 cells
    expect(footprintCells([box(13, 3, '#000000')])).toBe(1); // 26 mm: within the 2 mm snap tolerance
    expect(footprintCells([box(14, 3, '#000000')])).toBe(2); // 28 mm: needs a second cell
    const roof = box(20, 2, '#000000'); roof.vertices = roof.vertices.map(([x, y, z]) => [x, y, z + 10]);
    expect(footprintCells([box(11, 3, '#404040'), roof])).toBe(1); // a 40 mm roof overhang doesn't widen the footprint
  });

  it('renders a transparent background with the top-most part on top', () => {
    const img = renderTopDown(parts, { pxPerCell: 64 });
    expect([img.width, img.height, img.cells]).toEqual([64, 64, 1]);
    const px = (x: number, y: number) => Array.from(img.rgba.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
    expect(px(32, 32)[3]).toBe(255);
    expect(px(32, 32)[0]).toBeGreaterThan(px(32, 32)[1] + 100); // red block seen from above, not the grey base
    expect(px(8, 32)[3]).toBe(255);
    expect(px(8, 32)[0]).toBeLessThan(80); // base rim is grey
    expect(px(2, 32)[3]).toBe(0); // 1.7 mm margin around a 22 mm base in a 25.4 mm cell
    expect(px(0, 0)[3]).toBe(0);
  });

  it('cuts the model at --max-z (roof off)', () => {
    const img = renderTopDown(parts, { pxPerCell: 64, maxZ: 5 });
    const c = (32 * 64 + 32) * 4;
    expect(img.rgba[c + 3]).toBe(255);
    expect(img.rgba[c]).toBeLessThan(80); // the red block's top (z 10) is cut away; the grey base shows
  });

  it('encodes a PNG the server upload path accepts', () => {
    const img = renderTopDown(parts, { pxPerCell: 32 });
    const png = encodePng(img);
    expect(sniffImage(png)).toEqual({ mime: 'image/png', width: 32, height: 32 });
    const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33))); // first chunk after IHDR is IDAT
    expect(raw.length).toBe(32 * (1 + 32 * 4));
    expect(raw[16 * 129 + 1 + 16 * 4]).toBe(img.rgba[(16 * 32 + 16) * 4]);
  });

  it('rejects bad input', () => {
    expect(() => renderTopDown([])).toThrow();
    expect(() => renderTopDown([{ name: 'x', vertices: [[0, 0, 0]], triangles: [[0, 1, 2]] }])).toThrow(/out of range/);
  });
});
