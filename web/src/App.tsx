import { useEffect, useState } from 'react';
import { api } from './api';
import { usePath, match, navigate } from './router';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { CampaignPage } from './pages/CampaignPage';
import { InvitePage } from './pages/InvitePage';
import { SettingsPage } from './pages/SettingsPage';
import { RulesetsPage } from './pages/RulesetsPage';
import { SessionPage } from './table/SessionPage';
import { Shell } from './pages/Shell';

export interface Me { id: string; displayName: string }

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { api<{ user: Me | null }>('GET', '/api/me').then((r) => setMe(r.user)).catch(() => setMe(null)); }, []);
  if (me === undefined) return <div className="grid h-screen place-items-center text-ink-dim">Loading…</div>;

  const invite = match('/invite/:token', path);
  if (!me) return <SignIn onSignedIn={setMe} invite={invite?.token} />;
  if (invite) return <InvitePage token={invite.token} />;
  const session = match('/sessions/:id', path);
  if (session) return <SessionPage sessionId={session.id} me={me} />;
  const campaign = match('/campaigns/:id', path);
  let page;
  if (campaign) page = <CampaignPage id={campaign.id} />;
  else if (path === '/settings') page = <SettingsPage />;
  else if (path === '/rulesets') page = <RulesetsPage />;
  else if (path === '/' || path === '/dashboard' || path === '/campaigns') page = <Dashboard />;
  else page = <div className="card">Page not found. <button className="btn ml-2" onClick={() => navigate('/')}>Go home</button></div>;
  return <Shell me={me} onSignedOut={() => setMe(null)}>{page}</Shell>;
}
