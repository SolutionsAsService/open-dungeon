import { useState } from 'react';
import { useTable } from './store';
import type { TableSocket } from './socket';
import { getRuleset } from '../../../shared/rules/registry';
import { parseDice, DiceError } from '../../../shared/dice';

export function DiceBar({ socket }: { socket: TableSocket }) {
  const rulesetId = useTable((s) => s.session?.rulesetId ?? 'generic');
  const role = useTable((s) => s.me?.role);
  const rs = getRuleset(rulesetId);
  const [expr, setExpr] = useState('');
  const [vis, setVis] = useState<'public' | 'gm' | 'self'>('public');
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState('');
  if (role === 'spectator') return null;
  const roll = (e: string, label?: string) => socket.send({ type: 'dice.roll', expression: e, visibility: vis, ...(label ? { label } : {}) });
  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      {open ? (
        <form className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-xl" aria-label="Dice roller" onSubmit={(e) => {
          e.preventDefault();
          try { parseDice(expr); setErr(''); roll(expr); } catch (x) { setErr(x instanceof DiceError ? x.message : 'Invalid'); }
        }}>
          {[4, 6, 8, 10, 12, 20, 100].map((d) => <button type="button" key={d} className="btn px-2 font-mono" onClick={() => roll('1d' + d)}>d{d}</button>)}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {rs.rollPresets.filter((p) => !/^1d(4|6|8|10|12|20|100)$/.test(p.expression)).slice(0, 3).map((p) => <button type="button" key={p.label} className="btn px-2" title={p.expression} onClick={() => roll(p.expression, p.label)}>{p.label}</button>)}
          <input className="input w-28 font-mono" aria-label="Dice formula" aria-invalid={!!err} placeholder="2d6+3" value={expr} onChange={(e) => { setExpr(e.target.value); setErr(''); }} />
          <button className="btn btn-primary">Roll</button>
          <select className="input w-auto" aria-label="Roll visibility" value={vis} onChange={(e) => setVis(e.target.value as any)}><option value="public">Public</option><option value="gm">To GM</option><option value="self">Private</option></select>
          <button type="button" className="btn px-2" aria-label="Hide dice roller" onClick={() => setOpen(false)}>▾</button>
          {err && <span role="alert" className="w-full text-xs text-danger">{err}</span>}
        </form>
      ) : <button className="btn shadow-xl" onClick={() => setOpen(true)}>🎲 Dice</button>}
    </div>
  );
}
