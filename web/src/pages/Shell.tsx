import type { ReactNode } from 'react';
import { Link, navigate } from '../router';
import { api } from '../api';
import type { Me } from '../App';

export function Shell({ me, children, onSignedOut }: { me: Me; children: ReactNode; onSignedOut: () => void }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-6 border-b border-line bg-panel px-6 py-3">
        <Link to="/" className="font-display text-lg tracking-widest text-accent">OPEN TABLETOP</Link>
        <nav className="flex gap-4 text-sm text-ink-dim" aria-label="Main">
          <Link to="/" className="hover:text-ink">Campaigns</Link>
          <Link to="/rulesets" className="hover:text-ink">Rulesets</Link>
          <Link to="/settings" className="hover:text-ink">Settings</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-ink-dim">Signed in as <b className="text-ink">{me.displayName}</b></span>
          <button className="btn" onClick={async () => { await api('POST', '/api/auth/logout'); onSignedOut(); navigate('/'); }}>Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
