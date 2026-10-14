import { useEffect, useRef, useState } from 'react';
import { TableSocket } from './socket';
import { TableEngine } from './engine';
import { useTable, isGm } from './store';
import { TopBar } from './TopBar';
import { Toolbar, ToolOptions } from './Toolbar';
import { SidePanel } from './SidePanel';
import { DiceBar } from './DiceBar';
import { MapSetup } from './MapSetup';
import type { Me } from '../App';
import { Link } from '../router';
import { api } from '../api';
import type { JournalView } from '../../../shared/journal';
import type { Table3D } from './scene3d';

type View = '2d' | '3d';
/** 2D/3D choice per scene (map), remembered in this browser. */
function useView(mapId: string | undefined): [View, (v: View) => void] {
  const [view, setView] = useState<View>('2d');
  useEffect(() => { setView(mapId && localStorage.getItem('od.view.' + mapId) === '3d' ? '3d' : '2d'); }, [mapId]);
  return [view, (v) => { setView(v); if (mapId) localStorage.setItem('od.view.' + mapId, v); }];
}

export function SessionPage({ sessionId }: { sessionId: string; me: Me }) {
  const host = useRef<HTMLDivElement>(null);
  const [socket] = useState(() => new TableSocket(sessionId));
  const [engine, setEngine] = useState<TableEngine | null>(null);
  const [panel, setPanel] = useState(true);
  const [setup, setSetup] = useState(false);
  const loaded = useTable((s) => s.loaded);
  const fatal = useTable((s) => s.fatalError);
  const gm = useTable(isGm);
  const toastMsg = useTable((s) => s.toast);
  const host3d = useRef<HTMLDivElement>(null);
  const [view, setView] = useView(useTable((s) => s.map?.id));
  const [t3d, setT3d] = useState<Table3D | null>(null);
  useEffect(() => {
    if (view !== '3d') return;
    let alive = true, eng: Table3D | null = null;
    import('./scene3d').then(({ Table3D }) => { if (!alive || !host3d.current) return; eng = new Table3D(socket); eng.init(host3d.current); setT3d(eng); });
    return () => { alive = false; eng?.destroy(); setT3d(null); };
  }, [view, socket]);

  useEffect(() => {
    useTable.setState({ loaded: false, fatalError: null, tokens: {}, chat: [], selectedId: null, tool: 'select', panelTab: 'chat', openCharacterId: null, journal: null, openJournalId: null });
    socket.connect();
    const eng = new TableEngine(socket);
    eng.init(host.current!).then(() => setEngine(eng));
    return () => { socket.close(); eng.destroy(); };
  }, [socket]);
  const campaignId = useTable((s) => s.session?.campaignId);
  useEffect(() => {
    if (!campaignId) return;
    api<{ entries: JournalView[] }>('GET', '/api/campaigns/' + campaignId + '/journal').then((r) => useTable.setState({ journal: r.entries })).catch(() => undefined);
  }, [campaignId]);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => useTable.setState({ toast: null }), 4000); return () => clearTimeout(t); }, [toastMsg]);

  if (fatal) return <div className="grid h-screen place-items-center"><div className="card text-center"><p role="alert">{fatal}</p><Link to="/" className="btn mt-3">Back to campaigns</Link></div></div>;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-table">
      <TopBar socket={socket} engine={engine} onSetup={() => setSetup(true)} onTogglePanel={() => setPanel((p) => !p)} panelOpen={panel} />
      <div className="relative flex min-h-0 flex-1">
        <Toolbar engine={view === '3d' ? t3d : engine} />
        <div className="relative min-w-0 flex-1">
          <div ref={host} className={'absolute inset-0' + (view === '3d' ? ' invisible' : '')} data-testid="table-canvas" />
          {view === '3d' && <div ref={host3d} className="absolute inset-0" data-testid="table-3d" />}
          <div role="group" aria-label="Table view" className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-lg border border-line bg-panel/95 text-sm shadow-lg">
            {(['2d', '3d'] as const).map((v) => <button key={v} className={'px-3 py-1.5 font-semibold ' + (view === v ? 'bg-accent text-black' : 'text-ink-dim hover:text-ink')} aria-pressed={view === v} data-view={v} onClick={() => setView(v)}>{v.toUpperCase()}</button>)}
          </div>
          <ToolOptions socket={socket} />
          {!loaded && <div className="absolute inset-0 grid place-items-center bg-table/80 text-ink-dim">Joining the table…</div>}
          {loaded && gm && <EmptyMapHint onSetup={() => setSetup(true)} />}
          <DiceBar socket={socket} />
          {toastMsg && <div role="status" className={'absolute left-1/2 top-3 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow-lg ' + (toastMsg.kind === 'error' ? 'border-danger bg-panel text-danger' : 'border-line bg-panel')}>{toastMsg.text}</div>}
        </div>
        {panel && <SidePanel socket={socket} engine={engine} />}
        {setup && gm && <MapSetup socket={socket} engine={engine} onClose={() => setSetup(false)} />}
      </div>
    </div>
  );
}

function EmptyMapHint({ onSetup }: { onSetup: () => void }) {
  const map = useTable((s) => s.map);
  const tokens = useTable((s) => Object.keys(s.tokens).length);
  if (!map || map.backgroundAssetId || tokens) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto card max-w-sm text-center shadow-xl">
        <p className="font-semibold">Your table is empty</p>
        <p className="mt-1 text-sm text-ink-dim">Upload a battle map and set up the grid, or place tokens with the token tool (T) to play on a blank grid.</p>
        <button className="btn btn-primary mt-3" onClick={onSetup}>Set up map</button>
      </div>
    </div>
  );
}
