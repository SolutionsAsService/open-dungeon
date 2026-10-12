/** Minimal history router (no dependency): enough for our handful of routes. */
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

const listeners = new Set<() => void>();
export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  listeners.forEach((l) => l());
}
export function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    listeners.add(on); window.addEventListener('popstate', on);
    return () => { listeners.delete(on); window.removeEventListener('popstate', on); };
  }, []);
  return p;
}
export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; [k: string]: unknown }) {
  const onClick = (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(to); };
  return <a href={to} onClick={onClick} className={className} {...rest}>{children}</a>;
}
export function match(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(path);
  return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null;
}
