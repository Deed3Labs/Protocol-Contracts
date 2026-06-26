import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerServiceWorker } from './utils/serviceWorker'

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
