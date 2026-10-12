import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const prefs = JSON.parse(localStorage.getItem('od.prefs') || '{}');
if (prefs.theme === 'light') document.documentElement.classList.replace('dark', 'light');
if (prefs.textScale) document.documentElement.style.setProperty('--od-text-scale', prefs.textScale + '%');
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
