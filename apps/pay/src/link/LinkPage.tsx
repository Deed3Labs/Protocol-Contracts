import type { PaySession, PublicLink } from '@clear/merchant-contracts';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { type PayApi, PayApiError } from '@/lib/api';
import { LinkView, NoLink, ShopFrame } from './LinkView';
import { linkStep, rememberedSession, rememberSession } from './model';

/** How often a waiting page asks again: the phone pages' rate. */
const POLL_MS = 3000;

/**
 * `pay.useclear.org/l/:slug`. Paying starts a session, which makes the link's order on the server;
 * the page then follows the session until it's paid. Clear opens the Clear app's approval in a new
 * tab; card goes to the shop's own checkout and comes back here (`?s=<session>&paid=1`).
 */
export function LinkPage({ api }: { api: PayApi }) {
  const { slug = '' } = useParams();
  const [search] = useSearchParams();
  const returnedTo = search.get('s');
  const [link, setLink] = useState<PublicLink | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => returnedTo ?? rememberedSession(slug));
  const [session, setSession] = useState<PaySession | null>(null);
  const [waitingOn, setWaitingOn] = useState<'clear' | 'card' | null>(search.get('paid') === '1' ? 'card' : null);
  const [clearUrl, setClearUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'clear' | 'card' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.link(slug).then(
      (l) => live && setLink(l),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof PayApiError && e.status === 404) setMissing(true);
        else setLoadError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      },
    );
    return () => {
      live = false;
    };
  }, [api, slug]);

  useEffect(() => {
    if (returnedTo) rememberSession(slug, returnedTo);
  }, [slug, returnedTo]);

  const forget = useCallback(() => {
    rememberSession(slug, null);
    setSessionId(null);
    setSession(null);
    setWaitingOn(null);
  }, [slug]);

  const refresh = useCallback(
    async (id: string) => {
      try {
        const s = await api.session(id);
        // An order nobody paid is let go after a while; the next tap starts a new one.
        if (s.state === 'canceled') return forget();
        setSession(s);
        if (s.state !== 'open') setWaitingOn(null);
      } catch (e) {
        if (e instanceof PayApiError && e.status === 404) forget();
      }
    },
    [api, forget],
  );

  useEffect(() => {
    if (sessionId) void refresh(sessionId);
  }, [sessionId, refresh]);

  useEffect(() => {
    if (!sessionId || !waitingOn) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(sessionId);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, waitingOn, refresh]);

  const pay = async (method: 'clear' | 'card') => {
    setError(null);
    setBusy(method);
    // Clear's tab is opened on the tap itself, so the browser doesn't block it, and pointed at the
    // charge once there is one.
    const tab = method === 'clear' ? window.open('', '_blank') : null;
    try {
      let id = sessionId && (!session || session.state === 'open') ? sessionId : null;
      if (!id) {
        id = (await api.startSession(slug)).session;
        rememberSession(slug, id);
        setSessionId(id);
      }
      const started = await api.pay(id, method, crypto.randomUUID());
      if (started.method === 'card') {
        window.location.assign(started.checkoutUrl);
        return;
      }
      setClearUrl(started.url);
      if (tab) {
        tab.opener = null;
        tab.location.href = started.url;
        setWaitingOn('clear');
      } else {
        window.location.assign(started.url);
      }
    } catch (e) {
      tab?.close();
      if (e instanceof PayApiError && (e.code === 'expired' || e.code === 'inactive')) {
        // The link itself ended while the page was open: show it as it is now.
        api.link(slug).then(setLink, () => undefined);
      }
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (missing) return <NoLink />;
  if (!link) {
    return (
      <ShopFrame shop={null}>
        <div className="sa-m" role="status" aria-live="polite">
          <p className="det">{loadError ?? 'Loading…'}</p>
        </div>
      </ShopFrame>
    );
  }
  return <LinkView link={link} step={linkStep(link, session, waitingOn !== null)} waitingOn={waitingOn} clearUrl={clearUrl} busy={busy} error={error} onPay={pay} />;
}
