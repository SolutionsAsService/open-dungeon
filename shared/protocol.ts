/**
 * Realtime protocol. Every client command is validated with these schemas on the server,
 * then authorized against the sender's campaign role before anything is persisted.
 * See docs/architecture/realtime-protocol.md.
 */
import { z } from 'zod';
import { GridConfig } from './grid';
import { FogShape } from './fog';
import type { JournalView } from './journal';

const Id = z.string().min(1).max(64);
const Coord = z.number().finite().min(-100000).max(100000);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const TokenCategory = z.enum(['pc', 'npc', 'monster', 'ally', 'enemy', 'summon', 'vehicle', 'object', 'marker', 'generic']);
export const Visibility = z.enum(['public', 'gm', 'self']);
export type Visibility = z.infer<typeof Visibility>;

export const TokenPatch = z.object({
  name: z.string().max(60).optional(),
  category: TokenCategory.optional(),
  color: Color.optional(),
  rotation: z.number().finite().min(-360).max(720).optional(),
  size: z.number().min(0.25).max(10).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  ownerIds: z.array(Id).max(16).optional(),
  hp: z.number().int().min(-100000).max(100000).nullable().optional(),
  hpMax: z.number().int().min(0).max(100000).nullable().optional(),
  conditions: z.array(z.string().min(1).max(32)).max(20).optional(),
  assetId: Id.nullable().optional(),
  characterId: Id.nullable().optional(),
}).strict();
export type TokenPatch = z.infer<typeof TokenPatch>;

export const DrawingShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), points: z.array(z.object({ x: Coord, y: Coord })).min(2).max(2000), color: Color, width: z.number().min(1).max(64) }),
  z.object({ kind: z.literal('line'), from: z.object({ x: Coord, y: Coord }), to: z.object({ x: Coord, y: Coord }), color: Color, width: z.number().min(1).max(64), arrow: z.boolean().optional() }),
  z.object({ kind: z.literal('rect'), x: Coord, y: Coord, w: z.number().max(1e5), h: z.number().max(1e5), color: Color, width: z.number().min(1).max(64) }),
  z.object({ kind: z.literal('circle'), x: Coord, y: Coord, r: z.number().positive().max(1e5), color: Color, width: z.number().min(1).max(64) }),
  z.object({ kind: z.literal('text'), x: Coord, y: Coord, text: z.string().min(1).max(200), color: Color, size: z.number().min(8).max(128) }),
]);
export type DrawingShape = z.infer<typeof DrawingShape>;

export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token.create'), name: z.string().max(60).default(''), category: TokenCategory.default('generic'), color: Color.default('#c0392b'), x: Coord, y: Coord, size: z.number().min(0.25).max(10).default(1), hidden: z.boolean().default(false), ownerIds: z.array(Id).max(16).default([]), assetId: Id.nullable().default(null) }),
  z.object({ type: z.literal('token.move'), id: Id, x: Coord, y: Coord, baseVersion: z.number().int().min(1) }),
  z.object({ type: z.literal('token.update'), id: Id, patch: TokenPatch, baseVersion: z.number().int().min(1) }),
  z.object({ type: z.literal('token.delete'), id: Id }),
  z.object({ type: z.literal('map.update'), name: z.string().min(1).max(80).optional(), width: z.number().int().min(100).max(20000).optional(), height: z.number().int().min(100).max(20000).optional(), grid: GridConfig.partial().optional(), fogEnabled: z.boolean().optional() }),
  z.object({ type: z.literal('fog.add'), mode: z.enum(['reveal', 'hide']), shape: FogShape }),
  z.object({ type: z.literal('fog.reset'), enabled: z.boolean() }),
  z.object({ type: z.literal('drawing.add'), shape: DrawingShape, gmOnly: z.boolean().default(false), ttlSeconds: z.number().int().min(1).max(86400).optional() }),
  z.object({ type: z.literal('drawing.delete'), id: Id }),
  z.object({ type: z.literal('drawing.clear') }),
  z.object({ type: z.literal('dice.roll'), expression: z.string().min(1).max(200), visibility: Visibility.default('public'), label: z.string().max(60).optional() }),
  z.object({ type: z.literal('chat.send'), body: z.string().trim().min(1).max(2000), visibility: Visibility.default('public') }),
  z.object({ type: z.literal('init.add'), tokenId: Id.nullable().default(null), name: z.string().min(1).max(60), initiative: z.number().finite().nullable().default(null), rollExpression: z.string().max(60).optional(), hidden: z.boolean().default(false) }),
  z.object({ type: z.literal('init.update'), id: Id, initiative: z.number().finite().nullable().optional(), rollExpression: z.string().max(60).optional(), name: z.string().min(1).max(60).optional(), hidden: z.boolean().optional() }),
  z.object({ type: z.literal('init.remove'), id: Id }),
  z.object({ type: z.literal('init.advance'), dir: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ type: z.literal('init.reset') }),
  z.object({ type: z.literal('ping'), x: Coord, y: Coord }),
]);
export type Command = z.infer<typeof Command>;

