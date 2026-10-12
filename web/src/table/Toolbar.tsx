import { useEffect } from 'react';
import { useTable, isGm, type Tool } from './store';
import type { TableEngine } from './engine';
import { getRuleset } from '../../../shared/rules/registry';

const TOOLS: { id: Tool; label: string; key: string; icon: string; gm?: boolean }[] = [
  { id: 'select', label: 'Select & move', key: 'v', icon: '➤' },
  { id: 'pan', label: 'Pan', key: 'h', icon: '✋' },
  { id: 'measure', label: 'Measure (drag; shift+click adds waypoints)', key: 'm', icon: '📏' },
  { id: 'draw', label: 'Draw', key: 'd', icon: '✎' },
  { id: 'erase', label: 'Erase drawing', key: 'e', icon: '⌫' },
  { id: 'ping', label: 'Ping a location', key: 'p', icon: '◎' },
  { id: 'token', label: 'Place token', key: 't', icon: '⬤', gm: true },
  { id: 'fog', label: 'Fog of war (drag to reveal/hide)', key: 'g', icon: '☁', gm: true },
];

export function Toolbar({ engine }: { engine: TableEngine | null }) {
  const tool = useTable((s) => s.tool);
  const gm = useTable(isGm);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((t) => t.key === e.key && (!t.gm || isGm(useTable.getState())));
      if (t) useTable.setState({ tool: t.id });
    };
    addEventListener('keydown', on); return () => removeEventListener('keydown', on);
  }, []);
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Tools">
      {TOOLS.filter((t) => !t.gm || gm).map((t) => (
        <button key={t.id} className="tool" aria-pressed={tool === t.id} title={t.label + ' (' + t.key.toUpperCase() + ')'} aria-label={t.label} data-tool={t.id} onClick={() => useTable.setState({ tool: t.id })}>
          <span aria-hidden className="text-lg">{t.icon}</span>
        </button>
      ))}
      <button className="tool opacity-40" disabled title="Area templates (cone, circle, line): planned" aria-label="Area templates (planned)"><span aria-hidden>△</span></button>
      <div className="mt-auto flex flex-col gap-1">
        <button className="tool" title="Zoom in (+)" aria-label="Zoom in" onClick={() => engine?.zoomBy(1.25)}>＋</button>
        <button className="tool" title="Zoom out (−)" aria-label="Zoom out" onClick={() => engine?.zoomBy(0.8)}>－</button>
        <button className="tool" title="Fit map to screen (F)" aria-label="Fit map to screen" onClick={() => engine?.fit()}>⤢</button>
      </div>
    </nav>
  );
}

/** Contextual options for the active tool, floating over the top-left of the map. */
export function ToolOptions() {
  const s = useTable();
  const gm = isGm(s);
  const rs = getRuleset(s.session?.rulesetId ?? 'generic');
  let body = null;
  if (s.tool === 'draw') body = (<>
    <label className="flex items-center gap-1">Colour <input type="color" value={s.drawColor} onChange={(e) => useTable.setState({ drawColor: e.target.value })} aria-label="Line colour" /></label>
    <label className="flex items-center gap-1">Width <input type="range" min={1} max={24} value={s.drawWidth} onChange={(e) => useTable.setState({ drawWidth: Number(e.target.value) })} aria-label="Line width" /></label>
    <label className="flex items-center gap-1"><input type="checkbox" checked={s.drawTemporary} onChange={(e) => useTable.setState({ drawTemporary: e.target.checked })} /> Disappears after 1 min</label>
    {gm && <label className="flex items-center gap-1 text-gm"><input type="checkbox" checked={s.drawGmOnly} onChange={(e) => useTable.setState({ drawGmOnly: e.target.checked })} /> GM only</label>}
  </>);
  else if (s.tool === 'fog' && gm) body = (<>
    <span className="text-ink-dim">Drag on the map to</span>
    <div role="radiogroup" className="flex gap-1">
      {(['reveal', 'hide'] as const).map((m) => <button key={m} role="radio" aria-checked={s.fogMode === m} className={'btn ' + (s.fogMode === m ? 'btn-primary' : '')} onClick={() => useTable.setState({ fogMode: m })}>{m}</button>)}
    </div>
  </>);
  else if (s.tool === 'token' && gm) body = (<>
    <span className="text-ink-dim">Click to place</span>
    <input className="input w-32" aria-label="New token name" value={s.newToken.name} onChange={(e) => useTable.setState({ newToken: { ...s.newToken, name: e.target.value } })} />
    <select className="input w-28" aria-label="Token category" value={s.newToken.category} onChange={(e) => useTable.setState({ newToken: { ...s.newToken, category: e.target.value } })}>
      {['pc', 'npc', 'monster', 'ally', 'enemy', 'object', 'marker', 'vehicle', 'generic'].map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
    <input type="color" aria-label="Token colour" value={s.newToken.color} onChange={(e) => useTable.setState({ newToken: { ...s.newToken, color: e.target.value } })} />
  </>);
  else if (s.tool === 'measure') body = <span className="text-ink-dim">Drag to measure · Shift+click to add waypoints · Right-click or Esc clears · 1 cell = {s.map?.grid.unitsPerCell ?? rs.distance.unitsPerCell} {s.map?.grid.unit ?? rs.distance.unit}</span>;
  if (!body) return null;
  return <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel/95 px-3 py-2 text-sm shadow-lg">{body}</div>;
}
