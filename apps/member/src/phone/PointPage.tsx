import { useEffect, useRef, useState } from 'react';
import { intentKey, PhoneError, phoneApi } from './api';
import { clock, dollars, orderNo, pollMs } from './format';
import { Lines, Row, Total } from './rows';
import type { PublicBill, PublicMenu, PublicPoint, Receipt, WaitlistJoined } from './types';

/**
 * `useclear.org/p/A7K2` (terminal reference, section 11): one page, four states, following the
 * Point. The menu when the table is free, the bill once one is sent, the receipt once paid, and the
 * wait list at the door.
 */
export function PointPage({ code }: { code: string }) {
  const [point, setPoint] = useState<PublicPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const view = point?.view ?? null;

  // Follow the Point: look again on the page's own clock, and at once when the phone comes back to it.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: PublicPoint | null = null;
    const look = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      try {
        last = await phoneApi.point(code);
        if (stopped) return;
        setPoint(last);
        setError(null);
      } catch (e) {
        if (stopped) return;
        // A Point that isn't there is the page's answer; a dropped connection keeps what it showed.
        if (e instanceof PhoneError && e.status === 404) return setError(e.message);
        if (!last) setError(e instanceof Error ? e.message : String(e));
      }
      const wait = pollMs(last?.view ?? null);
      if (wait !== null && !stopped) timer = setTimeout(look, wait);
    };
    const back = () => document.visibilityState === 'visible' && pollMs(last?.view ?? null) !== null && void look();
    void look();
    document.addEventListener('visibilitychange', back);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [code]);

  useEffect(() => {
    if (view !== 'menu' || menu) return;
    phoneApi.menu(code).then(setMenu, () => undefined);
  }, [code, view, menu]);

  if (error && !point) return <Message text={error} />;
  if (!point) return null;
  const where = point.table ?? null;

  switch (point.view) {
    case 'bill':
      return point.bill ? <BillView code={code} point={point} bill={point.bill} /> : null;
    case 'paid':
      return point.paid ? <PaidView table={where} paidAt={point.paid.paidAt} receipt={point.paid.receipt} /> : null;
    case 'waitlist':
      return <WaitlistView code={code} shop={point.shop.name} quoted={point.waitlist?.quotedMinutes ?? null} />;
    default:
      return <MenuView shop={point.shop.name} table={where} menu={point.view === 'menu' ? menu : null} />;
  }
}

function Message({ text }: { text: string }) {
  return (
    <div className="tm-pbody">
      <p className="tm-psub" role="alert">
        {text}
      </p>
    </div>
  );
}

/** Free table: the menu, and the one line that says how paying works here. */
function MenuView({ shop, table, menu }: { shop: string; table: string | null; menu: PublicMenu | null }) {
  return (
    <>
      <div className="tm-pbody tm-grow">
        <p className="tm-shop">{shop}</p>
        <p className="tm-mono">{table ? `${table} · Menu` : 'Menu'}</p>
        {menu?.categories.map((c) => (
          <section key={c.name}>
            <p className="tm-cat">{c.name}</p>
            {c.items.map((i) => (
              <Row key={i.id} label={i.name} cents={i.priceCents} />
            ))}
          </section>
        ))}
      </div>
      <div className="tm-pfoot">Pay here when you’re done</div>
    </>
  );
}

