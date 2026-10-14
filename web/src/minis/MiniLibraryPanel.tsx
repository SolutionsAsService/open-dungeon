/**
 * Side-panel list of miniatures: bundled, private library (server) and figures uploaded to this campaign.
 * GMs drag one onto the 2D or 3D table (or press Place) to create a token. Uploads (STL/OBJ/glTF) are converted
 * by the server (ADR 0011); players may upload when the GM allows it and put their figures on tokens they control.
 */
import { useRef, useState } from 'react';
import { useMinis, MINI_MIME, loadCampaignMinis, type MiniEntry } from './library';
import { useTable, isGm, toast } from '../table/store';
import type { TableSocket } from '../table/socket';
import { placeMini } from '../../../shared/minis';
import { api, uploadFile } from '../api';
import { canEditToken, type Role } from '../../../shared/permissions';

const MAX_BYTES = 20 * 1024 * 1024;

export function MiniLibraryPanel({ socket }: { socket: TableSocket }) {
  const gm = useTable(isGm);
  const map = useTable((s) => s.map);
  const me = useTable((s) => s.me);
  const selected = useTable((s) => (s.selectedId ? s.tokens[s.selectedId] : null));
  const { items: all, campaignId, canUpload, playerUploads } = useMinis();
  const [q, setQ] = useState('');
  const items = all.filter((i) => (i.name + ' ' + i.family + ' ' + (i.ownerName ?? '')).toLowerCase().includes(q.toLowerCase()));
  const place = (i: MiniEntry) => map && socket.send(placeMini(i, { x: map.width / 2, y: map.height / 2 }, map.grid));
  const mine = (i: MiniEntry) => i.origin === 'uploaded' && i.ownerId === me?.id;
  const canUse = (i: MiniEntry) => !!selected && !!me && (gm || (mine(i) && canEditToken(me.role as Role, me.id, selected)));
  const use = (i: MiniEntry) => selected && socket.send({ type: 'token.update', id: selected.id, patch: { miniId: i.id }, baseVersion: selected.version });
  const reload = () => campaignId && loadCampaignMinis(campaignId).catch((e) => toast(e.message));
  const base = campaignId ? '/api/campaigns/' + campaignId : '';

  const row = (i: MiniEntry) => (
    <li key={i.id} draggable={gm} data-mini={i.id} onDragStart={(e) => { e.dataTransfer.setData(MINI_MIME, i.id); e.dataTransfer.effectAllowed = 'copy'; }}
      className={'flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1.5 ' + (gm ? 'cursor-grab active:cursor-grabbing' : '')} title={i.description}>
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/30 text-base">{i.kind === 'scenery' ? '♜' : '♟'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{i.name}</span>
        <span className="block truncate text-xs text-ink-dim">{i.origin === 'uploaded' ? 'by ' + i.ownerName : i.family} · {i.cells}×{i.cells} sq · {Math.round(i.footprintMm)} mm base · {Math.round(i.heightMm)} mm tall</span>
      </span>
      {gm && <button className="btn px-2 text-xs" onClick={() => place(i)} aria-label={'Place ' + i.name + ' at the map centre'}>Place</button>}
      {!gm && canUse(i) && <button className="btn px-2 text-xs" onClick={() => use(i)} aria-label={'Use ' + i.name + ' on the selected token'}>Use</button>}
      {i.canEdit && <>
        <button className="btn px-1.5 text-xs" aria-label={'Rename ' + i.name} title="Rename" onClick={async () => {
          const name = prompt('Rename figure', i.name)?.trim(); if (!name || name === i.name) return;
          try { await api('PATCH', base + '/minis/' + i.id, { name: name.slice(0, 60) }); reload(); } catch (e) { toast((e as Error).message); }
        }}>✎</button>
        <button className="btn px-1.5 text-xs" aria-label={'Delete ' + i.name} title="Delete" onClick={async () => {
          if (!confirm('Delete "' + i.name + '"? Tokens using it become plain pawns.')) return;
          try { await api('DELETE', base + '/minis/' + i.id); reload(); } catch (e) { toast((e as Error).message); }
        }}>🗑</button>
      </>}
    </li>
  );
  const group = (list: MiniEntry[], title: string) => list.length ? <section className="mb-3"><h3 className="label mb-1">{title}</h3><ul className="grid gap-1">{list.map(row)}</ul></section> : null;
  const lib = items.filter((i) => i.origin !== 'uploaded');
  return (
    <div className="h-full overflow-y-auto p-3 text-sm" data-testid="mini-library">
      <p className="mb-2 text-xs text-ink-dim">{gm ? 'Drag a miniature onto the table (2D or 3D). It snaps to the grid by its base: 25–40 mm = 1 square, larger = 2×2 or more. 1 square = 1 inch.' : 'Miniatures in this table’s library. The GM places them' + (canUpload ? '; you can upload your own figure and use it on a token you control.' : '.')}</p>
      <input className="input mb-3" placeholder="Search miniatures" aria-label="Search miniatures" value={q} onChange={(e) => setQ(e.target.value)} />
      {canUpload && campaignId && <UploadForm campaignId={campaignId} gm={gm} onDone={(entryId) => { reload(); if (!gm && selected && me && canEditToken(me.role as Role, me.id, selected)) socket.send({ type: 'token.update', id: selected.id, patch: { miniId: entryId }, baseVersion: selected.version }); }} />}
      {group(lib.filter((i) => i.kind === 'figure'), 'Figures')}
      {group(lib.filter((i) => i.kind === 'scenery'), 'Scenery & terrain')}
      {group(items.filter((i) => i.origin === 'uploaded'), 'Uploaded')}
      {!items.length && <p className="text-ink-dim">No miniatures match.</p>}
      {gm && useTable.getState().me?.role !== 'assistant_gm' && campaignId && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-dim">
          <input type="checkbox" checked={playerUploads} onChange={async (e) => {
            try { await api('PATCH', base + '/mini-settings', { playerUploads: e.target.checked }); reload(); } catch (x) { toast((x as Error).message); }
          }} /> Players may upload their own figures
        </label>
      )}
    </div>
  );
}

