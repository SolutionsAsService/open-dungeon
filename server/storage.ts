/**
 * Object storage boundary. LocalDiskStorage keeps files under DATA_DIR/uploads with server-generated
 * keys only (no user-supplied paths). An S3-compatible implementation can replace it via the same interface.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Storage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer | null> }

export class LocalDiskStorage implements Storage {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw new Error('invalid storage key');
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer) { await fs.mkdir(this.dir, { recursive: true }); await fs.writeFile(this.file(key), data); }
  async get(key: string) { try { return await fs.readFile(this.file(key)); } catch { return null; } }
}

export class MemoryStorage implements Storage {
  private m = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.m.set(key, data); }
  async get(key: string) { return this.m.get(key) ?? null; }
}

export interface SniffedImage { mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; width: number | null; height: number | null }

/**
 * Identify an image by its magic bytes, never by filename or client Content-Type.
 * SVG is deliberately not accepted yet (it can carry script); see docs/architecture/security.md.
 */
export function sniffImage(b: Buffer): SniffedImage | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', width: null, height: null };
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { mime: 'image/webp', width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    return { mime: 'image/webp', width: null, height: null };
  }
  if (b.length >= 10 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  return null;
}
