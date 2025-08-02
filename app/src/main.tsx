import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppKitProvider } from './AppKitProvider'

// Buffer polyfill for XMTP
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppKitProvider>
      <App />
    </AppKitProvider>
  </StrictMode>
)
