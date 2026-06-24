import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PreviewApp from './PreviewApp'
import { registerServiceWorker } from './utils/serviceWorker'

// Buffer polyfill for XMTP
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

// Dev-only design preview: renders the redesigned UI without the wallet stack so it
// can be screenshotted in a headless sandbox. The real app (App + AppKitProvider) is
// imported only when NOT in preview, so its module side-effects never run here.
// Never active in production.
const usePreview =
  import.meta.env.DEV &&
  (import.meta.env.VITE_PREVIEW === 'true' ||
    new URLSearchParams(window.location.search).has('preview'));

// Register service worker for background sync
if (import.meta.env.PROD) {
  registerServiceWorker().catch((error) => {
    console.error('Failed to register service worker:', error);
  });
}

const root = createRoot(document.getElementById('root')!);

if (usePreview) {
  root.render(
    <StrictMode>
      <PreviewApp />
    </StrictMode>,
  );
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
