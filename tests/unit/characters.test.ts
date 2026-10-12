import { describe, it, expect } from 'vitest';
import { validateSheetPatch, applySheetPatch, sheetFields, SheetError } from '../../shared/characters';
import { getRuleset, RULESETS } from '../../shared/rules/registry';

describe('character sheet validation', () => {
  const d20 = getRuleset('d20-fantasy');
  it('accepts values matching the ruleset field types', () => {
    const p = validateSheetPatch(d20, { level: 3, str: 16, features: 'Darkvision' });
    expect(p.set).toEqual({ level: 3, str: 16, features: 'Darkvision' });
    const story = getRuleset('stress-and-story');
    expect(validateSheetPatch(story, { stress: { value: 2, max: 9 } }).set.stress).toEqual({ value: 2, max: 9 });
    expect(validateSheetPatch(story, { stress: { value: 2 } }).set.stress).toEqual({ value: 2, max: null });
  });
  it('rejects unknown keys, wrong types and oversized values', () => {
    expect(() => validateSheetPatch(d20, { stress: 1 })).toThrow(SheetError); // field of another ruleset
    expect(() => validateSheetPatch(d20, { level: '3' })).toThrow(/number/);
    expect(() => validateSheetPatch(d20, { level: Infinity })).toThrow(SheetError);
    expect(() => validateSheetPatch(d20, { features: 'x'.repeat(10001) })).toThrow(/too long/);
    expect(() => validateSheetPatch(getRuleset('stress-and-story'), { stress: 3 })).toThrow(/value, max/);
    expect(() => validateSheetPatch(d20, { __proto__: 1, constructor: 2 } as any)).toThrow(SheetError);
  });
  it('null clears a field and patches merge', () => {
    const merged = applySheetPatch({ level: 1, str: 10 }, validateSheetPatch(d20, { level: 2, str: null }));
    expect(merged).toEqual({ level: 2 });
  });
  it('every ruleset sheet has unique keys', () => {
    for (const r of RULESETS) expect(sheetFields(r).size).toBe(r.sheet.sections.reduce((n, s) => n + s.fields.length, 0));
  });
});
