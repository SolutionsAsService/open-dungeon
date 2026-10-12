import { useState } from 'react';
import { useTable } from './store';
import type { TableSocket } from './socket';
import type { TableEngine } from './engine';
import { uploadImage, api } from '../api';
import type { GridConfig } from '../../../shared/grid';

/** Non-modal map setup: upload → size → grid type → calibrate → scale. Changes apply live so the GM can line the grid up against the image. */
export function MapSetup({ socket, engine, onClose }: { socket: TableSocket; engine: TableEngine | null; onClose: () => void }) {
  const map = useTable((s) => s.map);
  const session = useTable((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!map || !session) return null;
  const g = map.grid;
  const setGrid = (p: Partial<GridConfig>) => socket.send({ type: 'map.update', grid: p });
  const n = (v: string, d: number) => (v === '' || isNaN(Number(v)) ? d : Number(v));
  return (
    <div className="absolute right-3 top-3 z-20 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-line bg-panel p-4 text-sm shadow-2xl" role="dialog" aria-label="Map setup">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg text-accent">Map setup</h2><button className="btn px-2" aria-label="Close map setup" onClick={onClose}>✕</button></div>
      <ol className="space-y-4">
        <li><span className="label">1 · Background image</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload map image" disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return;
            setBusy(true); setErr('');
            try { const a = await uploadImage(session.campaignId, file); await api('POST', '/api/sessions/' + session.id + '/background', { assetId: a.id }); setTimeout(() => engine?.fit(), 300); }
            catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }} />
          <p className="mt-1 text-xs text-ink-dim">PNG, JPEG, WebP or GIF. The map takes the image's size.</p>
          {map.backgroundAssetId && <button className="btn mt-1" onClick={() => api('POST', '/api/sessions/' + session.id + '/background', { assetId: null })}>Remove image</button>}
          {err && <p role="alert" className="text-danger">{err}</p>}
        </li>
        <li><span className="label">2 · Map size (px)</span>
          <div className="flex gap-2"><input className="input" type="number" aria-label="Map width" value={map.width} onChange={(e) => socket.send({ type: 'map.update', width: n(e.target.value, map.width) })} /><input className="input" type="number" aria-label="Map height" value={map.height} onChange={(e) => socket.send({ type: 'map.update', height: n(e.target.value, map.height) })} /></div>
        </li>
        <li><span className="label">3 · Grid type</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Grid type">
            {(['square', 'hex', 'none'] as const).map((t) => <button key={t} role="radio" aria-checked={g.type === t} className={'btn flex-1 ' + (g.type === t ? 'btn-primary' : '')} onClick={() => setGrid({ type: t })}>{t === 'none' ? 'Gridless' : t}</button>)}
          </div>
          {g.type === 'hex' && <div className="mt-2 flex gap-1">{(['pointy', 'flat'] as const).map((o) => <button key={o} className={'btn flex-1 ' + (g.hexOrientation === o ? 'btn-primary' : '')} onClick={() => setGrid({ hexOrientation: o })}>{o}-top</button>)}</div>}
        </li>
        <li><span className="label">4 · Calibrate</span>
          <label className="block">Cell size: {g.cellSize}px<input type="range" min={20} max={300} value={g.cellSize} className="w-full" onChange={(e) => setGrid({ cellSize: Number(e.target.value) })} aria-label="Cell size" /></label>
          <div className="flex gap-2">
            <label className="flex-1">Offset X<input className="input" type="number" value={g.offsetX} onChange={(e) => setGrid({ offsetX: n(e.target.value, 0) })} /></label>
            <label className="flex-1">Offset Y<input className="input" type="number" value={g.offsetY} onChange={(e) => setGrid({ offsetY: n(e.target.value, 0) })} /></label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" checked={g.visible} onChange={(e) => setGrid({ visible: e.target.checked })} /> Show grid</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={g.snap} onChange={(e) => setGrid({ snap: e.target.checked })} /> Snap tokens</label>
            <input type="color" aria-label="Grid colour" value={g.color} onChange={(e) => setGrid({ color: e.target.value })} />
            <label className="flex flex-1 items-center gap-1">Opacity<input type="range" min={0} max={1} step={0.05} value={g.opacity} onChange={(e) => setGrid({ opacity: Number(e.target.value) })} aria-label="Grid opacity" /></label>
          </div>
        </li>
        <li><span className="label">5 · Scale</span>
          <div className="flex items-center gap-2">1 {g.type === 'none' ? g.cellSize + 'px' : 'cell'} =
            <input className="input w-20" type="number" min={0.01} step="any" aria-label="Units per cell" value={g.unitsPerCell} onChange={(e) => n(e.target.value, 0) > 0 && setGrid({ unitsPerCell: Number(e.target.value) })} />
            <input className="input w-20" aria-label="Unit" value={g.unit} maxLength={16} onChange={(e) => setGrid({ unit: e.target.value })} />
          </div>
          {g.type === 'square' && <label className="mt-2 block">Diagonals<select className="input" value={g.diagonal} onChange={(e) => setGrid({ diagonal: e.target.value as GridConfig['diagonal'] })}>
            <option value="chebyshev">Every diagonal costs 1</option><option value="alternating">Alternate 1 / 2</option><option value="manhattan">No diagonals (2)</option><option value="euclidean">True distance</option></select></label>}
        </li>
      </ol>
      <p className="mt-4 text-xs text-ink-dim">Changes save automatically and every player sees them live.</p>
    </div>
  );
}
