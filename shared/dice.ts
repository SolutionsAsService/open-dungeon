/**
 * Constrained dice-expression parser and evaluator. Never uses eval.
 * Grammar:  expr := term (('+'|'-') term)*
 *           term := dice | int
 *           dice := [count] 'd' (sides | '%') [('kh'|'kl'|'dh'|'dl'|'k') int]
 * Examples: 1d20, 2d6+3, 4d8, 1d20-2, 1d100, d%, 2d20kh1, 4d6dl1
 */
export const DICE_LIMITS = { maxLength: 200, maxTerms: 20, maxDicePerTerm: 100, maxTotalDice: 200, maxSides: 10000, maxConstant: 1_000_000 } as const;

export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';
export type Term =
  | { kind: 'dice'; sign: 1 | -1; count: number; sides: number; keep?: { mode: KeepMode; n: number } }
  | { kind: 'const'; sign: 1 | -1; value: number };

export interface DieResult { value: number; kept: boolean }
export type TermResult =
  | (Extract<Term, { kind: 'dice' }> & { rolls: DieResult[]; subtotal: number })
  | (Extract<Term, { kind: 'const' }> & { subtotal: number });
export interface RollResult { expression: string; terms: TermResult[]; total: number; modifier: number }

export class DiceError extends Error {}

export function parseDice(input: string): Term[] {
  if (typeof input !== 'string') throw new DiceError('Expression must be text');
  const src = input.replace(/\s+/g, '').toLowerCase();
  if (!src) throw new DiceError('Empty expression');
  if (src.length > DICE_LIMITS.maxLength) throw new DiceError('Expression is too long');
  let i = 0;
  const terms: Term[] = [];
  let totalDice = 0;
  const readInt = (): number | null => {
    const m = /^\d{1,7}/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseInt(m[0], 10);
  };
  let sign: 1 | -1 = 1;
  if (src[i] === '+' || src[i] === '-') { sign = src[i] === '-' ? -1 : 1; i++; }
  for (;;) {
    const n = readInt();
    if (src[i] === 'd') {
      i++;
      const count = n ?? 1;
      let sides: number | null;
      if (src[i] === '%') { i++; sides = 100; } else sides = readInt();
      if (sides === null) throw new DiceError('Missing number of sides at position ' + (i + 1));
      if (count < 1 || count > DICE_LIMITS.maxDicePerTerm) throw new DiceError('Dice count must be 1-' + DICE_LIMITS.maxDicePerTerm);
      if (sides < 1 || sides > DICE_LIMITS.maxSides) throw new DiceError('Dice sides must be 1-' + DICE_LIMITS.maxSides);
      const term: Term = { kind: 'dice', sign, count, sides };
      const km = /^(kh|kl|dh|dl|k)/.exec(src.slice(i));
      if (km) {
        i += km[0].length;
        const kn = readInt();
        if (kn === null) throw new DiceError('Missing number after ' + km[0]);
        const mode = (km[0] === 'k' ? 'kh' : km[0]) as KeepMode;
        if (kn < 0 || kn > count) throw new DiceError('Cannot ' + (mode[0] === 'k' ? 'keep' : 'drop') + ' ' + kn + ' of ' + count + ' dice');
        term.keep = { mode, n: kn };
      }
      totalDice += count;
      if (totalDice > DICE_LIMITS.maxTotalDice) throw new DiceError('Too many dice (max ' + DICE_LIMITS.maxTotalDice + ')');
      terms.push(term);
    } else if (n !== null) {
      if (n > DICE_LIMITS.maxConstant) throw new DiceError('Modifier is too large');
      terms.push({ kind: 'const', sign, value: n });
    } else {
      throw new DiceError('Unexpected ' + (src[i] ? '"' + src[i] + '"' : 'end') + ' at position ' + (i + 1));
    }
    if (terms.length > DICE_LIMITS.maxTerms) throw new DiceError('Too many terms');
    if (i >= src.length) break;
    if (src[i] === '+' || src[i] === '-') { sign = src[i] === '-' ? -1 : 1; i++; if (i >= src.length) throw new DiceError('Expression ends with an operator'); continue; }
    throw new DiceError('Unexpected "' + src[i] + '" at position ' + (i + 1));
  }
  return terms;
}

/** Uniform integer in [1, sides] using rejection sampling over a CSPRNG. */
export function secureDie(sides: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / sides) * sides;
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % sides) + 1;
  }
}

export function rollDice(expression: string, rng: (sides: number) => number = secureDie): RollResult {
  const terms = parseDice(expression);
  let total = 0, modifier = 0;
  const out: TermResult[] = terms.map((t) => {
    if (t.kind === 'const') { total += t.sign * t.value; modifier += t.sign * t.value; return { ...t, subtotal: t.sign * t.value }; }
    const values = Array.from({ length: t.count }, () => rng(t.sides));
    const kept = new Array(values.length).fill(true);
    if (t.keep) {
      const order = values.map((v, idx) => ({ v, idx })).sort((x, y) => x.v - y.v || x.idx - y.idx);
      const { mode, n } = t.keep;
      const drop = mode === 'kh' ? order.slice(0, values.length - n) : mode === 'kl' ? order.slice(n) : mode === 'dl' ? order.slice(0, n) : order.slice(values.length - n);
      for (const d of drop) kept[d.idx] = false;
    }
    const rolls = values.map((value, idx) => ({ value, kept: kept[idx] }));
    const subtotal = t.sign * rolls.reduce((s, r) => s + (r.kept ? r.value : 0), 0);
    total += subtotal;
    return { ...t, rolls, subtotal };
  });
  return { expression: expression.replace(/\s+/g, ''), terms: out, total, modifier };
}
