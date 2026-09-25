import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from '@/lib/pwa';
import { ReceiptPage } from '@/receipt/ReceiptPage';
import './index.css';

registerServiceWorker();

/**
 * A customer's receipt link (`/r/<token>`) is not the counter app: no sign-in, no device, no wallet.
 * It renders on its own, and the counter app (with its wallet code) is only downloaded when it's
 * the counter app that's wanted.
 */
const receiptToken = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{1,64})\/?$/)?.[1];
const CounterApp = lazy(() => import('@/CounterApp'));

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
