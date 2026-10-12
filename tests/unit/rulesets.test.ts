import { describe, it, expect } from 'vitest';
import { RULESETS, getRuleset } from '../../shared/rules/registry';
import { defineRuleset } from '../../shared/rules/types';
import { parseDice } from '../../shared/dice';
import { GridConfig } from '../../shared/grid';

describe('rulesets', () => {
  it('every registered ruleset has valid presets and grid defaults', () => {
    for (const r of RULESETS) {
      for (const p of r.rollPresets) expect(() => parseDice(p.expression), r.manifest.id + ' ' + p.expression).not.toThrow();
      if (r.encounter?.initiativeFormula) expect(() => parseDice(r.encounter!.initiativeFormula!)).not.toThrow();
      expect(() => GridConfig.parse({ unitsPerCell: r.distance.unitsPerCell, unit: r.distance.unit, diagonal: r.distance.diagonal })).not.toThrow();
    }
  });
  it('unknown ids fall back to generic', () => { expect(getRuleset('nope').manifest.id).toBe('generic'); });
  it('rejects malformed modules', () => {
    const base = getRuleset('generic');
    expect(() => defineRuleset({ ...base, manifest: { ...base.manifest, id: 'Bad Id' } })).toThrow();
    expect(() => defineRuleset({ ...base, conditions: [base.conditions[0], base.conditions[0]] })).toThrow();
  });
  it('supports systems without initiative or hit points', () => {
    const s = getRuleset('stress-and-story');
    expect(s.encounter).toBeNull();
    expect(s.manifest.capabilities.health).toBe(false);
  });
});
