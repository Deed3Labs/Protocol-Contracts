import type { PublicShopApp } from '@clear/merchant-contracts';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth';
import { useData, useRead } from '../data/context';
import { Chevron } from '../icons';
import { CLEAR_LOOK, tileStyle } from '../lib/brand';
import { CLEAR_APP_URL } from '../lib/env';
import { miles, usd } from '../lib/format';
import { HubNav, HubTop, Screen } from '../shell/ui';
import { Scanner } from '../shell/Scanner';
import { JoinSheet } from '../sheets/Join';
import { Busy, ClearBlock, Row, Sec, useInitials, word } from './parts';

/** "128 points", "340 points · 160 to a free rotation", "6 of 10 stamps". */
function shopLine(s: { unit: 'dollars' | 'visits'; points: number; cardSize: number | null; pointsName: PublicShopApp['pointsName']; next: { name: string; toGo: number } | null; readyCount: number }) {
  if (s.unit === 'visits' && s.cardSize) return `${s.points} of ${s.cardSize} ${word(s.pointsName, 2)}`;
  const base = `${s.points} ${word(s.pointsName, s.points)}`;
  return s.readyCount === 0 && s.next ? `${base} · ${s.next.toGo} to a ${s.next.name.replace(/^Free /i, 'free ')}` : base;
}

/**
 * The hub's home (section 7): the balance on top, then the shops. The list is what grows, so it sits
 * below the balance; adding a shop is Scan in the bar.
 */
export function HubHome() {
  const navigate = useNavigate();
  const initials = useInitials();
  const shops = useRead((d) => d.myShops(), []);
  const balance = useRead((d) => d.balanceCents(), []);
  const list = shops.data?.shops ?? [];
  const isClear = balance.data !== null;
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop initials={initials} />
      {shops.data ? (
        <div className="sa-body">
          {isClear ? <ClearBlock hub me={{ clear: { status: 'active', canPayWithClear: true, canPayOverTime: true } }} balance={balance.data} onScan={() => navigate('/scan')} onSetUp={() => undefined} /> : null}
          <Sec className="sa-shopsec" label="Your shops" det={list.length}>
            <div className="sa-lines">
              {list.length ? (
                list.map((s) => (
                  <div key={s.slug} className="sa-shop tap" role="button" onClick={() => navigate(`/shops/${s.slug}`)}>
                    <span className="sa-logo" style={tileStyle(s.brand)}>
                      {s.brand.monogram}
                    </span>
                    <div>
                      <p className="t">{s.name}</p>
                      <p className="det">{shopLine(s)}</p>
                    </div>
                    <span className="sa-end">
                      {s.readyCount > 0 ? <span className="sa-ready">Ready</span> : null}
                      <Chevron />
                    </span>
                  </div>
                ))
              ) : (
                <p className="det">No shops yet. Scan a shop’s code at its counter or table to join.</p>
              )}
            </div>
          </Sec>
        </div>
      ) : (
        <Busy />
      )}
      <HubNav />
    </Screen>
  );
}

/**
 * Scan (section 7): the hub's scanner knows every Clear code. A shop's join code adds the shop, a
 * payment code opens the bill. Under it, the Clear Partners directory, nearest first.
 */
