import { describe, it, expect } from 'vitest';
import { convertMesh, sniffMesh, guessUnits, MeshError } from '../../shared/meshimport';
import { groundFootprint } from '../../shared/minis';

import { pyramid, binaryStl } from '../fixtures/meshes';
const asciiStl = (s: number, h: number) => {
  const { v, f } = pyramid(s, h);
  return new TextEncoder().encode('solid p\n' + f.map((t) => 'facet normal 0 0 0\nouter loop\n' + t.map((i) => 'vertex ' + v[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid p\n');
};

function glb(json: any, bin: Uint8Array) {
  const j = new TextEncoder().encode(JSON.stringify(json)), jl = Math.ceil(j.length / 4) * 4, bl = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jl + 8 + bl), dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('glTF')); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jl); out.set(j, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl);
  return out;
}

describe('bring-your-own figure conversion', () => {
  it('reads binary STL (even with a "solid" header) in mm, centred and standing on z = 0', () => {
    const b = binaryStl(12.5, 32);
    expect(sniffMesh(b)).toBe('stl-binary');
    const c = convertMesh(b);
    expect(c).toMatchObject({ format: 'stl', units: 'mm', triangles: 6, decimated: false });
    expect(c.parts[0].vertices).toHaveLength(5); // corners shared
    const f = groundFootprint(c.parts);
    expect(f).toMatchObject({ sizeMm: 25, heightMm: 32, zMin: 0, cx: 0, cy: 0 });
  });

  it('reads ASCII STL and guesses inches and metres from the size', () => {
    expect(sniffMesh(asciiStl(1, 1))).toBe('stl-ascii');
    const inch = convertMesh(asciiStl(0.5, 1.25));
    expect(inch.units).toBe('in');
    expect(groundFootprint(inch.parts).heightMm).toBeCloseTo(31.75, 1);
    expect(convertMesh(asciiStl(0.0125, 0.032)).units).toBe('m');
    expect(guessUnits(3.2, 'stl')).toEqual({ units: 'cm', scale: 10 });
    expect(guessUnits(0.03, 'glb')).toEqual({ units: 'm', scale: 1000 });
  });

  it('scales to a requested height', () => {
    const c = convertMesh(binaryStl(12.5, 32), { heightMm: 64 });
    expect(c.units).toBe('custom');
    expect(groundFootprint(c.parts)).toMatchObject({ heightMm: 64, sizeMm: 50 });
  });

  it('reads OBJ (y up, quads, negative and v/vt/vn indices)', () => {
    const src = ['# box', 'o thing', 'v -10 0 -10', 'v 10 0 -10', 'v 10 0 10', 'v -10 0 10', 'v 0 30 0', 'vt 0 0', 'f 1/1 2/1 3/1 4/1', 'f -5//1 -4//1 -1//1', 'f 2 3 5', 'f 3 4 5', 'f 4 1 5'].join('\n');
    const c = convertMesh(new TextEncoder().encode(src));
    expect(c).toMatchObject({ format: 'obj', triangles: 6, units: 'mm' });
    expect(groundFootprint(c.parts)).toMatchObject({ heightMm: 30, sizeMm: 20 }); // y-up became z-up
    expect(convertMesh(new TextEncoder().encode(src), { up: 'z' }).parts[0].vertices.every((v) => v[2] >= 0)).toBe(true);
  });

  it('reads GLB in metres with node transforms and material colours', () => {
    const { v, f } = pyramid(0.0125, 0.032);
    const yup = v.map(([x, y, z]) => [x, z, -y]); // glTF is y-up
    const pos = new Float32Array(yup.flat()), idx = new Uint16Array(f.flat());
    const bin = new Uint8Array(pos.byteLength + idx.byteLength); bin.set(new Uint8Array(pos.buffer)); bin.set(new Uint8Array(idx.buffer), pos.byteLength);
    const json = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ children: [1], scale: [2, 2, 2] }, { mesh: 0, translation: [5, 5, 5] }],
      meshes: [{ name: 'Knight', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 5, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 18, type: 'SCALAR' }],
    };
    const c = convertMesh(glb(json, bin));
    expect(c).toMatchObject({ format: 'glb', units: 'm', triangles: 6 });
    expect(c.parts[0]).toMatchObject({ name: 'Knight', color: '#ff0000' });
    expect(groundFootprint(c.parts)).toMatchObject({ heightMm: 64, sizeMm: 50 }); // parent scale 2 applied
  });

  it('rejects junk, NaN coordinates, bad indices and compressed glTF', () => {
    expect(() => convertMesh(new TextEncoder().encode('hello world'))).toThrow(MeshError);
    expect(() => convertMesh(new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv nan 1 0\nf 1 2 3'))).toThrow(/NaN/);
    expect(() => convertMesh(new TextEncoder().encode('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 9'))).toThrow(/does not exist/);
    expect(() => convertMesh(new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] })))).toThrow(/extension/);
    expect(() => convertMesh(new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin' }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [] }] })))).toThrow(/no triangles|External/);
  });

  it('decimates meshes over the triangle budget', () => {
    // a 60 x 60 height field (7200 triangles) squeezed under 1000
    const N = 60, v: string[] = [], f: string[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) v.push('v ' + i + ' ' + j + ' ' + (5 + Math.sin(i / 5) * Math.cos(j / 7) * 4));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j + 1; f.push('f ' + a + ' ' + (a + N + 1) + ' ' + (a + 1), 'f ' + (a + 1) + ' ' + (a + N + 1) + ' ' + (a + N + 2)); }
    const c = convertMesh(new TextEncoder().encode(v.concat(f).join('\n')), { up: 'z', maxTriangles: 1000 });
    expect(c.sourceTriangles).toBe(7200);
    expect(c.decimated).toBe(true);
    expect(c.triangles).toBeLessThanOrEqual(1000);
    expect(c.triangles).toBeGreaterThan(100);
    expect(c.parts[0].vertices.flat().every(Number.isFinite)).toBe(true);
  });
});
