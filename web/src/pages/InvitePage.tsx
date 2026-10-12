import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';

export function InvitePage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ campaignName: string; role: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('GET', '/api/invites/' + token).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-md text-center">
        {err ? <p role="alert" className="text-danger">{err}</p> : !info ? <p>Checking invitation…</p> : (<>
          <p className="text-ink-dim">You're invited to join</p>
          <h1 className="font-display my-2 text-2xl text-accent">{info.campaignName}</h1>
          <p className="text-sm text-ink-dim">as a {info.role.replace('_', ' ')}</p>
          <button className="btn btn-primary mt-4" onClick={async () => {
            try { const r = await api<{ campaignId: string }>('POST', '/api/invites/' + token + '/accept'); navigate('/campaigns/' + r.campaignId, true); } catch (e) { setErr((e as Error).message); }
          }}>Join campaign</button>
        </>)}
        <button className="btn mt-4 ml-2" onClick={() => navigate('/', true)}>Not now</button>
      </div>
    </div>
  );
}
