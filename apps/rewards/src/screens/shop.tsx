import { claimCodeLabel, type PublicShopApp } from '@clear/merchant-contracts';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData, useRead } from '../data/context';
import { Chevron, Done } from '../icons';
import { CLEAR_APP_URL } from '../lib/env';
import { CLEAR_LOOK } from '../lib/brand';
import { clock, minus, plain, usd } from '../lib/format';
import { useScope } from '../shell/scope';
import { HubTop, Screen, ShopBar, ShopTop, SwitcherTop, TitleTop, shopLook } from '../shell/ui';
import { Scanner } from '../shell/Scanner';
import { SetUpClearSheet } from '../sheets/SetUpClear';
import { SwitchShopSheet } from '../sheets/SwitchShop';
import { Busy, ClearBlock, OffersBlock, RewardsBlock, Row, Sec, shortName, useInitials, word } from './parts';

/** The top bar for a shop's own screens: its name, or the switcher inside the hub. */
function Top({ shop }: { shop: PublicShopApp }) {
  const { mode } = useScope();
  const initials = useInitials();
  const [params, setParams] = useSearchParams();
  const open = params.get('sheet') === 'switch';
  const set = (on: boolean) => {
    const p = new URLSearchParams(params);
    if (on) p.set('sheet', 'switch');
    else p.delete('sheet');
    setParams(p, { replace: !on });
  };
  if (mode === 'shop') return <ShopTop shop={shop} initials={initials} />;
  return (
    <>
      <SwitcherTop shop={shop} initials={initials} onSwitch={() => set(true)} />
      {open ? <SwitchShopSheet current={shop.slug} onClose={() => set(false)} /> : null}
    </>
  );
}

function useSheet(name: string): [boolean, (on: boolean) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get('sheet') === name,
    (on) => {
      const p = new URLSearchParams(params);
      if (on) p.set('sheet', name);
      else p.delete('sheet');
      setParams(p);
    },
  ];
}

// ---- Home (sections 2, 5, 7 and 8) --------------------------------------------------------------

/** Three blocks, always in this order: the shop's rewards, the Clear balance, the shop's offers. */
export function ShopHome({ shop }: { shop: PublicShopApp }) {
  const { base } = useScope();
  const navigate = useNavigate();
  const me = useRead((d) => d.me(shop.slug), [shop.slug]);
  const balance = useRead((d) => d.balanceCents(), []);
  const [setup, setSetup] = useSheet('setup');
  return (
    <Screen look={shopLook(shop)}>
      <Top shop={shop} />
      {me.data ? (
        <div className="sa-body">
          <RewardsBlock shop={shop} me={me.data} onSeeAll={() => navigate(`${base}/rewards`)} />
          <ClearBlock me={me.data} balance={balance.data} onScan={() => navigate(`${base}/pay`)} onSetUp={() => setSetup(true)} />
          <OffersBlock offers={me.data.offers} />
        </div>
      ) : (
        <Busy />
      )}
      <ShopBar />
      {setup && me.data ? <SetUpClearSheet shop={shop} points={me.data.points} onClose={() => setSetup(false)} /> : null}
    </Screen>
  );
}

// ---- Rewards (section 4) ------------------------------------------------------------------------

