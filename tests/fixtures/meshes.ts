/** Test meshes: a square pyramid (base +-s, apex at height h, z up) as a binary STL. */
export const pyramid = (s: number, h: number) => ({ v: [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [0, 0, h]], f: [[0, 2, 1], [0, 3, 2], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] });

export function binaryStl(s = 12.5, h = 32) {
  const { v, f } = pyramid(s, h), b = new Uint8Array(84 + 50 * f.length), dv = new DataView(b.buffer);
  new TextEncoder().encodeInto('solid but actually binary', b); // binary STL headers may start with "solid"
  dv.setUint32(80, f.length, true);
  f.forEach((t, i) => t.forEach((vi, c) => v[vi].forEach((x, k) => dv.setFloat32(84 + i * 50 + 12 + c * 12 + k * 4, x, true))));
  return b;
}
