import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerServiceWorker } from './utils/serviceWorker'
import { initAnalytics } from './lib/analytics'

// Plausible analytics — injects only on the live app (app.useclear.org); no-op in dev/preview.
initAnalytics();

// Buffer polyfill for XMTP — must be set before App/AppKit/XMTP modules load, so App and
// AppKitProvider are imported dynamically below (after this runs).
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

// Register service worker for background sync
if (import.meta.env.PROD) {
  registerServiceWorker().catch((error) => {
    console.error('Failed to register service worker:', error);
  });
}

const root = createRoot(document.getElementById('root')!);

// Dev-only visual harness for the rebuild (`/?preview=1`): renders the shell and
// pages without AppKit or auth, which otherwise gate everything behind a wallet.
// The import is inside the DEV branch, so it never reaches a production bundle.
const previewMode =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1';

if (previewMode) {
  void import('./PreviewApp.tsx').then(({ default: PreviewApp }) => {
    root.render(
      <StrictMode>
        <PreviewApp />
      </StrictMode>,
    );
  });
} else {
  void Promise.all([import('./App.tsx'), import('./AppKitProvider')]).then(
    ([{ default: App }, { AppKitProvider }]) => {
      root.render(
        <StrictMode>
          <AppKitProvider>
            <App />
          </AppKitProvider>
        </StrictMode>,
      );
    },
  );
}