/** The shop's list, sorted by what they can have now: ready first, then by points to go. Offers under it. */
export function RewardsTab({ shop }: { shop: PublicShopApp }) {
  const { base } = useScope();
  const navigate = useNavigate();
  const me = useRead((d) => d.me(shop.slug), [shop.slug]);
  const m = me.data;
  return (
    <Screen look={shopLook(shop)}>
      <Top shop={shop} />
      {m ? (
        <div className="sa-body">
          <div className="sa-sec sa-brandsec">
            <div className="sa-m">
              <p className="sa-pts">
                <b>{m.points}</b>
                <span>
                  {word(shop.pointsName, m.points)} at {shortName(shop.name)}
                </span>
              </p>
              <p className="det" style={{ marginTop: 4 }}>
                {shop.earn.sentence}
              </p>
            </div>
          </div>
          {m.ready.length ? (
            <Sec label="Ready" det={m.ready.length}>
              <div className="sa-rows">
                {m.ready.map((r) => (
                  <Row
                    key={r.id}
                    t={r.name}
                    det={r.detail}
                    v={
                      <button className="sa-btn sm b" onClick={() => navigate(`${base}/rewards/${encodeURIComponent(r.id)}`)}>
                        Use
                      </button>
                    }
                  />
                ))}
              </div>
            </Sec>
          ) : null}
          {m.next.length ? (
            <Sec label="Next" det={m.next.length}>
              <div className="sa-rows">
                {m.next.map((r) => (
                  <Row key={r.id} t={r.name} det={r.detail} v={<span className="det">{r.toGo} to go</span>} />
                ))}
              </div>
            </Sec>
          ) : null}
          <OffersBlock offers={m.offers} />
        </div>
      ) : (
        <Busy />
      )}
      <ShopBar />
    </Screen>
  );
}

