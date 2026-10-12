import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';

export function SignIn({ onSignedIn, invite }: { onSignedIn: (m: Me) => void; invite?: string }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen place-items-center p-6" style={{ background: 'radial-gradient(ellipse at top, #2a211a, #14110f 70%)' }}>
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-4xl tracking-[0.2em] text-accent">OPEN TABLETOP</h1>
        <p className="mt-3 text-ink-dim">A shared table for any roleplaying game: your maps, your miniatures, your rules.</p>
        <form className="card mt-8 text-left" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { const r = await api<{ user: Me }>('POST', '/api/auth/dev', { displayName: name }); onSignedIn(r.user); }
          catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
        }}>
          {invite && <p className="mb-3 rounded-md bg-panel-2 p-2 text-sm">You've been invited to a campaign. Pick a name to join.</p>}
          <label className="label" htmlFor="dn">Your name at the table</label>
          <input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="e.g. Morgan" />
          {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
          <button className="btn btn-primary mt-4 w-full" disabled={busy || !name.trim()}>Enter</button>
          <p className="mt-3 text-xs text-ink-dim">Development sign-in: no password, one account per browser. A real identity provider plugs in behind the same boundary.</p>
        </form>
      </div>
    </div>
  );
}