/** A bill sent to the Point: pay it with Clear (now or over time) or by card. */
function BillView({ code, point, bill }: { code: string; point: PublicPoint; bill: PublicBill }) {
  const keys = useRef({ clear: intentKey(), card: intentKey() });
  const [busy, setBusy] = useState<'clear' | 'card' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const head = point.table ?? (bill.orderNumber !== null ? `Order ${orderNo(bill.orderNumber)}` : null);
  const pay = async (method: 'clear' | 'card') => {
    setBusy(method);
    setError(null);
    try {
      const started = await phoneApi.pay(code, method, keys.current[method]);
      window.location.assign(started.method === 'clear' ? started.url : started.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  return (
    <div className="tm-pbody">
      <p className="tm-shop">{point.shop.name}</p>
      <p className="tm-mono">{head ? `${head} · Your bill` : 'Your bill'}</p>
      <Lines {...bill} />
      <Total cents={bill.totalCents} />
      {bill.remainingCents < bill.totalCents && <Row label="Left to pay" cents={bill.remainingCents} mute />}
      {point.pay.clear && (
        <>
          <button type="button" className="tm-pbtn ink" disabled={busy !== null} onClick={() => void pay('clear')}>
            Pay with Clear
          </button>
          <p className="tm-psub">Pay now, or over time</p>
        </>
      )}
      {point.pay.card && (
        <>
          <button type="button" className="tm-pbtn" disabled={busy !== null} onClick={() => void pay('card')}>
            Pay by card
          </button>
          <p className="tm-psub">Apple Pay, Google Pay, Link or a card</p>
        </>
      )}
      {error && (
        <p className="tm-psub tm-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Paid: the receipt, and a way to keep it. */
function PaidView({ table, paidAt, receipt }: { table: string | null; paidAt: string; receipt: Receipt }) {
  const paid = receipt.tenders.reduce((s, t) => s + t.amountCents + t.tipCents, 0) || receipt.totalCents;
  return (
    <div className="tm-pbody">
      <div className="tm-ok">
        <span aria-hidden>✓</span>
      </div>
      <p className="tm-big">Paid.</p>
      <p className="tm-psub tm-c">{[dollars(paid), table, clock(paidAt)].filter(Boolean).join(' · ')}</p>
      <Lines {...receipt} />
      {receipt.code && <EmailReceipt code={receipt.code} />}
    </div>
  );
}

/**
 * "Email me this receipt". The reference draws the button; the address it needs goes in a field
 * that opens above it, and the same button sends.
 */
export function EmailReceipt({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!open) return setOpen(true);
    setBusy(true);
    setError(null);
    try {
      await phoneApi.emailReceipt(code, email.trim());
      setSent(email.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <p className="tm-psub tm-gap">Sent to {sent}</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {open && (
        <>
          <label className="tm-lbl" htmlFor="tm-email">
            Email
          </label>
          <input id="tm-email" className="tm-in" type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </>
      )}
      <button type="submit" className="tm-pbtn" disabled={busy}>
        Email me this receipt
      </button>
      {error && (
        <p className="tm-psub tm-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const SIZES = [1, 2, 3, 4, 5] as const;

/** The door's Point: join the wait list from the phone. */
function WaitlistView({ code, shop, quoted }: { code: string; shop: string; quoted: number | null }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(2);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<WaitlistJoined | null>(null);
  const [texting, setTexting] = useState(false);
  const join = async () => {
    setBusy(true);
    setError(null);
    const number = phone.trim() || null;
    try {
      setJoined(await phoneApi.joinWaitlist(code, { name: name.trim(), size, phone: number, textConsent: number !== null }));
      setTexting(number !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const minutes = joined?.quotedMinutes ?? quoted;
  const head = minutes ? `Wait list · About ${minutes} min` : 'Wait list';
  if (joined) {
    return (
      <div className="tm-pbody">
        <p className="tm-shop">{shop}</p>
        <p className="tm-mono">{head}</p>
        <div className="tm-ok">
          <span aria-hidden>✓</span>
        </div>
        <p className="tm-big">You’re on the list.</p>
        {texting && <p className="tm-psub">We’ll text you when your table is ready.</p>}
      </div>
    );
  }
  return (
    <form
      className="tm-pbody"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <p className="tm-shop">{shop}</p>
      <p className="tm-mono">{head}</p>
      <label className="tm-lbl" htmlFor="tm-name">
        Name
      </label>
      <input id="tm-name" className="tm-in" autoComplete="given-name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      <p className="tm-lbl" id="tm-size">
        How many
      </p>
      <div className="tm-seg" role="radiogroup" aria-labelledby="tm-size">
        {SIZES.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={size === n} className={size === n ? 'on' : undefined} onClick={() => setSize(n)}>
            {n === 5 ? '5+' : n}
          </button>
        ))}
      </div>
      <label className="tm-lbl" htmlFor="tm-phone">
        Text me at
      </label>
      <input id="tm-phone" className="tm-in" type="tel" autoComplete="tel" inputMode="tel" maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button type="submit" className="tm-pbtn ink" disabled={busy || !name.trim()}>
        Join the list
      </button>
      <p className="tm-psub">We’ll text you when your table is ready.</p>
      {/* The consent line texts need (terminal reference, Open). */}
      <p className="tm-psub tm-fine">By leaving a number you agree {shop} may text it about your table. Message and data rates may apply. Reply STOP to stop.</p>
      {error && (
        <p className="tm-psub tm-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
