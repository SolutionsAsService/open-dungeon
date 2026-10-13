/** Thin JSON client for the HTTP API. All mutating calls send the CSRF header the server requires. */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

import { isLocalMode, localModeSync } from './local/mode';

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (await isLocalMode()) {
    const { localFetch } = await import('./local/backend');
    const r = await localFetch(method, path, { 'x-od-client': '1' }, body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)));
    if (r.status >= 400) throw new ApiError(r.status, r.json?.error || 'Request failed (' + r.status + ')');
    return r.json as T;
  }
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'x-od-client': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || 'Request failed (' + r.status + ')');
  return j as T;
}

export async function uploadImage(campaignId: string, file: File): Promise<{ id: string; width: number | null; height: number | null }> {
  if (await isLocalMode()) {
    const { localFetch } = await import('./local/backend');
    const out = await localFetch('POST', '/api/campaigns/' + campaignId + '/assets', { 'x-od-client': '1', 'x-filename': encodeURIComponent(file.name).slice(0, 120) }, new Uint8Array(await file.arrayBuffer()));
    if (out.status >= 400) throw new ApiError(out.status, out.json?.error || 'Upload failed');
    return out.json;
  }
  const r = await fetch('/api/campaigns/' + campaignId + '/assets', { method: 'POST', credentials: 'same-origin', headers: { 'x-od-client': '1', 'x-filename': encodeURIComponent(file.name).slice(0, 120) }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || 'Upload failed');
  return j;
}
export const assetUrl = (id: string) => '/api/assets/' + id;

const blobUrls = new Map<string, Promise<string>>();
/** URL usable as an <img> src in both modes (local mode serves assets from IndexedDB via blob URLs). */
export function assetSrc(id: string): Promise<string> {
  if (!localModeSync()) return Promise.resolve(assetUrl(id));
  let p = blobUrls.get(id);
  if (!p) {
    p = import('./local/backend').then(async ({ localFetch }) => {
      const r = await localFetch('GET', assetUrl(id), {});
      if (r.status !== 200 || !r.binary) throw new ApiError(r.status, 'Image not found');
      return URL.createObjectURL(new Blob([r.binary as BlobPart], { type: r.contentType }));
    });
    blobUrls.set(id, p);
  }
  return p;
}
