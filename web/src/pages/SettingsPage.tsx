import { useState } from 'react';

export function SettingsPage() {
  const [prefs, setPrefs] = useState(() => ({ theme: 'dark', textScale: 100, ...JSON.parse(localStorage.getItem('od.prefs') || '{}') }));
  const save = (p: typeof prefs) => {
    setPrefs(p); localStorage.setItem('od.prefs', JSON.stringify(p));
    document.documentElement.classList.remove('dark', 'light'); document.documentElement.classList.add(p.theme);
    document.documentElement.style.setProperty('--od-text-scale', p.textScale + '%');
  };
  return (
    <div className="card max-w-md">
      <h1 className="font-display mb-4 text-2xl text-accent">Settings</h1>
      <label className="label" htmlFor="th">Interface theme</label>
      <select id="th" className="input" value={prefs.theme} onChange={(e) => save({ ...prefs, theme: e.target.value })}><option value="dark">Dark (low glare)</option><option value="light">Light</option></select>
      <label className="label mt-4" htmlFor="ts">Text size: {prefs.textScale}%</label>
      <input id="ts" type="range" min={85} max={140} step={5} value={prefs.textScale} onChange={(e) => save({ ...prefs, textScale: Number(e.target.value) })} className="w-full" />
      <p className="mt-4 text-xs text-ink-dim">Animations follow your system's reduced-motion setting.</p>
    </div>
  );
}
