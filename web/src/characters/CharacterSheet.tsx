/**
 * Character sheet editor. Layout comes entirely from the campaign ruleset's sheet sections, so a new
 * game system gets a working sheet without UI changes. Edits save on blur, one request at a time,
 * always against the latest version (the server rejects stale writes with 409).
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { getRuleset } from '../../../shared/rules/registry';
import type { CharacterView, SheetValue } from '../../../shared/characters';
import type { SheetField } from '../../../shared/rules/types';

export interface MemberLite { userId: string; displayName: string; role: string }

export function CharacterSheet({ characterId, canManage, members, onClose, onChanged }: {
  characterId: string; canManage: boolean; members: MemberLite[]; onClose?: () => void; onChanged?: (c: CharacterView | null) => void;
}) {
  const [char, setChar] = useState<CharacterView | null>(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const ref = useRef<CharacterView | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const load = () => api<CharacterView>('GET', '/api/characters/' + characterId).then((c) => { ref.current = c; setChar(c); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [characterId]);

  const save = (patch: Record<string, unknown>) => {
    queue.current = queue.current.then(async () => {
      if (!ref.current) return;
      setStatus('Saving…');
      try {
        const c = await api<CharacterView>('PATCH', '/api/characters/' + characterId, { baseVersion: ref.current.version, ...patch });
        ref.current = c; setChar(c); setStatus('Saved'); onChanged?.(c);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) { setStatus('Someone else edited this sheet; reloaded their version.'); await load(); }
        else setStatus((e as Error).message);
      }
    });
  };

  if (err) return <div className="p-3 text-sm text-danger" role="alert">{err}</div>;
  if (!char) return <div className="p-3 text-sm text-ink-dim">Loading sheet…</div>;
  const rs = getRuleset(char.rulesetId);
  const players = members.filter((m) => m.role !== 'spectator');
  return (
    <section className="space-y-3 p-3 text-sm" aria-label={'Character sheet: ' + char.name} data-testid="character-sheet">
      <div className="flex items-center gap-2">
        <TextInput label="Character name" className="input font-semibold" value={char.name} onCommit={(v) => v.trim() && save({ name: v.trim() })} />
        {onClose && <button className="btn px-2" aria-label="Close sheet" onClick={onClose}>✕</button>}
      </div>
      <div className="flex items-center justify-between text-xs text-ink-dim">
        <span>{rs.manifest.name}{char.sheetSchemaVersion !== rs.sheet.schemaVersion ? ' · sheet v' + char.sheetSchemaVersion + ' (current v' + rs.sheet.schemaVersion + ')' : ''}</span>
        <span role="status" aria-live="polite">{status}</span>
      </div>
      {canManage ? (
        <label className="block"><span className="label">Played by</span>
          <select className="input" value={char.ownerId ?? ''} onChange={(e) => save({ ownerId: e.target.value || null })}>
            <option value="">Nobody (GM character)</option>
            {players.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </select></label>
      ) : <p className="text-xs text-ink-dim">Played by {char.ownerName ?? 'the GM'}</p>}
      {rs.sheet.sections.map((s) => (
        <fieldset key={s.id} className="rounded-md border border-line p-2">
          <legend className="section-title px-1">{s.label}</legend>
          <div className="grid grid-cols-2 gap-2">
            {s.fields.map((f) => <Field key={f.key} f={f} value={char.data[f.key]} onCommit={(v) => save({ data: { [f.key]: v } })} />)}
          </div>
        </fieldset>
      ))}
      {canManage || char.ownerId ? <button className="btn btn-danger" onClick={async () => {
        if (!confirm('Delete ' + char.name + '? This cannot be undone.')) return;
        try { await api('DELETE', '/api/characters/' + char.id); onChanged?.(null); onClose?.(); } catch (e) { setStatus((e as Error).message); }
      }}>Delete character</button> : null}
    </section>
  );
}

function TextInput({ label, value, onCommit, className, multiline }: { label: string; value: string; onCommit: (v: string) => void; className?: string; multiline?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return multiline
    ? <textarea aria-label={label} className={className ?? 'input h-24'} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} maxLength={10000} />
    : <input aria-label={label} className={className ?? 'input'} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={200} />;
}

function NumInput({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => setV(value == null ? '' : String(value)), [value]);
  const commit = () => { const n = v.trim() === '' ? null : Number(v); if (n !== null && !Number.isFinite(n)) { setV(value == null ? '' : String(value)); return; } if (n !== value) onCommit(n); };
  return <input aria-label={label} className="input" type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function Field({ f, value, onCommit }: { f: SheetField; value: SheetValue | undefined; onCommit: (v: SheetValue | null) => void }) {
  if (f.type === 'textarea') return <label className="col-span-2"><span className="label">{f.label}</span><TextInput multiline label={f.label} value={typeof value === 'string' ? value : ''} onCommit={(v) => onCommit(v === '' ? null : v)} /></label>;
  if (f.type === 'text') return <label className="col-span-2"><span className="label">{f.label}</span><TextInput label={f.label} value={typeof value === 'string' ? value : ''} onCommit={(v) => onCommit(v === '' ? null : v)} /></label>;
  if (f.type === 'number') return <label><span className="label">{f.label}</span><NumInput label={f.label} value={typeof value === 'number' ? value : null} onCommit={onCommit} /></label>;
  const r = value && typeof value === 'object' ? value : { value: 0, max: null };
  return (
    <div className="col-span-2"><span className="label">{f.label}</span>
      <div className="flex items-center gap-2">
        <NumInput label={f.label + ' current'} value={value ? r.value : null} onCommit={(n) => onCommit(n === null ? null : { value: n, max: r.max })} />
        <span className="text-ink-dim">/</span>
        <NumInput label={f.label + ' maximum'} value={r.max} onCommit={(n) => onCommit({ value: r.value, max: n })} />
      </div>
    </div>
  );
}
