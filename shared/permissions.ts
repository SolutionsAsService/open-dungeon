/**
 * Role and capability model. The server is the only place these checks are authoritative;
 * the client uses the same table only to hide controls the user can't use.
 */
import { z } from 'zod';

export const Role = z.enum(['owner', 'gm', 'assistant_gm', 'player', 'spectator']);
export type Role = z.infer<typeof Role>;

export type Capability =
  | 'campaign.manage' | 'campaign.invite' | 'session.manage'
  | 'map.edit' | 'token.create' | 'token.edit_any' | 'token.edit_owned' | 'token.see_hidden'
  | 'fog.edit' | 'fog.see_through' | 'initiative.manage' | 'dice.roll' | 'dice.roll_gm'
  | 'chat.send' | 'drawing.create' | 'drawing.create_gm' | 'notes.gm_read' | 'measure';

const GM: Capability[] = ['campaign.invite', 'session.manage', 'map.edit', 'token.create', 'token.edit_any', 'token.edit_owned', 'token.see_hidden', 'fog.edit', 'fog.see_through', 'initiative.manage', 'dice.roll', 'dice.roll_gm', 'chat.send', 'drawing.create', 'drawing.create_gm', 'notes.gm_read', 'measure'];

export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set<Capability>([...GM, 'campaign.manage']),
  gm: new Set<Capability>(GM),
  assistant_gm: new Set<Capability>(GM.filter((c) => c !== 'session.manage' && c !== 'campaign.invite')),
  player: new Set<Capability>(['token.edit_owned', 'dice.roll', 'chat.send', 'drawing.create', 'measure']),
  spectator: new Set<Capability>([]),
};

export function can(role: Role | null | undefined, cap: Capability): boolean {
  return !!role && ROLE_CAPABILITIES[role].has(cap);
}

export const isGmRole = (role: Role | null | undefined) => role === 'owner' || role === 'gm' || role === 'assistant_gm';

/** Can this user move/edit this token? Owners listed on the token may edit it if their role allows owned edits. */
export function canEditToken(role: Role | null | undefined, userId: string, token: { ownerIds: string[]; locked?: boolean }): boolean {
  if (can(role, 'token.edit_any')) return true;
  if (token.locked) return false;
  return can(role, 'token.edit_owned') && token.ownerIds.includes(userId);
}
