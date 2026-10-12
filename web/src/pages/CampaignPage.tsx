import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate, Link } from '../router';
import { CharacterList } from '../characters/CharacterList';
import { Journal, useJournalLoader } from '../journal/Journal';
import type { JournalView } from '../../../shared/journal';
import type { Me } from '../App';

interface Camp { id: string; name: string; description: string; role: string; rulesetId: string; members: { userId: string; displayName: string; role: string }[]; sessions: { id: string; name: string; status: string; updatedAt: string }[] }

export function CampaignPage({ id, me }: { id: string; me: Me }) {
  const [c, setC] = useState<Camp | null>(null);
  const [err, setErr] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [invite, setInvite] = useState('');
  const [inviteRole, setInviteRole] = useState('player');
  const [journal, setJournal] = useState<JournalView[] | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  useJournalLoader(id, setJournal);
  const load = () => api<Camp>('GET', '/api/campaigns/' + id).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <div className="card text-danger" role="alert">{err} <Link to="/" className="btn ml-2">Back</Link></div>;
  if (!c) return <p className="text-ink-dim">Loading…</p>;
  const isGm = ['owner', 'gm'].includes(c.role);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section>
        <Link to="/" className="text-sm text-ink-dim hover:text-ink">← Campaigns</Link>
        <h1 className="font-display mt-1 text-3xl text-accent">{c.name}</h1>
        <h2 className="section-title mt-6 mb-2">Sessions</h2>
        {c.sessions.length === 0 ? <div className="card text-ink-dim">{isGm ? 'Start your first session to open the table.' : 'The GM hasn\'t started a session yet.'}</div> : (
          <ul className="grid gap-2">
            {c.sessions.map((s) => (
              <li key={s.id} className="card flex items-center justify-between">
                <div><div className="font-semibold">{s.name}</div><div className="text-xs text-ink-dim">{s.status} · last activity {new Date(s.updatedAt).toLocaleString()}</div></div>
                <button className="btn btn-primary" onClick={() => navigate('/sessions/' + s.id)} disabled={s.status === 'closed' && !isGm}>{s.status === 'closed' ? 'Open (closed)' : 'Join table'}</button>
              </li>
            ))}
          </ul>
        )}
        {isGm && (
          <form className="mt-3 flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            try { const r = await api<{ id: string }>('POST', '/api/campaigns/' + id + '/sessions', { name: sessionName }); navigate('/sessions/' + r.id); } catch (x) { setErr((x as Error).message); }
          }}>
            <label htmlFor="sn" className="sr-only">Session name</label>
            <input id="sn" className="input" placeholder={'Session ' + (c.sessions.length + 1)} value={sessionName} onChange={(e) => setSessionName(e.target.value)} maxLength={80} required />
            <button className="btn btn-primary whitespace-nowrap" disabled={!sessionName.trim()}>New session</button>
          </form>
        )}
        <h2 className="section-title mt-6 mb-2">Characters</h2>
        <div className="card p-0"><CharacterList campaignId={c.id} role={c.role} members={c.members} /></div>
        <h2 className="section-title mt-6 mb-2">Journal & handouts</h2>
        <div className="card p-0">{me && <Journal campaignId={c.id} role={c.role} meId={me.id} members={c.members} entries={journal} openId={openEntry} onOpen={setOpenEntry}
          onUpsert={(e) => setJournal((j) => [e, ...(j ?? []).filter((x) => x.id !== e.id)])} onRemove={(rid) => setJournal((j) => (j ?? []).filter((x) => x.id !== rid))} />}</div>
      </section>
      <aside className="grid content-start gap-4">
        <div className="card">
          <h2 className="section-title mb-2">Members</h2>
          <ul className="grid gap-1 text-sm">{c.members.map((m) => <li key={m.userId} className="flex justify-between"><span>{m.displayName}</span><span className="text-ink-dim">{m.role.replace('_', ' ')}</span></li>)}</ul>
        </div>
        {isGm && (
          <div className="card">
            <h2 className="section-title mb-2">Invite friends</h2>
            <label className="label" htmlFor="ir">Join as</label>
            <select id="ir" className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="player">Player</option><option value="spectator">Spectator</option><option value="assistant_gm">Assistant GM</option>
            </select>
            <button className="btn mt-2 w-full" onClick={async () => {
              const r = await api<{ path: string }>('POST', '/api/campaigns/' + id + '/invites', { role: inviteRole, expiresInHours: 168 });
              setInvite(location.origin + r.path);
            }}>Create invite link (7 days)</button>
            {invite && <div className="mt-2"><input aria-label="Invite link" readOnly className="input text-xs" value={invite} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
              <button className="btn mt-1 w-full" onClick={() => navigator.clipboard?.writeText(invite)}>Copy</button></div>}
          </div>
        )}
      </aside>
    </div>
  );
}
