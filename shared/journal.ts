/**
 * Journals and handouts. A single entry type covers campaign/session notes, locations, NPCs, quests,
 * lore and handouts; `visibility` (+ `sharedWith`) decides who may read it. Bodies are plain text and are
 * always rendered as text (never HTML), so there is no rich-text injection surface.
 */
import { z } from 'zod';
import { isGmRole, type Role } from './permissions';

export const JournalKind = z.enum(['note', 'location', 'npc', 'quest', 'lore', 'handout']);
export type JournalKind = z.infer<typeof JournalKind>;
export const JournalVisibility = z.enum(['private', 'gm', 'players', 'all']);
export type JournalVisibility = z.infer<typeof JournalVisibility>;
export const JOURNAL_LIMITS = { title: 120, body: 20000, sharedWith: 50 } as const;

const Id = z.string().min(1).max(64);
export const JournalCreate = z.object({
  title: z.string().trim().min(1).max(JOURNAL_LIMITS.title),
  kind: JournalKind.default('note'),
  body: z.string().max(JOURNAL_LIMITS.body).default(''),
  imageAssetId: Id.nullable().optional(),
  visibility: JournalVisibility.optional(),
  sharedWith: z.array(Id).max(JOURNAL_LIMITS.sharedWith).optional(),
});
export type JournalCreate = z.infer<typeof JournalCreate>;
export const JournalUpdate = z.object({
  baseVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(JOURNAL_LIMITS.title).optional(),
  kind: JournalKind.optional(),
  body: z.string().max(JOURNAL_LIMITS.body).optional(),
  imageAssetId: Id.nullable().optional(),
  visibility: JournalVisibility.optional(),
  sharedWith: z.array(Id).max(JOURNAL_LIMITS.sharedWith).optional(),
});
export type JournalUpdate = z.infer<typeof JournalUpdate>;

export interface JournalView {
  id: string; campaignId: string; authorId: string | null; authorName: string | null; kind: JournalKind; title: string; body: string;
  imageAssetId: string | null; visibility: JournalVisibility; sharedWith: string[]; version: number; createdAt: string; updatedAt: string;
}

/** The single read rule, used for REST responses and for realtime fan-out. */
export function canReadEntry(role: Role | null | undefined, userId: string, e: { authorId: string | null; visibility: JournalVisibility; sharedWith: string[] }): boolean {
  if (!role) return false;
  if (e.authorId === userId) return true;
  switch (e.visibility) {
    case 'private': return false;
    case 'gm': return isGmRole(role);
    case 'players': return isGmRole(role) || e.sharedWith.includes(userId);
    case 'all': return true;
  }
}

/** Who may change an entry: its author, or any GM role for non-private entries. */
export function canEditEntry(role: Role | null | undefined, userId: string, e: { authorId: string | null; visibility: JournalVisibility }): boolean {
  if (!role) return false;
  if (e.authorId === userId) return role !== 'spectator';
  return isGmRole(role) && e.visibility !== 'private';
}

/** Players may only keep private notes; only GM roles can share entries or reveal handouts. */
export function canUseVisibility(role: Role | null | undefined, v: JournalVisibility): boolean {
  if (!role || role === 'spectator') return false;
  return isGmRole(role) || v === 'private';
}
