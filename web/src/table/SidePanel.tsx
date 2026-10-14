import { useEffect, useRef, useState } from 'react';
import { useTable, isGm, upsertJournal, removeJournal } from './store';
import { Journal } from '../journal/Journal';
import type { TableSocket } from './socket';
import type { TableEngine } from './engine';
import type { ChatView, TokenView } from '../../../shared/protocol';
import { getRuleset } from '../../../shared/rules/registry';
import { uploadImage, api } from '../api';
import { CharacterList } from '../characters/CharacterList';
import type { CharacterView } from '../../../shared/characters';
import { MiniLibraryPanel } from '../minis/MiniLibraryPanel';
import { useMinis } from '../minis/library';

type Tab = 'chat' | 'turns' | 'party' | 'sheets' | 'journal' | 'minis';

export function SidePanel({ socket, engine }: { socket: TableSocket; engine: TableEngine | null }) {
  const tab = useTable((s) => s.panelTab);
  const setTab = (t: Tab) => useTable.setState({ panelTab: t });
  const selected = useTable((s) => (s.selectedId ? s.tokens[s.selectedId] : null));
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel" aria-label="Side panel">
      {selected && <Inspector key={selected.id} token={selected} socket={socket} engine={engine} />}
      <div role="tablist" className="flex border-b border-line">
        {(['chat', 'turns', 'party', 'sheets', 'journal', 'minis'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={'flex-1 px-0.5 py-2 text-[11px] font-semibold uppercase tracking-normal ' + (tab === t ? 'border-b-2 border-accent text-ink' : 'text-ink-dim hover:text-ink')}>
            {t === 'turns' ? 'Turn order' : t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' && <Chat socket={socket} />}
        {tab === 'turns' && <Initiative socket={socket} />}
        {tab === 'party' && <Party engine={engine} />}
        {tab === 'sheets' && <Sheets />}
        {tab === 'journal' && <JournalTab />}
        {tab === 'minis' && <MiniLibraryPanel socket={socket} />}
      </div>
    </aside>
  );
}

function Sheets() {
  const session = useTable((s) => s.session);
  const me = useTable((s) => s.me);
  const members = useTable((s) => s.members);
  const openId = useTable((s) => s.openCharacterId);
  if (!session || !me) return null;
  return <div className="h-full overflow-y-auto"><CharacterList campaignId={session.campaignId} role={me.role} members={members} openId={openId} onOpen={(id) => useTable.setState({ openCharacterId: id })} /></div>;
}

function JournalTab() {
  const session = useTable((s) => s.session);
  const me = useTable((s) => s.me);
  const members = useTable((s) => s.members);
  const entries = useTable((s) => s.journal);
  const openId = useTable((s) => s.openJournalId);
  if (!session || !me) return null;
  return <div className="h-full overflow-y-auto"><Journal campaignId={session.campaignId} role={me.role} meId={me.id} members={members} entries={entries} onUpsert={upsertJournal} onRemove={removeJournal} openId={openId} onOpen={(id) => useTable.setState({ openJournalId: id })} /></div>;
}

/** GM-only picker linking a token to a campaign character. */
function CharacterLink({ token, onPick }: { token: TokenView; onPick: (id: string | null) => void }) {
  const campaignId = useTable((s) => s.session?.campaignId);
  const [list, setList] = useState<CharacterView[]>([]);
  useEffect(() => { if (campaignId) api<{ characters: CharacterView[] }>('GET', '/api/campaigns/' + campaignId + '/characters').then((r) => setList(r.characters)).catch(() => undefined); }, [campaignId]);
  return (
    <label><span className="label">Character sheet</span>
      <select className="input" value={token.characterId ?? ''} onChange={(e) => onPick(e.target.value || null)} aria-label="Linked character">
        <option value="">None</option>
        {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
  );
}

function Inspector({ token, socket, engine }: { token: TokenView; socket: TableSocket; engine: TableEngine | null }) {
  const s = useTable();
  const gm = isGm(s);
  const canEdit = gm || (token.ownerIds.includes(s.me!.id) && !token.locked);
  const rs = getRuleset(s.session?.rulesetId ?? 'generic');
  const players = s.members.filter((m) => m.role === 'player');
  const miniItems = useMinis((m) => m.items);
  const [name, setName] = useState(token.name);
  useEffect(() => setName(token.name), [token.name]);
  const patch = (p: Record<string, unknown>) => socket.send({ type: 'token.update', id: token.id, baseVersion: token.version, patch: p as any });
  const num = (v: string) => (v === '' ? null : Math.trunc(Number(v)));
  return (
    <section className="border-b border-line p-3 text-sm" aria-label="Selected token" data-testid="inspector">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-4 w-4 rounded-full" style={{ background: token.color }} aria-hidden />
        <input className="input font-semibold" aria-label="Token name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={() => name !== token.name && patch({ name })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <button className="btn px-2" title="Centre on token (C)" aria-label="Centre on token" onClick={() => engine?.centerOnSelected()}>⌖</button>
        <button className="btn px-2" aria-label="Deselect" onClick={() => useTable.setState({ selectedId: null })}>✕</button>
      </div>
      {!canEdit && <p className="mb-2 text-xs text-ink-dim">You can view this token but not change it.</p>}
      <div className="grid grid-cols-4 gap-2">
        <label className="col-span-1"><span className="label">X</span><input className="input" type="number" disabled={!canEdit} value={Math.round(token.x)} onChange={(e) => socket.moveToken(token.id, Number(e.target.value), token.y)} /></label>
        <label className="col-span-1"><span className="label">Y</span><input className="input" type="number" disabled={!canEdit} value={Math.round(token.y)} onChange={(e) => socket.moveToken(token.id, token.x, Number(e.target.value))} /></label>
        <label className="col-span-1"><span className="label">Turn°</span><input className="input" type="number" step={15} disabled={!canEdit} value={token.rotation} onChange={(e) => patch({ rotation: ((Number(e.target.value) % 360) + 360) % 360 })} /></label>
        <label className="col-span-1"><span className="label">Size</span><select className="input" disabled={!canEdit} value={token.size} onChange={(e) => patch({ size: Number(e.target.value) })}>{[0.5, 1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        {rs.manifest.capabilities.health && <>
          <label className="col-span-2"><span className="label">HP</span><input className="input" type="number" disabled={!canEdit} value={token.hp ?? ''} onChange={(e) => patch({ hp: num(e.target.value) })} /></label>
          <label className="col-span-2"><span className="label">Max HP</span><input className="input" type="number" min={0} disabled={!canEdit} value={token.hpMax ?? ''} onChange={(e) => patch({ hpMax: num(e.target.value) })} /></label>
        </>}
        <label className="col-span-2"><span className="label">Colour</span><input type="color" className="h-8 w-full" disabled={!canEdit} value={token.color} onChange={(e) => patch({ color: e.target.value })} /></label>
        {canEdit && <label className="col-span-2"><span className="label">Artwork</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-xs" disabled={!gm} title={gm ? '' : 'Only the GM can upload images'} onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file || !s.session) return;
          try { const a = await uploadImage(s.session.campaignId, file); patch({ assetId: a.id }); } catch (x) { useTable.setState({ toast: { text: (x as Error).message, kind: 'error', at: Date.now() } }); }
        }} /></label>}
      </div>
      <div className="mt-2"><span className="label">Conditions</span>
        <div className="flex flex-wrap gap-1">{rs.conditions.map((c) => {
          const on = token.conditions.includes(c.id);
          return <button key={c.id} disabled={!canEdit} aria-pressed={on} className={'rounded-full border px-2 py-0.5 text-xs ' + (on ? 'border-accent bg-accent/20' : 'border-line text-ink-dim')} onClick={() => patch({ conditions: on ? token.conditions.filter((x) => x !== c.id) : [...token.conditions, c.id] })}>{c.label}</button>;
        })}</div>
      </div>
      {token.characterId && <button className="btn mt-2 w-full" onClick={() => useTable.setState({ panelTab: 'sheets', openCharacterId: token.characterId })}>Open character sheet</button>}
      {gm && <div className="mt-2 grid gap-2">
        <CharacterLink token={token} onPick={(id) => patch({ characterId: id })} />
        <label><span className="label">3D miniature</span>
          <select className="input" value={token.miniId ?? ''} onChange={(e) => patch({ miniId: e.target.value || null })} aria-label="3D miniature">
            <option value="">Plain pawn</option>
            {miniItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select></label>
        <label><span className="label">Controlled by</span>
          <select className="input" multiple size={Math.min(4, Math.max(2, players.length))} value={token.ownerIds} onChange={(e) => patch({ ownerIds: [...e.target.selectedOptions].map((o) => o.value) })} aria-label="Players who control this token">
            {players.length === 0 && <option disabled>Invite players first</option>}
            {players.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </select></label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1"><input type="checkbox" checked={token.hidden} onChange={(e) => patch({ hidden: e.target.checked })} /> Hidden from players</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={token.locked} onChange={(e) => patch({ locked: e.target.checked })} /> Locked</label>
        </div>
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={() => socket.send({ type: 'token.create', name: token.name, category: token.category as any, color: token.color, x: token.x + 70, y: token.y, size: token.size, hidden: token.hidden, ownerIds: token.ownerIds, assetId: token.assetId, miniId: token.miniId, locked: token.locked })}>Duplicate</button>
          <button className="btn flex-1" onClick={() => socket.send({ type: 'init.add', tokenId: token.id, name: token.name || 'Token', initiative: null, hidden: token.hidden, ...(rs.encounter?.initiativeFormula ? { rollExpression: rs.encounter.initiativeFormula } : {}) })}>Add to turns</button>
          <button className="btn btn-danger" onClick={() => confirm('Delete this token?') && socket.send({ type: 'token.delete', id: token.id })}>Delete</button>
        </div>
      </div>}
    </section>
  );
}

function RollBody({ m }: { m: ChatView }) {
  const r = m.roll!;
  return (
    <div>
      {r.label && <div className="text-xs text-ink-dim">{r.label}</div>}
      <div className="flex items-baseline gap-2"><span className="font-mono text-xs text-ink-dim">{r.expression}</span><span className="text-2xl font-bold text-accent" data-testid="roll-total">{r.total}</span></div>
      <div className="flex flex-wrap gap-1 text-xs">
        {r.terms.map((t, i) => t.kind === 'dice'
          ? <span key={i}>{t.sign < 0 ? '−' : i ? '+' : ''}[{t.rolls!.map((d, j) => <span key={j} className={d.kept ? '' : 'text-ink-dim line-through'}>{j ? ',' : ''}{d.value}</span>)}]</span>
          : <span key={i}>{t.sign < 0 ? '−' : '+'}{t.value}</span>)}
      </div>
    </div>
  );
}

function Chat({ socket }: { socket: TableSocket }) {
  const chat = useTable((s) => s.chat);
  const me = useTable((s) => s.me);
  const [text, setText] = useState('');
  const [vis, setVis] = useState<'public' | 'gm' | 'self'>('public');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  const submit = () => {
    const t = text.trim(); if (!t) return;
    const m = /^\/(r|roll)\s+(.+)$/i.exec(t);
    if (m) socket.send({ type: 'dice.roll', expression: m[2], visibility: vis }); else socket.send({ type: 'chat.send', body: t, visibility: vis });
    setText('');
  };
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite" data-testid="chat-log">
        {chat.length === 0 && <p className="text-ink-dim">No messages yet. Type below, or roll with <code>/r 1d20+3</code>.</p>}
        {chat.map((m) => (
          <div key={m.id} className={'rounded-md p-2 ' + (m.visibility !== 'public' ? 'bg-gm/10 ring-1 ring-gm/40' : 'bg-panel-2')}>
            <div className="flex justify-between text-xs text-ink-dim"><span className={m.userId === me?.id ? 'text-accent' : ''}>{m.userName}{m.visibility === 'gm' ? ' → GM' : m.visibility === 'self' ? ' (private)' : ''}</span><time>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            {m.kind === 'roll' ? <RollBody m={m} /> : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea className="input h-16 resize-none" aria-label="Chat message" placeholder="Message, or /r 2d6+1" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="mt-1 flex gap-2">
          <select className="input" aria-label="Who can see this" value={vis} onChange={(e) => setVis(e.target.value as any)}><option value="public">Everyone</option><option value="gm">GM only</option><option value="self">Only me</option></select>
          <button className="btn btn-primary">Send</button>
        </div>
      </form>
    </div>
  );
}

function Initiative({ socket }: { socket: TableSocket }) {
  const s = useTable();
  const gm = isGm(s);
  const init = s.initiative;
  const rs = getRuleset(s.session?.rulesetId ?? 'generic');
  const [name, setName] = useState('');
  // Rendered as an element (not a nested component) so the input keeps focus while typing.
  const addRow = (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; socket.send({ type: 'init.add', tokenId: null, name, initiative: null, hidden: false, ...(rs.encounter?.initiativeFormula ? { rollExpression: rs.encounter.initiativeFormula } : {}) }); setName(''); }}>
      <input className="input" placeholder="Add combatant" aria-label="Combatant name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /><button className="btn">Add</button></form>
  );
  if (!rs.encounter && !init.participants.length) return <div className="p-3 text-sm text-ink-dim">{rs.manifest.name} doesn't use turn order.{gm && <> You can still add combatants if your table wants one.{addRow}</>}</div>;
  return (
    <div className="flex h-full flex-col p-3 text-sm">
      <div className="mb-2 flex items-center justify-between"><span className="section-title">{init.active ? 'Round ' + init.round : 'Not started'}</span>
        {gm && <div className="flex gap-1">
          {init.active && <button className="btn px-2" aria-label="Previous turn" onClick={() => socket.send({ type: 'init.advance', dir: -1 })}>◀</button>}
          <button className="btn btn-primary" onClick={() => socket.send({ type: 'init.advance', dir: 1 })} disabled={!init.participants.length}>{init.active ? 'Next turn' : 'Start'}</button>
          <button className="btn" onClick={() => confirm('Clear the turn order?') && socket.send({ type: 'init.reset' })}>Reset</button>
        </div>}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="initiative-list">
        {init.participants.length === 0 && <li className="text-ink-dim">No combatants. {gm ? 'Select a token and press "Add to turns", or add one by name.' : ''}</li>}
        {init.participants.map((p) => (
          <li key={p.id} className={'flex items-center gap-2 rounded-md border px-2 py-1 ' + (init.activeId === p.id ? 'border-yellow-400 bg-yellow-400/10' : 'border-line')} aria-current={init.activeId === p.id ? 'true' : undefined}>
            {gm ? <input className="input w-14 px-1 text-center" type="number" aria-label={'Initiative for ' + p.name} value={p.initiative ?? ''} onChange={(e) => socket.send({ type: 'init.update', id: p.id, initiative: e.target.value === '' ? null : Number(e.target.value) })} />
              : <span className="w-8 text-center font-mono">{p.initiative ?? '–'}</span>}
            <button className="flex-1 truncate text-left" onClick={() => p.tokenId && useTable.setState({ selectedId: p.tokenId })}>{p.name}{p.hidden && <span className="ml-1 text-xs text-gm">(hidden)</span>}</button>
            {gm && <button className="text-ink-dim hover:text-danger" aria-label={'Remove ' + p.name} onClick={() => socket.send({ type: 'init.remove', id: p.id })}>✕</button>}
          </li>
        ))}
      </ol>
      {gm && addRow}
    </div>
  );
}

function Party({ engine }: { engine: TableEngine | null }) {
  const members = useTable((s) => s.members);
  const tokens = useTable((s) => s.tokens);
  return (
    <div className="space-y-3 overflow-y-auto p-3 text-sm">
      {members.map((m) => {
        const owned = Object.values(tokens).filter((t) => t.ownerIds.includes(m.userId));
        return (
          <div key={m.userId} className="rounded-md border border-line p-2">
            <div className="flex justify-between"><span className="font-semibold">{m.displayName}</span><span className={'text-xs ' + (m.online ? 'text-ok' : 'text-ink-dim')}>{m.online ? 'online' : 'away'} · {m.role.replace('_', ' ')}</span></div>
            {owned.map((t) => <button key={t.id} className="mt-1 block text-left text-xs text-ink-dim hover:text-ink" onClick={() => { useTable.setState({ selectedId: t.id }); engine?.centerOn(t); }}>● {t.name || 'token'}{t.hp != null && t.hpMax ? ' — ' + t.hp + '/' + t.hpMax : ''}</button>)}
          </div>
        );
      })}
    </div>
  );
}