/** A reward claimed for the counter: a short code and a QR, good for 15 minutes. */
export function ClaimScreen({ shop }: { shop: PublicShopApp }) {
  const { id = '' } = useParams();
  const { base } = useScope();
  const navigate = useNavigate();
  const initials = useInitials();
  const claim = useRead((d) => d.claim(shop.slug, id), [shop.slug, id]);
  const c = claim.data;
  return (
    <Screen look={shopLook(shop)}>
      <TitleTop title={c?.rewardName ?? 'Reward'} back={`${base}/rewards`} initials={initials} />
      <div className="sa-body">
        {c ? (
          <>
            <div className="sa-m sa-center">
              <p className="sa-mono">SHOW THIS AT THE COUNTER</p>
              <p className="sa-big2">{c.rewardName}</p>
              <div className="sa-qr">
                <QRCodeSVG value={c.qr} size={150} level="M" bgColor="#ffffff" fgColor="#16211D" />
              </div>
              <p className="sa-code">{claimCodeLabel(c.code)}</p>
              <p className="det">
                Good for 15 minutes · {c.cost} {word(shop.pointsName, c.cost)} come off when it’s used
              </p>
            </div>
            <div className="sa-m">
              <button className="sa-btn wide" onClick={() => navigate(base)}>
                Done
              </button>
            </div>
          </>
        ) : claim.error ? (
          <div className="sa-m">
            <p className="det">{claim.error}</p>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}

// ---- Pay (section 3) ----------------------------------------------------------------------------

/** Pay opens the camera; Show my code is the fallback. A Point's code opens its bill. */
export function PayScreen({ shop }: { shop: PublicShopApp }) {
  const { base } = useScope();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const onCode = (raw: string) => {
    const point = /(?:^|\/)p\/([0-9A-HJKMNP-TV-Z]{4})\b/i.exec(raw)?.[1];
    const charge = /\/c\/([0-9A-Z]{6,12})\b/i.exec(raw)?.[1];
    if (point) navigate(`${base}/bill/${point.toUpperCase()}`);
    else if (charge) navigate(`${base}/c/${charge.toUpperCase()}`);
    else setError('That isn’t a Clear code');
  };
  return (
    <Screen look={shopLook(shop)}>
      <Top shop={shop} />
      <div className="sa-body">
        <Scanner prompt="Point at the code on the counter or your table" onCode={onCode} />
        <div className="sa-m sa-center">
          {error ? <p className="r-err">{error}</p> : null}
          <p className="det">Or let them scan you</p>
          <button className="sa-btn " onClick={() => navigate(`${base}/code`)}>
            Show my code
          </button>
        </div>
      </div>
      <ShopBar />
    </Screen>
  );
}

/** Their own code, for the counter to scan: who they are, and no amount. Fresh every two minutes. */
export function ShowCode({ shop }: { shop: PublicShopApp }) {
  const { base } = useScope();
  const initials = useInitials();
  const person = useRead((d) => d.person(), []);
  const [tick, setTick] = useState(0);
  const code = useRead((d) => d.identityCode(), [tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 100_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Screen look={shopLook(shop)}>
      <TitleTop title="Your code" back={`${base}/pay`} initials={initials} />
      <div className="sa-body">
        <div className="sa-m sa-center">
          <p className="sa-mono">LET THEM SCAN YOU</p>
          <p className="sa-big2">{person.data ? `${person.data.firstName}${person.data.lastInitial ? ` ${person.data.lastInitial}.` : ''}` : ''}</p>
          <div className="sa-qr">{code.data ? <QRCodeSVG value={code.data.payload} size={170} level="M" bgColor="#ffffff" fgColor="#16211D" /> : <div style={{ width: 170, height: 170 }} />}</div>
          <p className="det">It only says who you are: no amount, so it can never move money by itself.</p>
        </div>
      </div>
      <ShopBar />
    </Screen>
  );
}

/** A Point's bill: the Clear app's pay sheet, with the shop's header and a reward line. */
export function BillScreen({ shop }: { shop: PublicShopApp }) {
  const { point = '' } = useParams();
  const { base } = useScope();
  const navigate = useNavigate();
  const data = useData();
  const initials = useInitials();
  const bill = useRead((d) => d.bill(shop.slug, point), [shop.slug, point]);
  const me = useRead((d) => d.me(shop.slug), [shop.slug]);
  const [useReward, setUseReward] = useState(true);
  const [mode, setMode] = useState<'now' | 'over_time'>('now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = bill.data;
  const canClear = Boolean(me.data?.clear.canPayWithClear);
  const on = Boolean(b?.withReward && useReward);
  const figures = b ? (on ? b.withReward! : b.withoutReward) : null;

  async function pay() {
    if (!b || !figures) return;
    setBusy(true);
    setError(null);
    try {
      const started = await data.pay(shop.slug, b.pointCode, { method: canClear ? 'clear' : 'card', rewardId: on ? b.reward!.rewardId : null, idempotencyKey: `rw-${b.orderId}-${on ? 'r' : 'n'}` });
      if (started.method === 'card') {
        window.location.assign(started.checkoutUrl);
        return;
      }
      const done = await data.approve(started.chargeCode, mode);
      navigate(`${base}/paid/${encodeURIComponent(done.orderId ?? b.orderId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through. Nothing was paid.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen look={shopLook(shop)}>
      <TitleTop title={b?.table ?? 'Your bill'} back={`${base}/pay`} initials={initials} />
      <div className="sa-body">
        {b && figures ? (
          <>
            <div className="sa-m">
              <p className="sa-mono">
                PAY {shop.name.toUpperCase()}
                {b.table ? ` · ${b.table.toUpperCase()}` : ''}
              </p>
              <p className="sa-amt big">{usd(figures.totalCents)}</p>
            </div>
            <div className="sa-m sa-lines">
              {b.lines.map((l) => (
                <Row key={l.id} t={`${l.quantity} × ${l.name}`} v={plain(l.lineCents)} />
              ))}
              {b.reward ? (
                <Row
                  className="sa-rw"
                  t={b.reward.name}
                  det={`${b.reward.cost} of your ${b.reward.pointsBefore} ${word(shop.pointsName, b.reward.pointsBefore)}`}
                  v={
                    <>
                      {on ? minus(b.reward.amountCents) : ''}{' '}
                      <button className={`tg sa-tg${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={`Use ${b.reward.name}`} onClick={() => setUseReward(!on)} />
                    </>
                  }
                />
              ) : null}
              <Row className="mute" t="Tax" v={plain(figures.taxCents)} />
            </div>
            <div className="sa-m">
              {canClear ? (
                <div className="tm-seg">
                  <b className={mode === 'now' ? 'on' : ''} onClick={() => setMode('now')} role="button">
                    Pay now
                  </b>
                  <b className={mode === 'over_time' ? 'on' : ''} onClick={() => setMode('over_time')} role="button">
                    Over time
                  </b>
                </div>
              ) : null}
              <button className="sa-btn k wide" disabled={busy} onClick={pay}>
                Pay {usd(figures.totalCents)}
                {canClear ? '' : ' by card'}
              </button>
              <p className="sa-sub">
                {canClear ? (mode === 'now' ? 'From your Clear balance' : 'Over time, in 4 payments') : 'On the shop’s card checkout'} · earns {figures.earnsPoints}{' '}
                {word(shop.pointsName, figures.earnsPoints)}
              </p>
              {error ? <p className="r-err">{error}</p> : null}
            </div>
          </>
        ) : bill.error ? (
          <div className="sa-m">
            <p className="det">{bill.error}</p>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}

/** Done says what moved: money, and points both ways. */
export function PaidScreen({ shop }: { shop: PublicShopApp }) {
  const { order = '' } = useParams();
  const { base, mode } = useScope();
  const navigate = useNavigate();
  const data = useData();
  const initials = useInitials();
  const paid = useRead((d) => d.paid(shop.slug, order), [shop.slug, order]);
  const balance = useRead((d) => d.balanceCents(), [paid.data]);
  const [joining, setJoining] = useState(false);
  const p = paid.data;
  return (
    // A shop they haven't joined: Clear's look, since the shop's starts after joining.
    <Screen look={p?.joinOffer ? CLEAR_LOOK : shopLook(shop)}>
      {p?.joinOffer ? <HubTop initials={initials} /> : <TitleTop title="Paid" initials={initials} />}
      <div className="sa-body">
        {p ? (
          <>
            <div className="sa-m sa-center">
              <span className="sa-ok">
                <Done />
              </span>
              <p className="sa-amt big">{usd(p.amountCents)}</p>
              <p className="det">
                Paid to {shop.name}
                {p.table ? ` · ${p.table}` : ''} · {clock(p.paidAt)}
              </p>
            </div>
            {p.points ? (
              <Sec className="sa-brandsec" label="Points">
                <div className="sa-rows">
                  {p.points.used ? <Row t="Used" det={p.points.used.reward} v={`−${p.points.used.points}`} /> : null}
                  <Row t="Earned" det={`${shop.earn.rate.replace(/ points? per /, ' per ')} paid, before tax`} v={`+${p.points.earned}`} />
                  <Row t="You have" v={<b>{p.points.have}</b>} />
                </div>
              </Sec>
            ) : null}
            {p.joinOffer ? (
              <div className="sa-sec sa-joinoffer">
                <div className="sa-m">
                  <p className="t" style={{ margin: 0, fontWeight: 600 }}>
                    Join {shop.name} Rewards?
                  </p>
                  <p className="det" style={{ marginTop: 4 }}>
                    You’d have {p.joinOffer.total} {word(shop.pointsName, p.joinOffer.total)} now: {p.joinOffer.joinBonus} for joining and {p.joinOffer.fromThis} from this.
                  </p>
                </div>
                <div className="sa-f">
                  <button
                    className="sa-btn k"
                    disabled={joining}
                    onClick={async () => {
                      setJoining(true);
                      await data.join(shop.slug, { texts: 'codes', orderId: p.orderId });
                      navigate(base);
                    }}
                  >
                    Join
                  </button>
                  <button className="det" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => navigate(mode === 'hub' ? '/' : base)}>
                    Not now
                  </button>
                </div>
              </div>
            ) : (
              <Sec label="Receipt" det="Also in Clear">
                <div className="sa-rows">
                  <Row t="Paid from" v={p.paidWith === 'card' ? 'Card' : p.paidWith === 'over_time' ? 'Clear, over time' : 'Clear balance'} />
                  {p.paidWith === 'clear_balance' && balance.data !== null ? <Row t="Balance now" v={usd(balance.data)} /> : null}
                </div>
              </Sec>
            )}
          </>
        ) : null}
      </div>
    </Screen>
  );
}

/**
 * The approve sheet a Clear charge opens in whichever app they have (section 9): the shop asking, its
 * lines, the reward already on it, and what it earns.
 */
export function ApproveScreen({ shop }: { shop: PublicShopApp }) {
  const { code = '' } = useParams();
  const { base } = useScope();
  const navigate = useNavigate();
  const data = useData();
  const initials = useInitials();
  const charge = useRead((d) => d.charge(code), [code]);
  const [mode, setMode] = useState<'now' | 'over_time'>('now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = charge.data;
  // A shop that offers Pay now only (Pay with Clear's links and websites): no Over time to pick.
  const overTime = c?.overTime !== false;
  const paying = overTime ? mode : 'now';
  return (
    <Screen look={shopLook(shop)}>
      <TitleTop title={c?.table ?? shop.name} back={base} initials={initials} />
      <div className="sa-body">
        {c ? (
          <>
            <div className="sa-m">
              <p className="sa-mono">
                {c.shopName.toUpperCase()} IS ASKING
                {c.online ? ` · ${c.online.channel === 'online' ? 'ONLINE' : 'LINK'}` : c.table ? ` · ${c.table.toUpperCase()}` : ''}
              </p>
              <p className="sa-amt big">{usd(c.amountCents)}</p>
            </div>
            <div className="sa-m sa-lines">
              {c.lines.map((l, i) => (
                <Row key={i} t={`${l.quantity} × ${l.name}`} v={plain(l.lineCents)} />
              ))}
              {c.reward ? <Row className="sa-rw" t={c.reward.name} det={`${c.reward.appliedBy === 'counter' ? 'Applied at the counter' : 'Your reward'} · ${c.reward.points} ${word(shop.pointsName, c.reward.points)}`} v={minus(c.reward.amountCents)} /> : null}
              <Row className="mute" t="Tax" v={plain(c.taxCents)} />
            </div>
            <div className="sa-m">
              {overTime ? (
                <div className="tm-seg">
                  <b className={mode === 'now' ? 'on' : ''} onClick={() => setMode('now')} role="button">
                    Pay now
                  </b>
                  <b className={mode === 'over_time' ? 'on' : ''} onClick={() => setMode('over_time')} role="button">
                    Over time
                  </b>
                </div>
              ) : null}
              <button
                className="sa-btn k wide"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const done = await data.approve(c.code, paying);
                    navigate(done.orderId ? `${base}/paid/${encodeURIComponent(done.orderId)}` : base);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'That didn’t go through. Nothing was paid.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Approve {usd(c.amountCents)}
              </button>
              <p className="sa-sub">
                {paying === 'now' ? 'From your Clear balance' : 'Over time, in 4 payments'}
                {c.earnsPoints !== null ? ` · earns ${c.earnsPoints} ${word(shop.pointsName, c.earnsPoints)}` : ''}
              </p>
              {c.online?.shopHost ? <p className="sa-sub">Then you’re back on {c.online.shopHost}</p> : null}
              {error ? <p className="r-err">{error}</p> : null}
            </div>
          </>
        ) : charge.error ? (
          <div className="sa-m">
            <p className="det">{charge.error}</p>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}

// ---- You (section 6) ----------------------------------------------------------------------------

/** The account and the way out: who, their Clear account, texts here, and leaving this shop. */
export function ShopYou({ shop }: { shop: PublicShopApp }) {
  const { base, mode } = useScope();
  const navigate = useNavigate();
  const data = useData();
  const me = useRead((d) => d.me(shop.slug), [shop.slug]);
  const person = useRead((d) => d.person(), []);
  const [texts, setTexts] = useState<boolean | null>(null);
  const [setup, setSetup] = useSheet('setup');
  const m = me.data;
  const short = shortName(shop.name);
  const on = texts ?? m?.membership?.texts === 'codes_and_offers';
  return (
    <Screen look={shopLook(shop)}>
      <Top shop={shop} />
      {m && person.data ? (
        <div className="sa-body">
          <Sec label="Signed in">
            <div className="sa-rows">
              <Row t={`${person.data.firstName}${person.data.lastInitial ? ` ${person.data.lastInitial}.` : ''}`} det={person.data.phone ?? undefined} v={null} />
              {m.clear.canPayWithClear ? (
                <Row t="Clear account" det="Same sign-in as the Clear app" v={<span className="sa-okc">Active</span>} />
              ) : (
                <Row t="Clear account" det="Pay from a balance, or split a bigger bill" v={<button className="sa-btn sm k" onClick={() => setSetup(true)}>Set up Clear</button>} />
              )}
            </div>
          </Sec>
          <Sec label="This shop">
            <div className="sa-rows">
              <Row
                t={`Texts from ${short}`}
                det={on ? 'Codes and offers, at most one a week' : 'Codes only'}
                v={
                  <button
                    className={`tg${on ? ' on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Offers by text from ${short}`}
                    onClick={async () => {
                      setTexts(!on);
                      await data.updateMembership(shop.slug, { texts: on ? 'codes' : 'codes_and_offers' }).catch(() => setTexts(on));
                    }}
                  />
                }
              />
              <Row t="Activity here" det={`Purchases at ${short} only`} v={<Chevron />} onClick={() => navigate(`${base}/activity`)} />
            </div>
          </Sec>
          <Sec>
            <div className="sa-rows">
              <Row t="Open Clear" det="Everything else: all shops, savings, credit" v={<Chevron />} onClick={() => window.location.assign(CLEAR_APP_URL)} />
              <Row
                t={<span style={{ color: 'var(--absent)' }}>Leave {short} Rewards</span>}
                det={`Your ${m.points} ${word(shop.pointsName, m.points)} here are deleted. Clear isn’t affected`}
                v={null}
                onClick={async () => {
                  if (!window.confirm(`Leave ${short} Rewards? Your ${m.points} ${word(shop.pointsName, m.points)} here are deleted.`)) return;
                  await data.leave(shop.slug);
                  navigate(mode === 'hub' ? '/' : base);
                }}
              />
            </div>
          </Sec>
        </div>
      ) : (
        <Busy />
      )}
      <ShopBar />
      {setup && m ? <SetUpClearSheet shop={shop} points={m.points} onClose={() => setSetup(false)} /> : null}
    </Screen>
  );
}

/** Purchases at this shop only: everything else is in Clear. */
export function ActivityScreen({ shop }: { shop: PublicShopApp }) {
  const { base } = useScope();
  const initials = useInitials();
  const activity = useRead((d) => d.activity(shop.slug), [shop.slug]);
  const items = activity.data?.items ?? [];
  return (
    <Screen look={shopLook(shop)}>
      <TitleTop title="Activity here" back={`${base}/you`} initials={initials} />
      <div className="sa-body">
        <Sec label={`At ${shortName(shop.name)}`} det={items.length || undefined}>
          {items.length ? (
            <div className="sa-rows">
              {items.map((i) => (
                <Row
                  key={i.orderId}
                  t={`${usd(i.totalCents)}${i.table ? ` · ${i.table}` : ''}`}
                  det={`${new Date(i.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${i.paidWith === 'clear' ? 'Clear' : i.paidWith === 'card' ? 'Card' : i.paidWith === 'cash' ? 'Cash' : 'Split'}`}
                  v={`${i.points.earned ? `+${i.points.earned}` : ''}${i.points.used ? ` −${i.points.used}` : ''}`}
                />
              ))}
            </div>
          ) : (
            <p className="det">Nothing here yet.</p>
          )}
        </Sec>
      </div>
      <ShopBar />
    </Screen>
  );
}
