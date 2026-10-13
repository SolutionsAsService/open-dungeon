import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { isLocalMode } from './local/mode';

const prefs = JSON.parse(localStorage.getItem('od.prefs') || '{}');
if (prefs.theme === 'light') document.documentElement.classList.replace('dark', 'light');
if (prefs.textScale) document.documentElement.style.setProperty('--od-text-scale', prefs.textScale + '%');
// Decide server vs in-browser local mode before the first render (see web/src/local/mode.ts).
isLocalMode().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));
