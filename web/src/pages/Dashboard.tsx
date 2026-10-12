import { useEffect, useState } from 'react';
import { api } from '../api';
import { Link, navigate } from '../router';
import { RULESETS } from '../../../shared/rules/registry';

interface C { id: string; name: string; description: string; role: string; sessionCount: number; rulesetId: string }

export function Dashboard() {
  const [list, setList] = useState<C[] | null>(null);
  const [name, setName] = useState('');
  const [ruleset, setRuleset] = useState('generic');
  const [err, setErr] = useState('');
  useEffect(() => { api<{ campaigns: C[] }>('GET', '/api/campaigns').then((r) => setList(r.campaigns)).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section>
        <h1 className="font-display text-2xl text-accent">Your campaigns</h1>
        {err && <p role="alert" className="text-danger">{err}</p>}
        {!list ? <p className="mt-4 text-ink-dim">Loading…</p> : list.length === 0 ? (
          <div className="card mt-4 text-ink-dim">No campaigns yet. Create one to get a table, or open an invite link a friend sent you.</div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {list.map((c) => (
              <li key={c.id}><Link to={'/campaigns/' + c.id} className="card block hover:border-accent">
                <div className="flex items-baseline justify-between"><span className="text-lg font-semibold">{c.name}</span><span className="text-xs uppercase text-ink-dim">{c.role.replace('_', ' ')}</span></div>
                <div className="mt-1 text-sm text-ink-dim">{c.sessionCount} session{c.sessionCount === 1 ? '' : 's'} · {RULESETS.find((r) => r.manifest.id === c.rulesetId)?.manifest.name ?? c.rulesetId}</div>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
      <aside>
        <form className="card" onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          try { const r = await api<{ id: string }>('POST', '/api/campaigns', { name, rulesetId: ruleset }); navigate('/campaigns/' + r.id); }
          catch (x) { setErr((x as Error).message); }
        }}>
          <h2 className="section-title mb-3">New campaign</h2>
          <label className="label" htmlFor="cn">Name</label>
          <input id="cn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="The Sunken Keep" />
          <label className="label mt-3" htmlFor="rs">Game system</label>
          <select id="rs" className="input" value={ruleset} onChange={(e) => setRuleset(e.target.value)}>
            {RULESETS.map((r) => <option key={r.manifest.id} value={r.manifest.id}>{r.manifest.name}</option>)}
          </select>
          <button className="btn btn-primary mt-4 w-full" disabled={!name.trim()}>Create campaign</button>
        </form>
      </aside>
    </div>
  );
}
