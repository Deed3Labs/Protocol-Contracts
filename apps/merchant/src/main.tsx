import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from '@/lib/pwa';
import { ReceiptPage } from '@/receipt/ReceiptPage';
import { applyAppearance, readAppearance } from '@/shell/appearance';
import './index.css';

registerServiceWorker();

/**
 * A customer's receipt link (`/r/<token>`) is not the counter app: no sign-in, no device, no wallet.
 * It renders on its own, and the counter app (with its wallet code) is only downloaded when it's
 * the counter app that's wanted.
 */
const receiptToken = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{1,64})\/?$/)?.[1];
const CounterApp = lazy(() => import('@/CounterApp'));

// The tablet's own theme, before anything draws. A customer's receipt is on their phone, not this
// tablet, and stays light. In development, `?theme=dusk|dark` shows one without changing the setting.
if (!receiptToken) {
  const forced = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('theme') : null;
  if (forced === 'dusk' || forced === 'dark') document.documentElement.setAttribute('data-theme', forced);
  else if (forced !== 'light') applyAppearance(readAppearance());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {receiptToken ? (
      <ReceiptPage token={receiptToken} />
    ) : (
      <Suspense fallback={<div className="c-app c-mc-tablet" aria-busy="true" />}>
        <CounterApp />
      </Suspense>
    )}
  </StrictMode>,
);
