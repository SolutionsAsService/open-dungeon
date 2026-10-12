import { useTable, isGm, type ConnState } from './store';
import type { TableSocket } from './socket';
import type { TableEngine } from './engine';
import { api } from '../api';
import { navigate } from '../router';

const CONN: Record<ConnState, [string, string]> = {
  connecting: ['Connecting…', 'bg-yellow-500'], connected: ['Connected', 'bg-ok'], reconnecting: ['Reconnecting…', 'bg-yellow-500'], offline: ['Offline', 'bg-danger'],
};

export function TopBar({ onSetup, onTogglePanel, panelOpen }: { socket: TableSocket; engine: TableEngine | null; onSetup: () => void; onTogglePanel: () => void; panelOpen: boolean }) {
  const s = useTable((s) => s.session);
  const conn = useTable((s) => s.conn);
  const pending = useTable((s) => s.pending);
  const members = useTable((s) => s.members);
  const gm = useTable(isGm);
  const [label, dot] = CONN[conn];
  const setStatus = async (status: string) => {
    if (status === 'closed' && !confirm('Close this session? Players will be disconnected from editing; the table is saved and can be reopened.')) return;
    await api('POST', '/api/sessions/' + s!.id + '/status', { status });
  };
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <button className="btn" onClick={() => navigate('/campaigns/' + (s?.campaignId ?? ''))} title="Leave the table">← Leave</button>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold" data-testid="session-name">{s?.name ?? '…'}</div>
        <div className="truncate text-xs text-ink-dim">{s?.campaignName}</div>
      </div>
      {s && s.status !== 'open' && <span className="rounded bg-danger/20 px-2 py-0.5 text-xs font-semibold uppercase text-danger" data-testid="session-status">{s.status}</span>}
      <div className="ml-2 flex items-center gap-1.5 text-xs text-ink-dim" role="status" aria-live="polite" data-testid="conn-status">
        <span className={'h-2 w-2 rounded-full ' + dot} aria-hidden /> {label}{pending > 0 && conn === 'connected' ? ' · saving ' + pending : pending > 0 ? ' · ' + pending + ' change' + (pending > 1 ? 's' : '') + ' pending' : conn === 'connected' ? ' · saved' : ''}
      </div>
      <ul className="ml-auto flex -space-x-1" aria-label="Players">
        {members.map((m) => (
          <li key={m.userId} title={m.displayName + ' (' + m.role.replace('_', ' ') + ')' + (m.online ? ', online' : ', away')}
            className={'grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold ' + (m.online ? 'border-ok' : 'border-line opacity-50') + (['owner', 'gm', 'assistant_gm'].includes(m.role) ? ' bg-gm text-black' : ' bg-panel-2')}>
            {m.displayName.slice(0, 1).toUpperCase()}
          </li>
        ))}
      </ul>
      {gm && <button className="btn" onClick={onSetup}>Map setup</button>}
      {gm && s && (s.status === 'open'
        ? <><button className="btn" onClick={() => setStatus('paused')}>Pause</button><button className="btn btn-danger" onClick={() => setStatus('closed')}>Close</button></>
        : <button className="btn btn-primary" onClick={() => setStatus('open')}>Reopen</button>)}
      <button className="btn" title="Full screen" aria-label="Toggle full screen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>⛶</button>
      <button className="btn" aria-pressed={panelOpen} aria-label="Toggle side panel" onClick={onTogglePanel}>☰</button>
    </header>
  );
}
