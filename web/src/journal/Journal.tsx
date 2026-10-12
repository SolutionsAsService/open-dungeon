/**
 * Journals & handouts. Used on the campaign page (REST only) and at the table (entries kept live by
 * journal.upsert/remove events). Bodies are plain text rendered as text, never as HTML.
 * Who can read/edit/share is decided by the server; the same rules (shared/journal.ts) only hide controls here.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadImage, assetUrl } from '../api';
import { canEditEntry, canUseVisibility, JOURNAL_LIMITS, type JournalKind, type JournalView, type JournalVisibility } from '../../../shared/journal';
import type { Role } from '../../../shared/permissions';

export interface JournalMember { userId: string; displayName: string; role: string }
const KINDS: JournalKind[] = ['note', 'handout', 'location', 'npc', 'quest', 'lore'];
const KIND_LABEL: Record<JournalKind, string> = { note: 'Note', handout: 'Handout', location: 'Location', npc: 'NPC', quest: 'Quest', lore: 'Lore' };
export function visibilityLabel(e: JournalView, members: JournalMember[]) {
  switch (e.visibility) {
    case 'private': return 'Private';
    case 'gm': return 'GM only';
    case 'all': return 'Everyone';
    case 'players': { const n = e.sharedWith.map((id) => members.find((m) => m.userId === id)?.displayName ?? '?'); return n.length ? 'Shared with ' + n.join(', ') : 'GM only (no players picked)'; }
  }
}

export function useJournalLoader(campaignId: string | undefined, set: (e: JournalView[]) => void) {
  useEffect(() => {
    if (!campaignId) return;
    api<{ entries: JournalView[] }>('GET', '/api/campaigns/' + campaignId + '/journal').then((r) => set(r.entries)).catch(() => undefined);
  }, [campaignId]);
}

export function Journal({ campaignId, role, meId, members, entries, onUpsert, onRemove, openId, onOpen }: {
  campaignId: string; role: string; meId: string; members: JournalMember[]; entries: JournalView[] | null;
  onUpsert: (e: JournalView) => void; onRemove: (id: string) => void; openId: string | null; onOpen: (id: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<JournalKind>('note');
  const [filter, setFilter] = useState<'' | JournalKind>('');
  const [err, setErr] = useState('');
  const r = role as Role;
  const open = openId ? entries?.find((e) => e.id === openId) : null;
  if (open) return <JournalEntry key={open.id} entry={open} role={r} meId={meId} members={members} campaignId={campaignId} onUpsert={onUpsert} onRemove={(id) => { onRemove(id); onOpen(null); }} onClose={() => onOpen(null)} />;
  const shown = (entries ?? []).filter((e) => !filter || e.kind === filter);
  return (
    <div className="space-y-2 p-3 text-sm" data-testid="journal-panel">
      {err && <p role="alert" className="text-danger">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="section-title">Journal</span>
        <select className="input w-auto" aria-label="Filter journal" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      {!entries ? <p className="text-ink-dim">Loading…</p> : shown.length === 0 ? <p className="text-ink-dim">{r === 'spectator' ? 'Nothing has been shared with you yet.' : ['owner', 'gm', 'assistant_gm'].includes(r) ? 'No entries yet. Write session notes, NPCs, locations, quests, lore, and handouts you can reveal to players.' : 'No notes or handouts yet. Your private notes and anything the GM shares appear here.'}</p> : (
        <ul className="space-y-1">{shown.map((e) => (
          <li key={e.id}><button className="w-full rounded-md border border-line px-2 py-1.5 text-left hover:border-accent" onClick={() => onOpen(e.id)}>
            <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{e.title}</span><span className="shrink-0 rounded-full border border-line px-1.5 text-xs text-ink-dim">{KIND_LABEL[e.kind]}</span></div>
            <div className="text-xs text-ink-dim">{visibilityLabel(e, members)}{e.authorId !== meId && e.authorName ? ' · by ' + e.authorName : ''}</div>
          </button></li>
        ))}</ul>
      )}
      {r !== 'spectator' && (
        <form className="flex gap-2" onSubmit={async (ev) => {
          ev.preventDefault(); setErr('');
          try { const e = await api<JournalView>('POST', '/api/campaigns/' + campaignId + '/journal', { title, kind }); setTitle(''); onUpsert(e); onOpen(e.id); } catch (x) { setErr((x as Error).message); }
        }}>
          <input className="input" aria-label="New entry title" placeholder="New entry" value={title} maxLength={JOURNAL_LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
          <select className="input w-auto" aria-label="New entry kind" value={kind} onChange={(e) => setKind(e.target.value as JournalKind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
          <button className="btn" disabled={!title.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}

function JournalEntry({ entry, role, meId, members, campaignId, onUpsert, onRemove, onClose }: {
  entry: JournalView; role: Role; meId: string; members: JournalMember[]; campaignId: string; onUpsert: (e: JournalView) => void; onRemove: (id: string) => void; onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const ref = useRef(entry); ref.current = entry;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => setTitle(entry.title), [entry.title]);
  useEffect(() => setBody(entry.body), [entry.body]);
  const editable = canEditEntry(role, meId, entry);
  const canShare = editable && canUseVisibility(role, 'all');
  const save = (patch: Record<string, unknown>) => {
    queue.current = queue.current.then(async () => {
      setStatus('Saving…');
      try { const e = await api<JournalView>('PATCH', '/api/journal/' + entry.id, { baseVersion: ref.current.version, ...patch }); ref.current = e; onUpsert(e); setStatus('Saved'); }
      catch (x) {
        if (x instanceof ApiError && x.status === 409) { setStatus('Someone else edited this entry; showing their version.'); try { const e = await api<JournalView>('GET', '/api/journal/' + entry.id); ref.current = e; onUpsert(e); } catch { /* removed or hidden */ } }
        else setStatus((x as Error).message);
      }
    });
  };
  const share = (visibility: JournalVisibility, sharedWith?: string[]) => save({ visibility, ...(sharedWith ? { sharedWith } : {}) });
  const players = members.filter((m) => m.role === 'player' || m.role === 'spectator');
  return (
    <article className="space-y-2 p-3 text-sm" aria-label={'Journal entry: ' + entry.title} data-testid="journal-entry">
      <div className="flex items-center gap-2">
        {editable ? <input className="input font-semibold" aria-label="Entry title" value={title} maxLength={JOURNAL_LIMITS.title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== entry.title && save({ title: title.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          : <h3 className="flex-1 font-semibold">{entry.title}</h3>}
        <button className="btn px-2" aria-label="Close entry" onClick={onClose}>✕</button>
      </div>
      <div className="flex items-center justify-between text-xs text-ink-dim">
        {editable ? <select className="input w-auto py-0.5 text-xs" aria-label="Entry kind" value={entry.kind} onChange={(e) => save({ kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select> : <span>{KIND_LABEL[entry.kind]}{entry.authorName ? ' · by ' + entry.authorName : ''}</span>}
        <span role="status" aria-live="polite">{status}</span>
      </div>
      {entry.imageAssetId && <img src={assetUrl(entry.imageAssetId)} alt={entry.title} className="max-h-64 w-full rounded-md object-contain" />}
      {editable ? <textarea className="input h-48" aria-label="Entry text" value={body} maxLength={JOURNAL_LIMITS.body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== entry.body && save({ body })} placeholder="Write here…" />
        : <p className="whitespace-pre-wrap break-words" data-testid="journal-body">{entry.body || <span className="text-ink-dim">(no text)</span>}</p>}
      {editable && canShare && (
        <div className="flex items-center gap-2 text-xs">
          <label className="flex-1"><span className="label">Image</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-xs" aria-label="Entry image" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { const a = await uploadImage(campaignId, f); save({ imageAssetId: a.id }); } catch (x) { setStatus((x as Error).message); }
          }} /></label>
          {entry.imageAssetId && <button className="btn" onClick={() => save({ imageAssetId: null })}>Remove image</button>}
        </div>
      )}
      <fieldset className="rounded-md border border-line p-2">
        <legend className="section-title px-1">Who can read this</legend>
        {canShare ? (
          <div className="space-y-1">
            {(['gm', 'players', 'all', 'private'] as JournalVisibility[]).map((v) => (
              <label key={v} className="flex items-center gap-2"><input type="radio" name={'vis-' + entry.id} checked={entry.visibility === v} onChange={() => share(v, v === 'players' ? entry.sharedWith : undefined)} />
                {v === 'gm' ? 'GM only' : v === 'players' ? 'Selected players' : v === 'all' ? 'Everyone in the campaign' : 'Only me'}</label>
            ))}
            {entry.visibility === 'players' && (
              <div className="ml-6 space-y-1">{players.length === 0 ? <p className="text-ink-dim">Invite players first.</p> : players.map((m) => (
                <label key={m.userId} className="flex items-center gap-2"><input type="checkbox" checked={entry.sharedWith.includes(m.userId)} aria-label={'Share with ' + m.displayName}
                  onChange={(e) => share('players', e.target.checked ? [...entry.sharedWith, m.userId] : entry.sharedWith.filter((x) => x !== m.userId))} />{m.displayName}</label>
              ))}</div>
            )}
          </div>
        ) : <p className="text-xs text-ink-dim">{visibilityLabel(entry, members)}</p>}
      </fieldset>
      {editable && <button className="btn btn-danger" onClick={async () => {
        if (!confirm('Delete "' + entry.title + '"? This cannot be undone.')) return;
        try { await api('DELETE', '/api/journal/' + entry.id); onRemove(entry.id); } catch (x) { setStatus((x as Error).message); }
      }}>Delete entry</button>}
    </article>
  );
}
