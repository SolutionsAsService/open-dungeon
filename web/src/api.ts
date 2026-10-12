/** Thin JSON client for the HTTP API. All mutating calls send the CSRF header the server requires. */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
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
  const r = await fetch('/api/campaigns/' + campaignId + '/assets', { method: 'POST', credentials: 'same-origin', headers: { 'x-od-client': '1', 'x-filename': encodeURIComponent(file.name).slice(0, 120) }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || 'Upload failed');
  return j;
}
export const assetUrl = (id: string) => '/api/assets/' + id;
