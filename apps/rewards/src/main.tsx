import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { PREVIEW } from './lib/env';
import type { Who } from './data/mock';

/**
 * The preview (`?preview=1`, dev only) runs on the spec's seeded shops and people; anything else is
 * the live app, on Privy and the API. Privy isn't loaded at all in the preview.
 */
const PreviewApp = lazy(() => import('./auth/PreviewAuth').then((m) => ({ default: m.PreviewApp })));
const PrivyApp = lazy(() => import('./auth/PrivyAuth').then((m) => ({ default: m.PrivyApp })));

const as = (new URLSearchParams(window.location.search).get('as') ?? 'sofia') as Who | 'out';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {PREVIEW ? (
        <PreviewApp as={as}>
          <App />
        </PreviewApp>
      ) : (
        <PrivyApp>
          <App />
        </PrivyApp>
      )}
    </Suspense>
  </StrictMode>,
);
