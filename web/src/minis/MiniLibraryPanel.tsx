/** Side-panel list of library miniatures. GMs drag one onto the 2D or 3D table (or press Place) to create a token. */
import { useState } from 'react';
import { LIBRARY, MINI_MIME } from './library';
import { useTable, isGm } from '../table/store';
import type { TableSocket } from '../table/socket';
import { placeMini, type MiniItem } from '../../../shared/minis';

export function MiniLibraryPanel({ socket }: { socket: TableSocket }) {
  const gm = useTable(isGm);
  const map = useTable((s) => s.map);
  const [q, setQ] = useState('');
  const items = LIBRARY.items.filter((i) => (i.name + ' ' + i.family).toLowerCase().includes(q.toLowerCase()));
  const place = (i: MiniItem) => map && socket.send(placeMini(i, { x: map.width / 2, y: map.height / 2 }, map.grid));
  const group = (kind: MiniItem['kind'], title: string) => {
    const list = items.filter((i) => i.kind === kind);
    if (!list.length) return null;
    return (
      <section className="mb-3">
        <h3 className="label mb-1">{title}</h3>
        <ul className="grid gap-1">
          {list.map((i) => (
            <li key={i.id} draggable={gm} data-mini={i.id} onDragStart={(e) => { e.dataTransfer.setData(MINI_MIME, i.id); e.dataTransfer.effectAllowed = 'copy'; }}
              className={'flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1.5 ' + (gm ? 'cursor-grab active:cursor-grabbing' : '')} title={i.description}>
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/30 text-base">{i.kind === 'scenery' ? '♜' : '♟'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{i.name}</span>
                <span className="block truncate text-xs text-ink-dim">{i.family} · {i.cells}×{i.cells} sq · {Math.round(i.footprintMm)} mm base · {Math.round(i.heightMm)} mm tall</span>
              </span>
              {gm && <button className="btn px-2 text-xs" onClick={() => place(i)} aria-label={'Place ' + i.name + ' at the map centre'}>Place</button>}
            </li>
          ))}
        </ul>
      </section>
    );
  };
  return (
    <div className="h-full overflow-y-auto p-3 text-sm" data-testid="mini-library">
      <p className="mb-2 text-xs text-ink-dim">{gm ? 'Drag a miniature onto the table (2D or 3D). It snaps to the grid by its base: 25–40 mm = 1 square, larger = 2×2 or more. 1 square = 1 inch.' : 'Printable miniatures in this table’s library. The GM places them.'}</p>
      <input className="input mb-3" placeholder="Search miniatures" aria-label="Search miniatures" value={q} onChange={(e) => setQ(e.target.value)} />
      {group('figure', 'Figures')}
      {group('scenery', 'Scenery & terrain')}
      {!items.length && <p className="text-ink-dim">No miniatures match.</p>}
    </div>
  );
}
