import type { PaidView, PaySession } from '@clear/merchant-contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ClearSteps, type Step } from '@/clear/Steps';
import { type PayApi, PayApiError } from '@/lib/api';
import { framedBy, post } from './protocol';
import { ModalShell } from './Shell';

/**
 * `pay.useclear.org/m/:session`: the modal, in an iframe the script puts over the shop's page (pay spec
 * §2–§4). It tells the page `ready`, its height, and how it ended, posting only to the session's own
 * website. Esc and the close send `cancel`; "Back to Mi Casa Tacos" sends `success`.
 */

const SHEET_BELOW = 640;
const useSheet = () => {
  const [sheet, setSheet] = useState(() => window.innerWidth < SHEET_BELOW);
  useEffect(() => {
    const q = window.matchMedia(`(max-width: ${SHEET_BELOW - 1}px)`);
    const on = () => setSheet(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return sheet;
};

export function ModalPage({ api, initial }: { api: PayApi; initial?: Step }) {
  const { session: id = '' } = useParams();
  const [search] = useSearchParams();
  const [session, setSession] = useState<PaySession | null>(null);
  const [origin, setOrigin] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const sheet = useSheet();
  const root = useRef<HTMLDivElement>(null);
  const framed = window.parent !== window;

  useEffect(() => {
    let live = true;
    Promise.all([api.session(id), api.frameOrigin(id)]).then(
      ([s, o]) => {
        if (!live) return;
        setOrigin(o.origin);
        setSession(s);
        if (framed && !framedBy(o.origin, (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins)) setFailed('This page can only open on the shop’s own website.');
      },
      (e: unknown) => {
        if (!live) return;
        setOrigin(null);
        setFailed(e instanceof PayApiError && (e.status === 404 || e.status === 410) ? 'This checkout has ended.' : 'Clear couldn’t open this checkout.');
      },
    );
    return () => {
      live = false;
    };
  }, [api, id, framed]);

  // Ready once drawn; then its height, whenever it changes.
  useLayoutEffect(() => {
    if (!session || !origin) return;
    post(origin, { type: 'ready' });
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => post(origin, { type: 'resize', height: Math.ceil(el.getBoundingClientRect().height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [session, origin]);

  const cancel = useCallback(() => post(origin ?? null, { type: 'cancel' }), [origin]);
  const paidRef = useRef<PaidView | null>(null);

  /** The page gets the payment's id, status and reference, and nothing else. */
  const success = useCallback(async () => {
    const s = await api.session(id).catch(() => session);
    if (s?.payment) post(origin ?? null, { type: 'success', id: s.payment.id, status: 'succeeded', reference: s.payment.reference });
  }, [api, id, origin, session]);

  // Esc inside the frame never reaches the page, so the frame says so itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (paidRef.current) void success();
      else cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, success]);

  useEffect(() => {
    if (failed && origin) post(origin, { type: 'error', code: failed.includes('ended') ? 'session_expired' : 'unavailable', message: failed });
  }, [failed, origin]);

  // The card's window comes back here (`?paid=1`), outside the shop's page: it only says so.
  if (!framed && search.get('paid') === '1') {
    return (
      <div className="pay-modal-page">
        <p className="pw-note">Paid. You can close this window and go back to the shop.</p>
      </div>
    );
  }
  if (failed || (origin === null && !session)) {
    return (
      <div className="pay-modal-page" ref={root}>
        <div className="pw-modal pay-modal">
          <div className="pw-mbody">
            <p className="pw-h">{failed?.includes('ended') ? 'This checkout has ended' : 'Clear can’t open this'}</p>
            <p className="pw-d">{failed ?? 'Close it and start again on the shop’s page.'}</p>
            {framed ? (
              <button type="button" className="pw-btn" onClick={cancel}>
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  if (!session) return <div className="pay-modal-page" ref={root} aria-busy="true" />;

  const done = session.state === 'paid';
  return (
    <div className="pay-modal-page" ref={root}>
      <ModalShell session={session} sheet={sheet} onClose={() => (paidRef.current || done ? void success() : cancel())}>
        {session.state === 'expired' || session.state === 'canceled' ? (
          <div className="pw-mbody">
            <p className="pw-h">This checkout has ended</p>
            <p className="pw-d">Close it and start again{session.shopHost ? ` on ${session.shopHost}` : ''}.</p>
          </div>
        ) : (
          <ClearSteps
            api={api}
            session={session}
            layout={sheet ? 'sheet' : 'modal'}
            initial={initial}
            onPaid={(p) => (paidRef.current = p)}
            onBack={() => void success()}
          />
        )}
      </ModalShell>
    </div>
  );
}
