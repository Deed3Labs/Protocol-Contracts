import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fromWire, seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { Segmented } from '@/brand/controls';
import { OneColumn, cx } from '@/brand/ui';
import { ApiError, api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { useLayout } from '@/lib/useBreakpoint';
import { FlowTop } from '@/shell/chrome';
import {
  CATALOG,
  FALL10,
  FOOD,
  FOOD_ORDER,
  REFERENCE_CART,
  TILE_ORDER,
  lineOf,
  missingGroup,
  totals,
  unitPrice,
  usd,
  type CartLine,
  type Discount,
  type Item,
} from '@/charge/model';
import {
  BigLines,
  CartCell,
  ItemsCell,
  OptionsSheet,
  QuickSaleSheet,
  StartTop,
  AmountView,
  typeAmount,
  type FeeTerms,
  type StartMode,
} from '@/charge/start';
import { CheckoutView, DiscountSheet, TipView, chargeTotal, type CodeCheck, type Method, type TipChoice } from '@/charge/checkout';
import {
  ApprovedView,
  CodeCell,
  CustomerCell,
  ScanTheirsView,
  SendToNumberView,
  ShowCodeView,
  WaitingView,
  exampleSplit,
  type ChargeState,
  type ShiftRow,
} from '@/charge/clear';
import { CardChargeCell, PrintReceiptSheet, ReaderCell, ReceiptGroups, SendReceiptSheet, type ReaderState, type SendBy } from '@/charge/card';
import { CashPaidView, CashView, SplitLegsCell, SplitView, type Leg, type LegMethod } from '@/charge/cash';
import { FailureSheet, PhoneAmount, PhoneCart, PhoneCode, PhoneItems, PhoneStatus } from '@/charge/phone';

/**
 * New charge — docs/merchant-reference/clear-merchant-new-charge.html.
 *
 * Start with an amount or items, check out, take the tip, then take it by Clear, card, cash or a
 * split. Every way ends the same: paid, a receipt, and New charge.
 *
 * **What runs live.** A typed amount paid with Clear: raised through the API, shown as a code,
 * watched until the customer approves, declines or it expires. The rest has no backend yet —
 * the catalog, discounts, tips, card (Stripe), cash and splits (card-processing prompt, Phases
 * 3–7) — so a live shop sees Amount only, Card locked as the reference draws it before Stripe is
 * connected, and no cash or split. In development, `?preview=1&screen=<frame>` opens any frame of
 * the reference on its own scenario and the whole flow can be clicked through (see SCREENS).
 */

type Screen =
  | 'start'
  | 'cart'
  | 'checkout'
  | 'tip'
  | 'code'
  | 'theirs'
  | 'phone'
  | 'waiting'
  | 'approved'
  | 'card'
  | 'cash'
  | 'cashPaid'
  | 'split';

type Sheet =
  | { k: 'options'; item: Item; missing?: boolean }
  | { k: 'quick' }
  | { k: 'discount'; mode?: 'code' | 'amount'; code?: string; value?: string; pin?: number }
  | { k: 'send'; by: 'text' | 'email'; to: string }
  | { k: 'print'; printer: 'ready' | 'offline' }
  | { k: 'fail'; kind: 'declined' | 'expired' | 'offline' }
  | null;

interface Flow {
  screen: Screen;
  mode: StartMode;
  view: 'list' | 'tiles';
  typed: string;
  lines: CartLine[];
  discount: Discount | null;
  tip: TipChoice | null;
  /** Which way to pay was picked at Checkout, so the tip knows where to go next. */
  method: Method | null;
  code: string;
  reader: ReaderState;
  given: string;
  legs: Leg[];
  legMethod: LegMethod;
  phone: string;
  sendBy: SendBy;
  sheet: Sheet;
  suggested: boolean;
  catalog: 'shop' | 'food';
  underMin: boolean;
  capNote: boolean;
}

const BLANK: Flow = {
  screen: 'start',
  mode: 'amount',
  view: 'list',
  typed: '',
  lines: [],
  discount: null,
  tip: null,
  method: null,
  code: '',
  reader: 'ready',
  given: '',
  legs: [],
  legMethod: 'card',
  phone: '',
  sendBy: 'text',
  sheet: null,
  suggested: false,
  catalog: 'shop',
  underMin: false,
  capNote: false,
};

/**
 * The classes the reference puts on each frame. Its rules read them from the frame down
 * (`.ck .ci-hero`, `.cc .mc-steps`), so the screen's root carries the same ones.
 */
const FRAME: Partial<Record<Screen | 'items', string>> = {
  items: 'c-ci',
  cart: 'c-ci',
  checkout: 'c-ci c-ck',
  tip: 'c-ci c-ck',
  cash: 'c-ci c-ck',
  split: 'c-ci c-ck',
  card: 'c-ci c-cc',
  cashPaid: 'c-ci c-ck c-cc',
};

const TEN = { kind: 'preset', cents: 1000 } as const;
const cart = { mode: 'items' as const, lines: REFERENCE_CART };
const typed940 = { typed: '940', mode: 'amount' as const };

/** Every frame of the reference, reachable in development as `?preview=1&screen=<name>`. */
export const SCREENS: Record<string, Partial<Flow>> = {
  amount: { ...typed940 },
  items: { ...cart },
  'items-suggest': { mode: 'items', lines: [lineOf('michelin', 4)] },
  'items-empty': { mode: 'items', lines: [] },
  options: { ...cart, sheet: { k: 'options', item: CATALOG[0] } },
  quicksale: { ...cart, sheet: { k: 'quick' } },
  'phone-cart': { ...cart, screen: 'cart' },
  notenough: { mode: 'items', screen: 'cart', lines: [lineOf('goodyear', 4), lineOf('mount', 4)], capNote: true },
  tiles: { ...cart, view: 'tiles' },
  food: { mode: 'items', view: 'tiles', catalog: 'food', lines: FOOD_ORDER },
  'food-options': { mode: 'items', view: 'tiles', catalog: 'food', lines: FOOD_ORDER, sheet: { k: 'options', item: FOOD[1], missing: true } },
  checkout: { ...cart, screen: 'checkout' },
  'checkout-amount': { ...typed940, screen: 'checkout' },
  'checkout-discount': { ...cart, screen: 'checkout', discount: FALL10 },
  'discount-code': { ...cart, screen: 'checkout', sheet: { k: 'discount', code: 'FALL10' } },
  'discount-expired': { ...cart, screen: 'checkout', sheet: { k: 'discount', code: 'SUMMER25' } },
  'discount-amount': { ...cart, screen: 'checkout', sheet: { k: 'discount', mode: 'amount', value: '15', pin: 2 } },
  tip: { ...cart, screen: 'tip', tip: TEN, method: 'card' },
  code: { ...typed940, screen: 'code', method: 'clear', code: '8QK2' },
  'code-cart': { ...cart, screen: 'code', method: 'clear', code: '8QK2' },
  theirs: { ...typed940, screen: 'theirs', method: 'clear', code: '8QK2' },
  'theirs-cart': { ...cart, screen: 'theirs', method: 'clear', code: '8QK2' },
  phone: { ...typed940, screen: 'phone', method: 'clear', code: '8QK2', phone: '9095550142' },
  'under-min': { mode: 'items', lines: [lineOf('valves', 1), { key: 'rotation', name: 'Tire rotation', qty: 1, unitCents: 2500, tax: 'labour' }], screen: 'code', method: 'clear', code: '8QK2', underMin: true },
  waiting: { ...typed940, screen: 'waiting', method: 'clear', code: '8QK2' },
  approved: { ...typed940, screen: 'approved', method: 'clear', code: '8QK2' },
  card: { ...cart, screen: 'card', method: 'card', reader: 'ready' },
  'card-reading': { ...cart, screen: 'card', method: 'card', reader: 'reading' },
  'card-declined': { ...cart, screen: 'card', method: 'card', reader: 'declined' },
  'card-approved': { ...cart, screen: 'card', method: 'card', reader: 'approved', tip: TEN },
  'receipt-text': { ...cart, screen: 'card', method: 'card', reader: 'approved', tip: TEN, sheet: { k: 'send', by: 'text', to: '(909) 555-0177' } },
  'receipt-email': { ...cart, screen: 'card', method: 'card', reader: 'approved', tip: TEN, sheet: { k: 'send', by: 'email', to: 'm.alvarez@gmail.com' } },
  print: { ...cart, screen: 'card', method: 'card', reader: 'approved', tip: TEN, sheet: { k: 'print', printer: 'ready' } },
  'print-offline': { ...cart, screen: 'card', method: 'card', reader: 'approved', tip: TEN, sheet: { k: 'print', printer: 'offline' } },
  cash: { ...cart, screen: 'cash', method: 'cash', tip: { kind: 'none' }, given: '940' },
  'cash-paid': { ...cart, screen: 'cashPaid', method: 'cash', tip: { kind: 'none' }, given: '940', sendBy: 'none' },
  split: { ...cart, screen: 'split', method: 'split', tip: { kind: 'none' }, legs: [{ method: 'cash', amountCents: 20000, det: '4:38pm · no change', state: 'paid' }], legMethod: 'card' },
  'split-declined': {
    ...cart,
    screen: 'split',
    method: 'split',
    tip: { kind: 'none' },
    legs: [
      { method: 'cash', amountCents: 20000, det: '4:38pm · no change', state: 'paid' },
      { method: 'card', amountCents: 72752, det: 'Visa ending 4242 · the bank declined it', state: 'declined' },
    ],
  },
  declined: { ...typed940, screen: 'waiting', method: 'clear', code: '8QK2', sheet: { k: 'fail', kind: 'declined' } },
  expired: { ...typed940, screen: 'waiting', method: 'clear', code: '8QK2', sheet: { k: 'fail', kind: 'expired' } },
  offline: { ...typed940, screen: 'code', method: 'clear', code: '8QK2', sheet: { k: 'fail', kind: 'offline' } },
};

/** Codes the preview knows. Codes come from Settings, Discounts once the backend has them. */
const CODES: Record<string, CodeCheck> = {
  FALL10: { code: 'FALL10', ok: true, percent: 10, says: '10% off the whole charge, before tax. Until Oct 31, once per customer.' },
  SUMMER25: { code: 'SUMMER25', ok: false, says: 'This code ended on Sep 1. Nothing has been taken off.' },
};

const DANA: ChargeState = {
  code: '8QK2',
  raisedBy: 'Jen R.',
  customer: 'Dana R.',
  sentTo: 'Sent to (909) 555-0142',
  amountCents: 94000,
  status: 'waiting',
  steps: [
    { t: 'Sent', det: '12:16pm', state: 'd' },
    { t: 'Delivered', det: '12:16pm', state: 'd' },
    { t: 'Opened', det: '12:17pm', state: 'on' },
    { t: 'Approved', det: 'By tomorrow', state: '' },
  ],
};
const DANA_OK: ChargeState = {
  ...DANA,
  status: 'approved',
  howPaid: '4 payments of $235.00, the first on Oct 6',
  steps: [
    { t: 'Sent', det: '12:16pm', state: 'd' },
    { t: 'Delivered', det: '12:16pm', state: 'd' },
    { t: 'Opened', det: '12:17pm', state: 'd' },
    { t: 'Approved', det: '12:19pm', state: 'd' },
  ],
};
const JEN_SHIFT: ShiftRow[] = [
  { name: 'Dana R.', det: 'Just now', amountCents: 94000, approved: true },
  { name: 'Nina P.', det: 'Sent 11:58am · not opened', amountCents: 41000, approved: false },
  { name: 'Marcus T.', det: '11:02am', amountCents: 41200, approved: true },
];

const nowTime = () => {
  const d = new Date();
  return `${d.getHours() % 12 || 12}:${d.getMinutes().toString().padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
};

export default function NewChargePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const layout = useLayout();
  const phone = layout === 'phone';
  const one = layout !== 'two-column';
  const { session } = useAuth();
  const role = session?.staff.role ?? 'counter';
  const me = session?.staff.name ?? '';

  // The reference scenario, in development only: `?preview=1` (and `&screen=` for one frame).
  // `&live=1` keeps the preview's session but shows what a live shop gets.
  const preview = import.meta.env.DEV && params.get('preview') === '1' && !params.get('live');
  const preset = preview ? SCREENS[params.get('screen') ?? ''] : undefined;

  const { data: profile } = useApi(() => api.profile(), []);
  const shop = preview ? 'Mike’s Tire' : (profile?.name ?? '');
  const fees: FeeTerms | null = !seesMoney(role)
    ? null
    : preview
      ? { now: 1.25, over: 2.0 }
      : profile?.discountRate != null
        ? { now: Math.round(profile.discountRate * 10000) / 100 }
        : null;
  const limitCents = preview ? 250000 : (profile?.approvalCapCents ?? null);

  const [f, setF] = useState<Flow>(() => ({
    ...BLANK,
    mode: preview && params.get('items') ? 'items' : BLANK.mode,
    ...preset,
  }));
  const set = useCallback((p: Partial<Flow>) => setF((cur) => ({ ...cur, ...p })), []);
  const [raising, setRaising] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const [live, setLive] = useState<{ openedAt: string | null; resolvedAt: string | null; splitInto: number | null } | null>(null);
  const [raisedAt, setRaisedAt] = useState<Date>(() => new Date());

  const catalog = f.catalog === 'food' ? FOOD : CATALOG;
  const typedCents = Math.round(parseFloat(f.typed || '0') * 100);
  const body = { lines: f.mode === 'items' ? f.lines : [], typedCents, discount: f.discount };
  const baseCents = chargeTotal(body);
  const tipCents = f.tip && f.tip.kind !== 'none' ? f.tip.cents : 0;
  const dueCents = baseCents + tipCents;
  const inCart = useMemo(() => Object.fromEntries(f.lines.filter((l) => l.itemId).map((l) => [l.itemId!, l.qty])), [f.lines]);

  // ---- The live path: raise the charge, then watch it ---------------------------------------
  const raise = async () => {
    if (preview) {
      set({ screen: 'code', code: '8QK2' });
      return;
    }
    setRaising(true);
    setRaiseError(null);
    try {
      const r = await api.raiseCharge({ amountCents: dueCents });
      setRaisedAt(new Date());
      set({ screen: 'code', code: r.code });
    } catch (e) {
      // The server's own words when it answered; a dropped connection gets the plain version.
      setRaiseError(e instanceof ApiError ? e.message : 'That charge could not be raised. Take the ticket the usual way.');
    } finally {
      setRaising(false);
    }
  };

  useEffect(() => {
    if (preview || !f.code || !['code', 'waiting'].includes(f.screen)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const c = await api.watchCharge(f.code);
        if (stopped) return;
        setLive({ openedAt: c.openedAt, resolvedAt: c.resolvedAt, splitInto: c.splitInto });
        const s = fromWire(c.status);
        if (s === 'approved') set({ screen: 'approved' });
        else if (s === 'declined') set({ sheet: { k: 'fail', kind: 'declined' } });
        else if (s === 'expired') set({ sheet: { k: 'fail', kind: 'expired' } });
        else if (c.openedAt && f.screen === 'code') set({ screen: 'waiting' });
      } catch {
        // A poll that fails changes nothing; the charge is safe on the server and the next tick asks again.
      }
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [preview, f.code, f.screen, set]);

  // The card reader, simulated in the preview: ready, then reading, then approved.
  useEffect(() => {
    if (!preview || f.screen !== 'card' || preset?.reader) return;
    if (f.reader === 'ready') {
      const t = window.setTimeout(() => set({ reader: 'reading' }), 2500);
      return () => window.clearTimeout(t);
    }
    if (f.reader === 'reading') {
      const t = window.setTimeout(() => set({ reader: 'approved' }), 2500);
      return () => window.clearTimeout(t);
    }
  }, [preview, preset, f.screen, f.reader, set]);

  // ---- Moving through --------------------------------------------------------------------------
  const exit = () => navigate('/');
  const again = () => setF({ ...BLANK });
  const addLine = (item: Item, picked: Record<string, string[]> = {}, qty = 1) => {
    const chosen = (item.options ?? [])
      .flatMap((g) => (picked[g.id] ?? []).map((id) => g.choices.find((c) => c.id === id)))
      .filter((c) => c && c.id !== 'none')
      .map((c) => c!.name.toLowerCase())
      .join(', ');
    const key = `${item.id}${chosen ? `:${chosen}` : ''}`;
    setF((cur) => {
      const found = cur.lines.find((l) => l.key === key);
      const lines = found
        ? cur.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l))
        : [...cur.lines, { key, itemId: item.id, name: item.name, chosen: chosen || undefined, qty, unitCents: unitPrice(item, picked), tax: item.tax, hasOptions: !!item.options }];
      return { ...cur, lines, sheet: null };
    });
  };
  const setQty = (itemId: string, qty: number) =>
    setF((cur) => ({ ...cur, lines: qty <= 0 ? cur.lines.filter((l) => l.itemId !== itemId) : cur.lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)) }));
  const pick = (m: Method) => {
    // A live shop has no tip to carry yet, so Clear goes straight to raising the charge.
    if (!preview) {
      if (m === 'clear') void raise();
      return;
    }
    set({ method: m, screen: 'tip', tip: null });
  };
  const afterTip = () => {
    if (f.method === 'clear') void raise();
    else if (f.method === 'card') set({ screen: 'card', reader: 'ready' });
    else if (f.method === 'cash') set({ screen: 'cash', given: '' });
    else set({ screen: 'split', legs: [], legMethod: 'card' });
  };

  // Tires usually go with mount and balance: suggested once, the count matched.
  const tires = f.lines.filter((l) => catalog.find((i) => i.id === l.itemId)?.thumb === 'tire').reduce((s, l) => s + l.qty, 0);
  const suggestion =
    f.catalog === 'shop' && tires > 0 && !f.lines.some((l) => l.itemId === 'mount') && !f.suggested
      ? { t: 'Tires usually go with mount and balance', det: `${tires} × ${usd(2500)}, one per tire`, action: `Add ${tires}` }
      : null;

  const who = me ? `${me}, this shift` : undefined;
  const modeSwitch = (
    <Segmented
      as="span"
      kind="mode"
      label="Start with"
      value={f.mode}
      onChange={(mode) => set({ mode })}
      options={[
        { value: 'amount', label: 'Amount' },
        { value: 'items', label: 'Items' },
      ]}
    />
  );

  // ---- Screens ---------------------------------------------------------------------------------
  let top: ReactNode = null;
  let main: ReactNode = null;
  const flowTop = (title: string, back = true) => (
    <FlowTop title={title} back={back} onExit={back ? () => set({ screen: f.screen === 'checkout' ? 'start' : 'checkout' }) : exit} onShift={me} />
  );

  if (f.screen === 'start' || f.screen === 'cart') {
    // A live shop has no catalog yet, so it starts with an amount and the switch is not offered.
    const items = preview && f.mode === 'items';
    if (phone) {
      main =
        items && f.screen === 'cart' ? (
          <PhoneCart
            lines={f.lines}
            catalog={catalog}
            onQty={(l, n) => l.itemId && setQty(l.itemId, n)}
            onRemove={(l) => l.itemId && setQty(l.itemId, 0)}
            onBack={() => set({ screen: 'start' })}
            onCheckout={() => set({ screen: 'checkout' })}
          />
        ) : items ? (
          <PhoneItems
            catalog={catalog}
            view="list"
            inCart={inCart}
            lines={f.lines}
            onAdd={(i) => addLine(i)}
            onQty={(i, n) => setQty(i.id, n)}
            onQuickSale={() => set({ sheet: { k: 'quick' } })}
            onOptions={(i) => set({ sheet: { k: 'options', item: i } })}
            onCart={() => set({ screen: 'cart' })}
            onExit={exit}
            modeSwitch={modeSwitch}
          />
        ) : (
          <PhoneAmount
            cents={typedCents}
            fees={fees}
            recordedAgainst={who}
            onKey={(k) => setF((cur) => ({ ...cur, typed: typeAmount(cur.typed, k) }))}
            onContinue={() => set({ screen: 'checkout' })}
            onExit={exit}
          />
        );
    } else {
      top = preview ? (
        <StartTop mode={f.mode} onMode={(mode) => set({ mode })} onShift={me} onExit={exit} title={f.catalog === 'food' ? 'New order' : 'New charge'} />
      ) : (
        <FlowTop title="New charge" onExit={exit} onShift={me} />
      );
      if (items && f.capNote) {
        main = (
          <div className="c-mc-tablet c-ci c-ci-snip" style={{ height: 'auto', padding: 0 }}>
            <BigLines
              lines={f.lines}
              catalog={catalog}
              capNote={{ goodyear: 'Only 4 free. 2 more are held for Nina P.’s charge.' }}
              onQty={(l, n) => l.itemId && setQty(l.itemId, n)}
              onRemove={(l) => l.itemId && setQty(l.itemId, 0)}
            />
          </div>
        );
      } else if (items) {
        main = (
          <div className={one ? 'c-slab c-one' : 'c-slab'}>
            <ItemsCell
              catalog={catalog}
              view={f.view}
              onView={(view) => set({ view })}
              inCart={inCart}
              onAdd={(i) => addLine(i)}
              onQty={(i, n) => setQty(i.id, n)}
              onQuickSale={() => set({ sheet: { k: 'quick' } })}
              onOptions={(i) => set({ sheet: { k: 'options', item: i } })}
              tabs={f.catalog === 'food' ? ['All', 'Food', 'Drinks', 'Sweet'] : undefined}
              tileOrder={f.catalog === 'food' ? ['tacos', 'burrito', 'quesadilla', 'chips', 'horchata', 'agua', 'churros'] : TILE_ORDER}
            />
            <CartCell
              lines={f.lines}
              suggestion={suggestion}
              onAddSuggestion={() => {
                addLine(catalog.find((i) => i.id === 'mount')!, {}, tires);
                set({ suggested: true });
              }}
              onCheckout={() => set({ screen: 'checkout' })}
              heading={f.catalog === 'food' ? 'Order 47' : undefined}
              headingDet={f.catalog === 'food' ? '“Sam”' : undefined}
              heroLabel={f.catalog === 'food' ? 'Total' : undefined}
            />
          </div>
        );
      } else {
        main = (
          <AmountView
              cents={typedCents}
              limitCents={limitCents}
              fees={fees}
              recordedAgainst={seesMoney(role) ? undefined : who}
              owner={seesMoney(role)}
              onKey={(k) => setF((cur) => ({ ...cur, typed: typeAmount(cur.typed, k) }))}
              onContinue={() => set({ screen: 'checkout', lines: [] })}
            />
        );
      }
    }
  } else if (f.screen === 'checkout') {
    top = flowTop(`Checkout · ${usd(baseCents)}`);
    main = (
      <CheckoutView
        body={body}
        cardLocked={!preview || params.get('screen') === 'checkout-nostripe'}
        unavailable={preview ? [] : ['cash', 'split']}
        onEditCart={() => set({ screen: 'start' })}
        onDiscount={() => set({ sheet: { k: 'discount' } })}
        onRemoveDiscount={() => set({ discount: null })}
        onPick={pick}
      />
    );
  } else if (f.screen === 'tip') {
    top = flowTop('Turned to the customer');
    main = (
      <TipView
        shop={shop}
        totalCents={baseCents}
        count={body.lines.length ? totals(body.lines).count : undefined}
        presets={[500, 1000, 2000]}
        tip={f.tip}
        onTip={(tip) => set({ tip })}
        onContinue={afterTip}
      />
    );
  } else if (f.screen === 'code') {
    const c = { shop, amountCents: dueCents, date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), lines: body.lines.length ? body.lines : undefined, minimumCents: f.underMin ? 5000 : undefined };
    if (preview && params.get('screen') === 'code' && c.date) c.date = 'Sep 22';
    if (phone) {
      main = <PhoneCode code={f.code} amountCents={dueCents} onExit={exit} onScanTheirs={preview ? () => set({ screen: 'theirs' }) : undefined} onPhone={preview ? () => set({ screen: 'phone' }) : undefined} />;
    } else {
      top = flowTop(`${usd(dueCents)} · showing the code`, false);
      main = f.underMin ? (
        <div className="c-slab c-one">
          <CustomerCell c={c} />
        </div>
      ) : one ? (
        <div className="c-slab c-one">
          <CodeCell code={f.code} amountCents={dueCents} />
          <CustomerCell c={c} alts={preview ? ['theirs', 'phone'] : []} onScanTheirs={() => set({ screen: 'theirs' })} onPhone={() => set({ screen: 'phone' })} />
        </div>
      ) : preview ? (
        <ShowCodeView c={c} code={f.code} onScanTheirs={() => set({ screen: 'theirs' })} onPhone={() => set({ screen: 'phone' })} />
      ) : (
        // Live, the two shortcuts are left off: scanning a member's own code and texting a link
        // both need the backend, and a link that does nothing is worse than no link.
        <div className="c-slab">
          <CustomerCell c={c} alts={[]} />
          <CodeCell code={f.code} amountCents={dueCents} />
        </div>
      );
    }
  } else if (f.screen === 'theirs') {
    top = flowTop(`${usd(dueCents)} · scan their code`, false);
    main = <ScanTheirsView amountCents={dueCents} lines={body.lines.length ? body.lines : undefined} onShowMine={() => set({ screen: 'code' })} onPhone={() => set({ screen: 'phone' })} />;
  } else if (f.screen === 'phone') {
    top = flowTop(`${usd(dueCents)} · send to a number`, false);
    main = (
      <SendToNumberView
        shop={shop}
        amountCents={dueCents}
        code={f.code}
        digits={f.phone}
        onKey={(k) => setF((cur) => ({ ...cur, phone: k === 'del' ? cur.phone.slice(0, -1) : cur.phone.length >= 10 ? cur.phone : cur.phone + k }))}
        onSend={() => set({ screen: 'waiting' })}
        onShowMine={() => set({ screen: 'code' })}
        onScanTheirs={() => set({ screen: 'theirs' })}
      />
    );
  } else if (f.screen === 'waiting' || f.screen === 'approved') {
    const approved = f.screen === 'approved';
    const s: ChargeState = preview
      ? approved
        ? { ...DANA_OK, raisedBy: me }
        : { ...DANA, raisedBy: me }
      : {
          code: f.code,
          raisedBy: me,
          amountCents: dueCents,
          status: approved ? 'approved' : 'waiting',
          howPaid: approved && live?.splitInto ? `${live.splitInto} payments of ${usd(exampleSplit(dueCents).each)}` : undefined,
          steps: [
            { t: 'Raised', det: raisedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', ''), state: 'd' },
            { t: 'Opened', det: live?.openedAt ? new Date(live.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '') : 'Not yet', state: approved || live?.openedAt ? 'd' : 'on' },
            { t: 'Approved', det: approved ? 'Just now' : 'Any time today', state: approved ? 'd' : live?.openedAt ? 'on' : '' },
          ],
        };
    const fee = fees ? { label: `Fee · ${fees.over ?? fees.now}%${fees.over ? ', over time' : ''}`, cents: Math.round((dueCents * (fees.over ?? fees.now)) / 100) } : undefined;
    const reached = preview
      ? ([
          { how: 'Text', status: 'Delivered', at: '12:16pm' },
          { how: 'Email', status: 'Delivered', at: '12:16pm' },
          { how: 'App', status: 'Opened', at: '12:17pm' },
        ] as const)
      : live?.openedAt
        ? ([{ how: 'App', status: 'Opened', at: new Date(live.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '') }] as const)
        : [];
    const cancel = async () => {
      if (!preview && f.code) await api.cancelCharge(f.code).catch(() => undefined);
      exit();
    };
    if (phone) {
      main = (
        <PhoneStatus
          s={s}
          reached={reached.map((r) => ({ how: r.how, status: r.status }))}
          fee={fee}
          paidOut={preview ? 'Oct 14' : undefined}
          onExit={exit}
          onHome={exit}
          onSendAgain={() => undefined}
          onCancel={cancel}
          onDone={exit}
          onNew={again}
        />
      );
    } else {
      const first = s.customer?.split(/\s+/)[0];
      top = approved ? flowTop('Charge approved', false) : flowTop(first ? `Waiting on ${first}` : 'Waiting', false);
      main = approved ? (
        <ApprovedView
          s={s}
          fee={fee}
          paidOut={preview ? 'Oct 14, with this month’s charges' : undefined}
          shift={fee ? undefined : preview ? JEN_SHIFT : []}
          shiftOf={me}
          onDone={exit}
          onNew={again}
        />
      ) : (
        <WaitingView s={s} reached={[...reached]} onSendAgain={() => undefined} onCancel={cancel} onHome={exit} />
      );
    }
  } else if (f.screen === 'card') {
    top = flowTop(`${usd(dueCents)} · card`, false);
    const t = totals(body.lines);
    main = (
      <div className={one ? 'c-slab c-one' : 'c-slab'}>
        <CardChargeCell lines={body.lines} amountCents={f.reader === 'approved' && !tipCents ? baseCents : body.lines.length ? t.totalCents : dueCents} />
        <ReaderCell
          state={f.reader}
          amountCents={dueCents}
          at="4:41pm"
          receipt={<ReceiptGroups by={f.sendBy} onBy={(sendBy) => set({ sendBy })} to="(909) 555-0177" onChange={() => set({ sheet: { k: 'send', by: 'text', to: '(909) 555-0177' } })} onPrint={() => set({ sheet: { k: 'print', printer: 'ready' } })} />}
          onCancel={() => set({ screen: 'checkout' })}
          onTryAnother={() => set({ reader: 'ready' })}
          onOfferClear={() => set({ method: 'clear', screen: 'code', code: '8QK2' })}
          onDone={exit}
          onNew={again}
        />
      </div>
    );
  } else if (f.screen === 'cash') {
    top = flowTop(`Cash · ${usd(dueCents)}`);
    const given = Math.round(parseFloat(f.given || '0') * 100);
    main = (
        <CashView
          dueCents={dueCents}
          tipLabel={tipCents ? `With a ${usd(tipCents)} tip` : 'No tip'}
          givenCents={given}
          onKey={(k) => setF((cur) => ({ ...cur, given: typeAmount(cur.given, k) }))}
          onQuick={(c) => set({ given: (c / 100).toFixed(2) })}
          onTake={() => set({ screen: 'cashPaid', sendBy: 'none' })}
        />
    );
  } else if (f.screen === 'cashPaid') {
    top = flowTop(`Cash · ${usd(dueCents)}`);
    const given = Math.round(parseFloat(f.given || '0') * 100);
    main = (
      <CashPaidView
        dueCents={dueCents}
        givenCents={given}
        at={preview ? '4:41pm' : nowTime()}
        receipt={<ReceiptGroups icons={false} by={f.sendBy} onBy={(sendBy) => set({ sendBy })} none="No number for this customer" onPrint={() => set({ sheet: { k: 'print', printer: 'ready' } })} />}
        onDone={exit}
        onNew={again}
      />
    );
  } else if (f.screen === 'split') {
    top = flowTop(`Split · ${usd(dueCents)}`);
    const paid = f.legs.filter((l) => l.state === 'paid').reduce((s, l) => s + l.amountCents, 0);
    const declined = f.legs.some((l) => l.state === 'declined');
    const legs: Leg[] = declined ? f.legs : [...f.legs, { method: f.legMethod, amountCents: dueCents - paid, det: 'Choose below', state: 'next' }];
    main = declined ? (
      <div className="c-slab c-one">
        <SplitLegsCell totalCents={dueCents} legs={legs} />
      </div>
    ) : (
      <SplitView totalCents={dueCents} legs={legs} nextCents={dueCents - paid} method={f.legMethod} onMethod={(legMethod) => set({ legMethod })} onCharge={() => set({ screen: f.legMethod === 'card' ? 'card' : f.legMethod === 'cash' ? 'cash' : 'code', code: '8QK2' })} />
    );
  }

  // ---- Sheets ------------------------------------------------------------------------------------
  const close = () => set({ sheet: null });
  const sh = f.sheet;
  const sheet =
    sh?.k === 'options' ? (
      <OptionsSheet
        item={sh.item}
        initial={sh.missing ? {} : sh.item.id === 'michelin' ? { warranty: ['3y'], extras: ['disposal'] } : {}}
        initialQty={sh.item.id === 'michelin' ? 4 : 1}
        showMissing={sh.missing || !!missingGroup(sh.item, {})}
        onAdd={(picked, qty) => addLine(sh.item, picked, qty)}
        onClose={close}
      />
    ) : sh?.k === 'quick' ? (
      <QuickSaleSheet
        initialAmount={params.get('screen') === 'quicksale' ? '18.00' : ''}
        initialNote={params.get('screen') === 'quicksale' ? 'Patch, rear left tire' : ''}
        initialTax={params.get('screen') === 'quicksale' ? 'labour' : 'goods'}
        onAdd={({ cents, note, tax }) => setF((cur) => ({ ...cur, sheet: null, lines: [...cur.lines, { key: `quick:${cur.lines.length}`, name: note, qty: 1, unitCents: cents, tax }] }))}
        onClose={close}
      />
    ) : sh?.k === 'discount' ? (
      <DiscountSheet
        lines={body.lines}
        limitPercent={role === 'owner' ? null : role === 'manager' ? 25 : 10}
        check={(c) => CODES[c] ?? null}
        initialMode={sh.mode}
        initialCode={sh.code}
        initialValue={sh.value}
        pinFilled={sh.pin}
        onApply={(discount) => set({ discount, sheet: null })}
        onClose={close}
      />
    ) : sh?.k === 'send' ? (
      <SendReceiptSheet shop={shop} totalCents={dueCents} card="Visa ending 4242" date="Sep 22" link="useclear.org/r/8QK2" initialBy={sh.by} initialTo={sh.to} onSend={close} onClose={close} />
    ) : sh?.k === 'print' ? (
      <PrintReceiptSheet
        printer={sh.printer}
        slip={{
          shop,
          address: '412 Colton Ave · (909) 555-0180',
          when: `Sep 22, 4:41pm · ${me.split(/\s+/)[0]}`,
          lines: body.lines,
          taxCents: totals(body.lines).taxCents,
          totalCents: totals(body.lines).totalCents,
          paid: ['Visa ending 4242', 'Approved'],
        }}
        onPrint={close}
        onSendInstead={() => set({ sheet: { k: 'send', by: 'text', to: '' } })}
        onRetry={close}
        onClose={close}
      />
    ) : sh?.k === 'fail' ? (
      <FailureSheet
        kind={sh.kind}
        customer={preview ? 'Dana R.' : undefined}
        onPrimary={() => (sh.kind === 'declined' ? set({ sheet: null, screen: 'start' }) : preview ? set({ sheet: null, screen: 'waiting' }) : void raise().then(close))}
        onCash={() => set({ sheet: null, screen: 'cash' })}
        onCard={() => set({ sheet: null, screen: 'card' })}
        onClose={close}
      />
    ) : null;

  return (
    // A tablet frame, as the reference draws these, in landscape and portrait: the slab fills the
    // screen and each cell scrolls inside it, so the pad and the primary button never leave the
    // screen. The phone scrolls as a page.
    <div className={cx('c-app c-mc-tablet', phone && 'c-mc-page', FRAME[f.screen === 'start' && f.mode === 'items' ? 'items' : f.screen])}>
      {top}
      <OneColumn.Provider value={one}>{main}</OneColumn.Provider>
      {raiseError && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s2)' }}>
          {raiseError}
        </p>
      )}
      {raising && (
        <p className="c-det" aria-live="polite" style={{ marginTop: 'var(--s2)' }}>
          Raising the charge&hellip;
        </p>
      )}
      {sheet}
    </div>
  );
}
