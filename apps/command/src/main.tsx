import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import './styles/command.css';
import { App } from './App';
import { ANSWERS, LIVE, REAL } from './live/env';
import { registerServiceWorker } from './live/pwa';

// The shell goes in first and synchronously: the sections' start-up code reads it, as the
// prototype's script did when it ran at the end of the page.
const root = createRoot(document.getElementById('app')!);
flushSync(() => root.render(<App />));

// Privy has a root of its own, so its state never redraws the shell. The preview doesn't load it.
if (LIVE && !ANSWERS) {
  import('./live/privy').then(({ PrivyBridge }) => {
    const el = document.createElement('div');
    el.id = 'privyRoot';
    document.body.appendChild(el);
    createRoot(el).render(<PrivyBridge />);
  });
}

// real data only (Phase 9): the prototype's datasets are emptied before anything draws, live and in the empty preview
import('./sections/index').then(async ({ startup }) => {
  if (REAL) (await import('./live/empty')).emptyData();
  startup();
});
// in development, a hot update can run sections/data.tsx again with the prototype's data in it: load afresh instead
if (REAL && import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => window.location.reload());

// installable, and opens on a poor connection: the shell only, never the API (public/sw.js)
registerServiceWorker();