export function HubScan() {
  const navigate = useNavigate();
  const initials = useInitials();
  const data = useData();
  const [params, setParams] = useSearchParams();
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const partners = useRead((d) => d.partners(near), [near?.lat, near?.lng]);
  const joining = params.get('join');
  const shop = useRead((d) => (joining ? d.shop(joining) : Promise.resolve(null)), [joining]);
  const setJoin = (slug: string | null) => {
    const p = new URLSearchParams(params);
    if (slug) p.set('join', slug);
    else p.delete('join');
    setParams(p);
  };

  useEffect(() => {
    // Asked, used once, never stored.
    navigator.geolocation?.getCurrentPosition(
      (pos) => setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined,
      { maximumAge: 600_000, timeout: 8_000 },
    );
  }, []);

  const onCode = async (raw: string) => {
    const join = /\/(?:s|join)\/([a-z0-9-]{2,32})\b/i.exec(raw)?.[1];
    const point = /(?:^|\/)p\/([0-9A-HJKMNP-TV-Z]{4})\b/i.exec(raw)?.[1];
    if (join) return setJoin(join.toLowerCase());
    if (point) {
      // A Point is a shop's: find whose, then open its bill inside that shop.
      const slug = await data.pointShop(point.toUpperCase()).catch(() => null);
      if (slug) return navigate(`/shops/${slug}/bill/${point.toUpperCase()}`);
      return setError('That shop doesn’t have rewards yet. Pay from the page the code opens.');
    }
    setError('That isn’t a Clear code');
  };

  const list = (partners.data?.partners ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop initials={initials} />
      <div className="sa-body">
        <Scanner prompt="Scan the code on a shop’s counter or table" onCode={(raw) => void onCode(raw)} height={250} box={130} />
        {error ? <p className="r-err" style={{ padding: '0 16px' }}>{error}</p> : null}
        <Sec label="Or find a shop" det={list.some((p) => p.distanceMeters !== null) ? 'Near you' : 'Clear shops'}>
          <input className="sa-in mute" style={{ margin: '0 0 6px' }} placeholder="Search Clear shops" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Clear shops" />
          <div className="sa-lines">
            {list.map((p) => (
              <div key={p.slug} className="sa-shop">
                <span className="sa-logo" style={tileStyle(p.brand)}>
                  {p.brand.monogram}
                </span>
                <div>
                  <p className="t">{p.name}</p>
                  <p className="det">{[p.distanceMeters !== null ? miles(p.distanceMeters) : null, p.earns].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="sa-end">
                  {p.joined ? (
                    <button className="sa-btn sm" onClick={() => navigate(`/shops/${p.slug}`)}>
                      Open
                    </button>
                  ) : (
                    <button className="sa-btn sm" onClick={() => setJoin(p.slug)}>
                      Join
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Sec>
      </div>
      <HubNav />
      {joining && shop.data ? <JoinSheet shop={shop.data} onClose={() => setJoin(null)} onJoined={() => navigate(`/shops/${joining}`)} /> : null}
    </Screen>
  );
}

/** You (section 7): one place for every shop's texts, leaving a shop, and the account. */
export function HubYou() {
  const navigate = useNavigate();
  const auth = useAuth();
  const data = useData();
  const initials = useInitials();
  const person = useRead((d) => d.person(), []);
  const shops = useRead((d) => d.myShops(), []);
  const balance = useRead((d) => d.balanceCents(), []);
  const [texts, setTexts] = useState<Record<string, boolean>>({});
  const p = person.data;
  return (
    <Screen look={CLEAR_LOOK}>
      <HubTop initials={initials} />
      {p && shops.data ? (
        <div className="sa-body">
          <Sec label="You">
            <div className="sa-rows">
              <Row t={`${p.firstName}${p.lastInitial ? ` ${p.lastInitial}.` : ''}`} det={p.phone ?? undefined} v={<Chevron />} />
              {balance.data !== null ? (
                <Row t="Clear account" det={`Balance ${usd(balance.data)} · open in Clear`} v={<span className="sa-okc">Active</span>} onClick={() => window.location.assign(CLEAR_APP_URL)} />
              ) : (
                <Row t="Clear account" det="Not set up · works at every Clear shop" v={<Chevron />} onClick={() => window.location.assign(CLEAR_APP_URL)} />
              )}
            </div>
          </Sec>
          {shops.data.shops.length ? (
            <Sec label="Texts">
              <div className="sa-rows">
                {shops.data.shops.map((s) => {
                  const on = texts[s.slug] ?? s.texts === 'codes_and_offers';
                  return (
                    <Row
                      key={s.slug}
                      t={s.name}
                      det={on ? 'Codes and offers' : 'Codes only'}
                      v={
                        <button
                          className={`tg${on ? ' on' : ''}`}
                          role="switch"
                          aria-checked={on}
                          aria-label={`Offers by text from ${s.name}`}
                          onClick={async () => {
                            setTexts((t) => ({ ...t, [s.slug]: !on }));
                            await data.updateMembership(s.slug, { texts: on ? 'codes' : 'codes_and_offers' }).catch(() => setTexts((t) => ({ ...t, [s.slug]: on })));
                          }}
                        />
                      }
                    />
                  );
                })}
              </div>
            </Sec>
          ) : null}
          <Sec>
            <div className="sa-rows">
              <Row t="Leave a shop" det="Deletes its points; the others stay" v={<Chevron />} onClick={() => shops.data!.shops[0] && navigate(`/shops/${shops.data!.shops[0].slug}/you`)} />
              <Row t="Sign out" v={null} onClick={() => void auth.signOut().then(() => navigate('/'))} />
              <Row
                t={<span style={{ color: 'var(--absent)' }}>Delete my rewards account</span>}
                det="Every shop’s points. A Clear account is closed in Clear"
                v={null}
                onClick={async () => {
                  if (!window.confirm('Delete your rewards account? Every shop’s points go. A Clear account is closed in Clear.')) return;
                  await data.deletePerson();
                  await auth.signOut();
                  navigate('/');
                }}
              />
            </div>
          </Sec>
        </div>
      ) : (
        <Busy />
      )}
      <HubNav />
    </Screen>
  );
}