/** Pick a file, then name, up axis, optional height and base size; the server converts and stores it. */
function UploadForm({ campaignId, gm, onDone }: { campaignId: string; gm: boolean; onDone: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ name: '', up: 'auto', heightMm: '', baseMm: '', kind: 'figure' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ name: f.name.trim() || 'Figure', up: f.up, kind: f.kind });
      if (f.heightMm) qs.set('heightMm', f.heightMm);
      if (f.baseMm) qs.set('baseMm', f.baseMm);
      const r = await uploadFile<{ item: { id: string; heightMm: number }; conversion: { units: string; triangles: number; sourceTriangles: number; decimated: boolean } }>('/api/campaigns/' + campaignId + '/minis?' + qs, file);
      const c = r.conversion;
      toast('Uploaded ' + f.name + ': ' + Math.round(r.item.heightMm) + ' mm tall (' + (c.units === 'custom' ? 'scaled to your height' : 'units: ' + c.units) + ')' + (c.decimated ? ', simplified ' + c.sourceTriangles + ' → ' + c.triangles + ' triangles' : ''), 'info');
      setFile(null); onDone(r.item.id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mb-3">
      <input ref={input} type="file" className="hidden" accept=".stl,.obj,.glb,.gltf,model/stl,model/obj,model/gltf-binary,model/gltf+json" data-testid="mini-upload-input" onChange={(e) => {
        const x = e.target.files?.[0]; e.target.value = '';
        if (!x) return;
        if (x.size > MAX_BYTES) { toast('That file is ' + Math.round(x.size / 1048576) + ' MB; the limit is 20 MB. Simplify or decimate it first.'); return; }
        setFile(x); setF((o) => ({ ...o, name: x.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60) }));
      }} />
      {!file && <button className="btn w-full" onClick={() => input.current?.click()}>Upload figure (STL, OBJ, GLB)</button>}
      {file && (
        <form className="grid grid-cols-2 gap-2 rounded-md border border-line p-2" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Upload figure">
          <p className="col-span-2 truncate text-xs text-ink-dim">{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>
          <label className="col-span-2"><span className="label">Name</span><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label><span className="label">Up axis</span><select className="input" value={f.up} onChange={(e) => setF({ ...f, up: e.target.value })}><option value="auto">Auto</option><option value="z">Z up (most STL)</option><option value="y">Y up (Blender, glTF)</option></select></label>
          {gm ? <label><span className="label">Kind</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="figure">Figure</option><option value="scenery">Scenery</option></select></label> : <span />}
          <label><span className="label">Height mm</span><input className="input" type="number" min={5} max={1000} placeholder="auto" value={f.heightMm} onChange={(e) => setF({ ...f, heightMm: e.target.value })} /></label>
          <label><span className="label">Base mm</span><input className="input" type="number" min={5} max={500} placeholder="auto" value={f.baseMm} onChange={(e) => setF({ ...f, baseMm: e.target.value })} /></label>
          <p className="col-span-2 text-xs text-ink-dim">Units are guessed (mm, cm, inches or metres) unless you give a height. Big meshes are simplified to 500k triangles.</p>
          <div className="col-span-2 flex gap-2"><button className="btn btn-primary flex-1" disabled={busy}>{busy ? 'Converting…' : 'Upload'}</button><button type="button" className="btn" onClick={() => setFile(null)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}
