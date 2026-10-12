/** Characters of a campaign that the current user may see, with create + open-sheet. Used on the campaign page and at the table. */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CharacterView } from '../../../shared/characters';
import { CharacterSheet, type MemberLite } from './CharacterSheet';

export function CharacterList({ campaignId, role, members, openId, onOpen }: {
  campaignId: string; role: string; members: MemberLite[]; openId?: string | null; onOpen?: (id: string | null) => void;
}) {
  const [list, setList] = useState<CharacterView[] | null>(null);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const open = openId !== undefined ? openId : localOpen;
  const setOpen = onOpen ?? setLocalOpen;
  const canManage = ['owner', 'gm', 'assistant_gm'].includes(role);
  const canCreate = canManage || role === 'player';
  const load = () => api<{ characters: CharacterView[] }>('GET', '/api/campaigns/' + campaignId + '/characters').then((r) => setList(r.characters)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [campaignId]);

  if (open) return <CharacterSheet characterId={open} canManage={canManage} members={members} onClose={() => { setOpen(null); load(); }} onChanged={() => load()} />;
  return (
    <div className="space-y-2 p-3 text-sm" data-testid="character-list">
      {err && <p role="alert" className="text-danger">{err}</p>}
      {!list ? <p className="text-ink-dim">Loading…</p> : list.length === 0 ? <p className="text-ink-dim">{canManage ? 'No characters yet. Create PCs and NPCs here; assign them to players.' : role === 'spectator' ? 'Spectators have no characters.' : 'You have no characters yet.'}</p> : (
        <ul className="space-y-1">{list.map((c) => (
          <li key={c.id}><button className="flex w-full items-center justify-between rounded-md border border-line px-2 py-1.5 text-left hover:border-accent" onClick={() => setOpen(c.id)}>
            <span className="font-semibold">{c.name}</span><span className="text-xs text-ink-dim">{c.ownerName ?? 'GM'}</span></button></li>
        ))}</ul>
      )}
      {canCreate && (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          try { const c = await api<CharacterView>('POST', '/api/campaigns/' + campaignId + '/characters', { name }); setName(''); await load(); setOpen(c.id); } catch (x) { setErr((x as Error).message); }
        }}>
          <input className="input" aria-label="New character name" placeholder="New character" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button className="btn whitespace-nowrap" disabled={!name.trim()}>Create</button>
        </form>
      )}
    </div>
  );
}
