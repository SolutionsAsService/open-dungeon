/**
 * Decides once per page load whether a real server is behind this page. Static hosts answer
 * /api/me with a 404 HTML/text page (the original "sign-in 404"); then we switch to local mode.
 * VITE_LOCAL_MODE=1 forces local mode at build time.
 */
let decided: Promise<boolean> | null = null;
export function isLocalMode(): Promise<boolean> {
  return (decided ??= (async () => {
    if (import.meta.env.VITE_LOCAL_MODE === '1') return true;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', signal: ctl.signal });
      const ct = r.headers.get('content-type') ?? '';
      return !ct.includes('application/json');
    } catch { return true; } finally { clearTimeout(timer); }
  })());
}
let local = false;
isLocalMode().then((v) => { local = v; });
/** Synchronous read after the first API call has resolved. */
export const localModeSync = () => local;
