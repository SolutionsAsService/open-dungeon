import { describe, it, expect } from 'vitest';
import { parseDice, rollDice, DiceError, secureDie } from '../../shared/dice';

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('dice parser', () => {
  it('parses the documented examples', () => {
    for (const e of ['1d20', '2d6+3', '4d8', '1d20-2', '1d100', '2d20kh1', 'd20', 'd%', '4d6dl1', ' 3d6 + 1d4 - 2 ']) expect(() => parseDice(e)).not.toThrow();
    expect(parseDice('2d6+3')).toEqual([{ kind: 'dice', sign: 1, count: 2, sides: 6 }, { kind: 'const', sign: 1, value: 3 }]);
    expect(parseDice('d%')[0]).toMatchObject({ count: 1, sides: 100 });
  });
  it('rejects malformed or abusive input', () => {
    for (const e of ['', '1d', 'd', '2d6+', '1d20*2', 'alert(1)', '1d0', '0d6', '101d6', '1d10001', '60d6+60d6+60d6+60d6', '2d20kh3', '(1d6)', 'x'.repeat(300)]) {
      expect(() => parseDice(e), e).toThrow(DiceError);
    }
  });
});

describe('dice evaluation', () => {
  it('totals dice and modifiers', () => {
    const r = rollDice('2d6+3', seq([4, 5]));
    expect(r.total).toBe(12);
    expect(r.modifier).toBe(3);
    expect(r.terms[0]).toMatchObject({ rolls: [{ value: 4, kept: true }, { value: 5, kept: true }], subtotal: 9 });
  });
  it('handles subtraction', () => {
    expect(rollDice('1d20-2', seq([1])).total).toBe(-1);
  });
  it('keeps highest / lowest and drops', () => {
    expect(rollDice('2d20kh1', seq([7, 15])).total).toBe(15);
    expect(rollDice('2d20kl1', seq([7, 15])).total).toBe(7);
    const r = rollDice('4d6dl1', seq([3, 1, 6, 1]));
    expect(r.total).toBe(10);
    expect((r.terms[0] as any).rolls.filter((x: any) => !x.kept)).toHaveLength(1);
  });
  it('secure die stays in range and covers all faces', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { const v = secureDie(6); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); seen.add(v); }
    expect(seen.size).toBe(6);
  });
});
