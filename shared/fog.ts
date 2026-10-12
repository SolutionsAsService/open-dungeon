/**
 * Manual fog of war. A map with fog enabled starts fully concealed; regions are applied in order,
 * so a later 'hide' can re-conceal part of an earlier 'reveal'. The same function decides
 * server-side which tokens a player may receive, so hidden areas never leak token data.
 */
import { z } from 'zod';
import type { Point } from './grid';

const Num = z.number().finite().min(-1e6).max(1e6);
export const FogShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), x: Num, y: Num, w: z.number().positive().max(1e6), h: z.number().positive().max(1e6) }),
  z.object({ kind: z.literal('circle'), x: Num, y: Num, r: z.number().positive().max(1e6) }),
  z.object({ kind: z.literal('polygon'), points: z.array(z.object({ x: Num, y: Num })).min(3).max(500) }),
]);
export type FogShape = z.infer<typeof FogShape>;
export interface FogRegion { id: string; mode: 'reveal' | 'hide'; shape: FogShape }

export function shapeContains(s: FogShape, p: Point): boolean {
  switch (s.kind) {
    case 'rect': return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    case 'circle': return (p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= s.r * s.r;
    case 'polygon': {
      let inside = false;
      const pts = s.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
  }
}

export function isPointRevealed(fogEnabled: boolean, regions: FogRegion[], p: Point): boolean {
  if (!fogEnabled) return true;
  let revealed = false;
  for (const r of regions) if (shapeContains(r.shape, p)) revealed = r.mode === 'reveal';
  return revealed;
}
