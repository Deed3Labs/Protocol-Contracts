import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppKitProvider } from './AppKitProvider'
import { registerServiceWorker } from './utils/serviceWorker'

// Buffer polyfill for XMTP
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

// Register service worker for background sync
if (import.meta.env.PROD) {
  registerServiceWorker().catch((error) => {
    console.error('Failed to register service worker:', error);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppKitProvider>
      <App />
    </AppKitProvider>
  </StrictMode>
)
