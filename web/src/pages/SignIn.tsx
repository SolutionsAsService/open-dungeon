import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { LocalModeNotice } from '../local/LocalModeNotice';

/**
 * Title page. Design rationale and critique trail: docs/design/DESIGN-LOG.md (DADA run).
 * The table itself is the motif: a battle-map grid, a title set at poster scale, and one
 * token (the "O") that has left the grid — the only deliberate break.
 */
export function SignIn({ onSignedIn, invite }: { onSignedIn: (m: Me) => void; invite?: string }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="title-page">
      <div className="title-candle" aria-hidden="true" />
      <main className="title-layout">
        <h1 className="title-mark" aria-label="Open Tabletop">
          <span aria-hidden="true" className="title-line">
            <span className="title-token">O</span>PEN
          </span>
          <span aria-hidden="true" className="title-line title-line-2">TABLETOP</span>
        </h1>

        <p className="title-tagline">
          A shared table for any roleplaying game. <span className="text-ink">Your maps, your miniatures, your rules.</span>
        </p>

        <form className="title-form" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { const r = await api<{ user: Me }>('POST', '/api/auth/dev', { displayName: name }); onSignedIn(r.user); }
          catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
        }}>
          {invite && <p className="mb-3 rounded-md border border-accent/40 bg-panel-2 p-2 text-sm text-ink">You've been invited to a campaign. Pick a name to join.</p>}
          <label className="label" htmlFor="dn">Your name at the table</label>
          <div className="flex gap-2">
            <input id="dn" className="input title-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="e.g. Morgan" autoComplete="nickname" />
            <button className="btn btn-primary title-enter" disabled={busy}>{busy ? 'Entering…' : 'Enter'}</button>
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">Development sign-in: no password, one account per browser. A real identity provider plugs in behind the same boundary.</p>
          <LocalModeNotice className="mt-3" />
        </form>
      </main>
    </div>
  );
}
