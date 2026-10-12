import { describe, it, expect } from 'vitest';
import { isPointRevealed, shapeContains, type FogRegion } from '../../shared/fog';
import { Command } from '../../shared/protocol';

describe('fog of war', () => {
  const regions: FogRegion[] = [
    { id: 'a', mode: 'reveal', shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', mode: 'hide', shape: { kind: 'circle', x: 50, y: 50, r: 10 } },
  ];
  it('everything is visible when fog is disabled', () => {
    expect(isPointRevealed(false, [], { x: 999, y: 999 })).toBe(true);
  });
  it('fog conceals by default and applies regions in order', () => {
    expect(isPointRevealed(true, regions, { x: 500, y: 500 })).toBe(false);
    expect(isPointRevealed(true, regions, { x: 10, y: 10 })).toBe(true);
    expect(isPointRevealed(true, regions, { x: 50, y: 52 })).toBe(false);
  });
  it('polygon containment', () => {
    const tri = { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] };
    expect(shapeContains(tri, { x: 10, y: 10 })).toBe(true);
    expect(shapeContains(tri, { x: 80, y: 80 })).toBe(false);
  });
});

describe('protocol validation', () => {
  it('accepts valid commands and applies defaults', () => {
    const c = Command.parse({ type: 'token.create', x: 10, y: 20 });
    expect(c).toMatchObject({ category: 'generic', size: 1, hidden: false });
  });
  it('rejects unknown types, extra patch fields and absurd values', () => {
    expect(Command.safeParse({ type: 'session.delete_everything' }).success).toBe(false);
    expect(Command.safeParse({ type: 'token.update', id: 't', baseVersion: 1, patch: { mapId: 'other' } }).success).toBe(false);
    expect(Command.safeParse({ type: 'token.move', id: 't', x: 1e9, y: 0, baseVersion: 1 }).success).toBe(false);
    expect(Command.safeParse({ type: 'chat.send', body: '   ' }).success).toBe(false);
  });
});
