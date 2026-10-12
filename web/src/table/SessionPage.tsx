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

  useEffect(() => {
    useTable.setState({ loaded: false, fatalError: null, tokens: {}, chat: [], selectedId: null, tool: 'select', panelTab: 'chat', openCharacterId: null });
    socket.connect();
    const eng = new TableEngine(socket);
    eng.init(host.current!).then(() => setEngine(eng));
    return () => { socket.close(); eng.destroy(); };
  }, [socket]);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => useTable.setState({ toast: null }), 4000); return () => clearTimeout(t); }, [toastMsg]);

  if (fatal) return <div className="grid h-screen place-items-center"><div className="card text-center"><p role="alert">{fatal}</p><Link to="/" className="btn mt-3">Back to campaigns</Link></div></div>;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-table">
      <TopBar socket={socket} engine={engine} onSetup={() => setSetup(true)} onTogglePanel={() => setPanel((p) => !p)} panelOpen={panel} />
      <div className="relative flex min-h-0 flex-1">
        <Toolbar engine={engine} />
        <div className="relative min-w-0 flex-1">
          <div ref={host} className="absolute inset-0" data-testid="table-canvas" />
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