export const ClientMessage = z.object({ cid: z.string().min(1).max(64), cmd: Command });
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- Server → client payloads ----
export interface TokenView {
  id: string; mapId: string; name: string; category: string; assetId: string | null; color: string;
  x: number; y: number; rotation: number; size: number; hidden: boolean; locked: boolean;
  ownerIds: string[]; hp: number | null; hpMax: number | null; conditions: string[]; characterId: string | null; version: number;
}
export interface MapView { id: string; name: string; backgroundAssetId: string | null; width: number; height: number; grid: z.infer<typeof GridConfig>; fogEnabled: boolean; version: number }
export interface FogRegionView { id: string; mode: 'reveal' | 'hide'; shape: z.infer<typeof FogShape> }
export interface DrawingView { id: string; authorId: string; gmOnly: boolean; shape: DrawingShape; expiresAt: string | null }
export interface DieTermView { kind: string; sign: number; count?: number; sides?: number; value?: number; rolls?: { value: number; kept: boolean }[]; subtotal: number }
export interface ChatView { id: string; userId: string | null; userName: string; kind: 'text' | 'roll' | 'system'; body: string; visibility: Visibility; createdAt: string; roll?: { expression: string; total: number; terms: DieTermView[]; label?: string } }
export interface InitiativeView { round: number; turnIndex: number; active: boolean; activeId: string | null; participants: { id: string; tokenId: string | null; name: string; initiative: number | null; hidden: boolean }[] }
export interface MemberView { userId: string; displayName: string; role: string; online: boolean }
export interface SessionSnapshot {
  seq: number;
  me: { id: string; displayName: string; role: string };
  session: { id: string; name: string; status: string; campaignId: string; campaignName: string; rulesetId: string };
  members: MemberView[];
  map: MapView | null;
  tokens: TokenView[];
  fog: FogRegionView[];
  drawings: DrawingView[];
  initiative: InitiativeView;
  chat: ChatView[];
}

export type ServerMessage =
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'ack'; cid: string; ok: true; seq: number }
  | { type: 'ack'; cid: string; ok: false; error: string; code: 'invalid' | 'forbidden' | 'stale' | 'not_found' | 'rate_limited' | 'closed'; current?: TokenView }
  | { type: 'event'; seq: number; event: ServerEvent };

export type ServerEvent =
  | { type: 'token.upsert'; token: TokenView }
  | { type: 'token.remove'; id: string }
  | { type: 'map.updated'; map: MapView }
  | { type: 'fog.updated'; fog: FogRegionView[]; fogEnabled: boolean }
  | { type: 'drawing.added'; drawing: DrawingView }
  | { type: 'drawing.removed'; ids: string[] }
  | { type: 'chat.message'; message: ChatView }
  | { type: 'initiative.updated'; initiative: InitiativeView }
  | { type: 'presence'; members: MemberView[] }
  | { type: 'ping'; x: number; y: number; userId: string; color: string }
  | { type: 'session.status'; status: string }
  /** Campaign-level (not part of the session's seq order; delivered with seq 0), filtered per recipient. */
  | { type: 'journal.upsert'; entry: JournalView }
  | { type: 'journal.remove'; id: string };
