import { describe, it, expect } from 'vitest';
import { can, canEditToken } from '../../shared/permissions';

describe('permissions', () => {
  it('gives GMs authority and players limited rights', () => {
    expect(can('gm', 'fog.edit')).toBe(true);
    expect(can('player', 'fog.edit')).toBe(false);
    expect(can('player', 'token.see_hidden')).toBe(false);
    expect(can('spectator', 'dice.roll')).toBe(false);
    expect(can('owner', 'campaign.manage')).toBe(true);
    expect(can('gm', 'campaign.manage')).toBe(false);
    expect(can(null, 'measure')).toBe(false);
  });
  it('lets players move only their own unlocked tokens', () => {
    const t = { ownerIds: ['u1'] };
    expect(canEditToken('player', 'u1', t)).toBe(true);
    expect(canEditToken('player', 'u2', t)).toBe(false);
    expect(canEditToken('player', 'u1', { ...t, locked: true })).toBe(false);
    expect(canEditToken('gm', 'u9', { ...t, locked: true })).toBe(true);
    expect(canEditToken('spectator', 'u1', t)).toBe(false);
  });
});
