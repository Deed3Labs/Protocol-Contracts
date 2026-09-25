import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Order, Tender } from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { Segmented } from '@/brand/controls';
import { OneColumn, cx } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { discardOnLeave, useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
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
import { CardChargeCell, PrintReceiptSheet, ReaderCell, ReaderPickerSheet, ReceiptGroups, SendReceiptSheet, type ReaderState, type SendBy } from '@/charge/card';
import { currentPlatform, previewPlatform, readerService, type Platform, type ReaderInfo, type ReaderService } from '@/reader';
import { CashPaidView, CashView, SplitLegsCell, SplitView, type Leg, type LegMethod } from '@/charge/cash';
import { cardName, chargeItemFrom, codeCheck, legsFromTenders, nothingTaken, payKey, pickedOptionIds, toLineInputs, totalsFromOrder } from '@/charge/live';
import { FailureSheet, PhoneAmount, PhoneCart, PhoneCode, PhoneItems, PhoneStatus } from '@/charge/phone';

/**
 * New charge — docs/merchant-reference/clear-merchant-new-charge.html.
 *
 * Start with an amount or items, check out, take the tip, then take it by Clear, card, cash or a
 * split. Every way ends the same: paid, a receipt, and New charge.
 *
 * **What runs live** (MerchantApi, UI Phase 6 step 4): the shop's catalogue, or a typed amount;
 * Checkout raises the order on the server, which works out tax, discounts and the total; the tip
 * from the shop's settings; then Clear (a tender on the order: its code shown, the member's answer
 * followed), cash (into the open drawer, the change the server's sum) or a split of those. An order
 * nothing was paid on is discarded on the way out, so its stock isn't left held. The card reader is
 * step 5. In development, `?preview=1&screen=<frame>` opens any frame of the reference on its own
 * scenario (see SCREENS), and `?preview=1&live=1` runs the live page against the mock.
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
  | { k: 'readers' }
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
  /** Bumped each time the reader starts collecting: arriving from Checkout, or another card. */
  run: number;
  /** "Visa ending 4242", from the reader. */
  card?: string;
  given: string;
  legs: Leg[];
  legMethod: LegMethod;
  /** Live: the split's next part, as typed; empty for all that's left. */
  part: string;
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
  run: 0,
  given: '',
  legs: [],
  legMethod: 'card',
  part: '',
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
  // The live shop's catalogue, codes, ways to pay and tips, from the merchant API.
  const merchant = useMerchantApi();
  const liveCatalog = useApi(() => (preview ? Promise.resolve(null) : merchant.catalog()), [preview]);
  const liveCodes = useApi(() => (preview ? Promise.resolve(null) : merchant.discountCodes()), [preview]);
  const liveSettings = useApi(() => (preview ? Promise.resolve(null) : merchant.settings()), [preview]);
  const liveCards = useApi(() => (preview ? Promise.resolve(null) : merchant.cardAvailability()), [preview]);
  const cardsOn = liveCards.data?.available === true && liveSettings.data?.paymentMethods.card !== false;
  const [order, setOrder] = useState<Order | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tender, setTender] = useState<Tender | null>(null);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
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

  const shopItems = useMemo(() => (liveCatalog.data ?? []).filter((c) => !c.archivedAt).map(chargeItemFrom), [liveCatalog.data]);
  const catalog = preview ? (f.catalog === 'food' ? FOOD : CATALOG) : shopItems;
  const typedCents = Math.round(parseFloat(f.typed || '0') * 100);
  const body = { lines: f.mode === 'items' ? f.lines : [], typedCents, discount: f.discount };
  // Live, the order's numbers are the server's: what it comes to, and what's still owed. The tip
  // goes on the first payment only, so a split doesn't tip twice.
  const tipTaken = tenders.some((t) => t.tipCents > 0 && t.status !== 'declined' && t.status !== 'cancelled');
  const tipCents = f.tip && f.tip.kind !== 'none' && !tipTaken ? f.tip.cents : 0;
  const baseCents = order ? order.remainingCents : chargeTotal(body);
  // A split's next part: what's typed, never more than is owed; otherwise all of it.
  const typedPart = Math.round(parseFloat(f.part || '0') * 100);
  const partCents = f.method === 'split' && order && typedPart > 0 ? Math.min(typedPart, order.remainingCents) : baseCents;
  const dueCents = partCents + tipCents;
  const inCart = useMemo(() => Object.fromEntries(f.lines.filter((l) => l.itemId).map((l) => [l.itemId!, l.qty])), [f.lines]);

  // ---- The live path: the order, and its payments -------------------------------------------
  const refresh = async (orderId: string) => {
    const [o, ts] = await Promise.all([merchant.order(orderId), merchant.tenders(orderId)]);
    setOrder(o);
    setTenders(ts);
    return o;
  };
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setPayError(null);
    try {
      await fn();
    } catch (e) {
      setPayError(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };

  /** Checkout: the cart as an order on the server, which prices it (tax, discount, total). */
  const toCheckout = () => {
    if (preview) return set({ screen: 'checkout' });
    const lines = toLineInputs(f.mode === 'items' ? f.lines : [], f.mode === 'items' ? 0 : typedCents);
    if (!lines.length) return;
    void attempt(async () => {
      const o = order && order.status === 'open' ? await merchant.updateOrder(order.id, { lines }) : order ? order : await merchant.createOrder({ lines, customer: null });
      setOrder(o);
      set({ screen: 'checkout' });
    });
  };

  /** Clear: a tender on the order for what's owed (and the tip), shown to the member as a code. */
  const raise = async () => {
    if (preview) {
      set({ screen: 'code', code: '8QK2' });
      return;
    }
    if (!order) return;
    setRaising(true);
    setRaiseError(null);
    try {
      const t = await merchant.createClearTender(order.id, { amountCents: partCents, tipCents, idempotencyKey: payKey() });
      setTender(t);
      setRaisedAt(new Date());
      setLive(null);
      set({ screen: 'code', code: t.clearChargeCode ?? '' });
    } catch (e) {
      setRaiseError(errorSentence(e));
    } finally {
      setRaising(false);
    }
  };

  // The member's answer, followed on the tender (and how far they've got, on the charge itself).
  useEffect(() => {
    if (preview || !tender || tender.method !== 'clear' || !['code', 'waiting'].includes(f.screen)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const t = await merchant.syncTender(tender.id);
        if (stopped) return;
        setTender(t);
        if (t.clearChargeCode) {
          const c = await api.watchCharge(t.clearChargeCode).catch(() => null);
          if (!stopped && c) {
            setLive({ openedAt: c.openedAt, resolvedAt: c.resolvedAt, splitInto: c.splitInto });
            if (c.openedAt && f.screen === 'code') set({ screen: 'waiting' });
          }
        }
        if (t.status === 'approved') {
          const o = await refresh(t.orderId);
          if (!stopped) set(o.remainingCents > 0 && f.method === 'split' ? { screen: 'split', part: '' } : { screen: 'approved' });
        } else if (t.status === 'declined') set({ sheet: { k: 'fail', kind: 'declined' } });
        else if (t.status === 'cancelled') set({ sheet: { k: 'fail', kind: 'expired' } });
      } catch {
        // A poll that fails changes nothing; the payment is safe on the server and the next tick asks again.
      }
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, tender?.id, f.screen]);

  /** Cash: what's owed (the tip with it), or in a split what was handed over up to what's owed. */
  const takeCash = () => {
    if (preview || !order) return set({ screen: 'cashPaid', sendBy: 'none' });
    const given = Math.round(parseFloat(f.given || '0') * 100);
    void attempt(async () => {
      const t = await merchant.createCashTender(order.id, { amountCents: partCents, tipCents, handedOverCents: given, idempotencyKey: payKey() });
      setTender(t);
      const o = await refresh(order.id);
      set(o.remainingCents > 0 ? { screen: 'split', given: '', part: '' } : { screen: 'cashPaid', sendBy: 'none' });
    });
  };

  /** Leaving: an order nothing was paid on is discarded, so its stock isn't held for nobody. */
  const discardIfUnpaid = async (o: Order | null) => {
    if (preview || !o || o.status === 'voided') return;
    const ts = await merchant.tenders(o.id).catch(() => null);
    if (ts && nothingTaken(ts)) await merchant.discardOrder(o.id).catch(() => undefined);
  };
  const release = () => discardIfUnpaid(order);
  // However the screen is left (the nav bar, Back, another tab of the app), not only by its own
  // buttons. Discarding is safe to repeat, so leaving by a button as well does no harm.
  const orderRef = useRef<Order | null>(null);
  orderRef.current = order;
  const tendersRef = useRef<Tender[]>([]);
  tendersRef.current = tenders;
  useEffect(
    () => () => {
      void discardIfUnpaid(orderRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The tab closed, or the tablet left the page, mid-charge: there's no time to ask the server
  // first, so this goes on what the page knows (the server refuses it if money was taken).
  useEffect(() => {
    if (preview) return;
    const onHide = () => {
      const o = orderRef.current;
      if (o && o.status !== 'voided' && nothingTaken(tendersRef.current)) discardOnLeave(o.id);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [preview]);

  // ---- The card reader ---------------------------------------------------------------------------
  // The reader service drives the card screen's four states: the installed app's plugin, a
  // browser's smart readers, or the preview's simulation. Leaving the screen cancels the payment.
  const readerPlatform: Platform = preview ? (previewPlatform(params) ?? 'ios') : currentPlatform();
  const [readerLabel, setReaderLabel] = useState<string | undefined>();
  const [readerError, setReaderError] = useState<string | null>(null);
  const [readerList, setReaderList] = useState<{ readers: ReaderInfo[]; current: string | null; loading: boolean; error: string | null }>({
    readers: [],
    current: null,
    loading: false,
    error: null,
  });
  const readerOpts = preview ? { preview: { platform: readerPlatform, decline: params.get('decline') === '1' } } : {};
  useEffect(() => {
    if (f.screen !== 'card' || preset?.reader) return;
    let on = true;
    let svc: ReaderService | null = null;
    setReaderError(null);
    readerService(readerOpts)
      .then(async (service) => {
        if (!on) return;
        svc = service;
        // Live, a reader to collect on: the one connected, else the shop's only (or, in a browser,
        // first) smart reader; with nothing to choose between, the reader list opens instead.
        if (!preview && !service.connected()) {
          const found = (await Promise.all(service.kinds.map((k) => service.discover(k).catch(() => [])))).flat();
          if (!on) return;
          if (found.length === 1 || (found.length > 0 && service.platform === 'web')) await service.connect(found[0]!);
          else {
            set({ sheet: { k: 'readers' } });
            if (!found.length) setReaderError('No reader this device can use. Add a smart reader in Settings › Payments.');
            return;
          }
        }
        setReaderLabel(service.connected()?.label);
        const result = await service.collect(
          preview ? dueCents : partCents,
          (e) => {
            if (!on) return;
            set(e.state === 'approved' || e.state === 'declined' ? { reader: e.state, card: 'card' in e ? e.card : undefined } : { reader: e.state });
          },
          preview || !order ? undefined : { orderId: order.id, tipCents },
        );
        // A card that went through on part of a split: back to the split for the rest.
        if (!preview && order && on && result.outcome === 'approved') {
          const o = await refresh(order.id);
          if (on && o.remainingCents > 0 && f.method === 'split') set({ screen: 'split', part: '' });
        }
      })
      .catch((e) => on && setReaderError(e instanceof Error ? e.message : 'The reader isn’t responding.'));
    return () => {
      on = false;
      void svc?.cancel();
    };
    // Collecting starts afresh on each run, not on every state the reader reports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.screen, f.run]);

  // "Use another reader": what this device can drive, found by the same service.
  useEffect(() => {
    if (f.sheet?.k !== 'readers') return;
    let on = true;
    setReaderList((l) => ({ ...l, loading: true, error: null }));
    readerService(readerOpts)
      .then(async (service) => {
        const found = (await Promise.all(service.kinds.map((k) => service.discover(k).catch(() => [])))).flat();
        if (on) setReaderList({ readers: found, current: service.connected()?.id ?? null, loading: false, error: null });
      })
      .catch((e) => on && setReaderList({ readers: [], current: null, loading: false, error: e instanceof Error ? e.message : 'The reader isn’t responding.' }));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.sheet?.k]);

  // ---- Moving through --------------------------------------------------------------------------
  const reset = () => {
    setOrder(null);
    setTenders([]);
    setTender(null);
    setPayError(null);
  };
  const exit = () => void release().then(() => navigate('/'));
  const again = () =>
    void release().then(() => {
      reset();
      setF({ ...BLANK });
    });
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
        : [...cur.lines, { key, itemId: item.id, name: item.name, chosen: chosen || undefined, qty, unitCents: unitPrice(item, picked), tax: item.tax, hasOptions: !!item.options, optionIds: pickedOptionIds(item, picked) }];
      return { ...cur, lines, sheet: null };
    });
  };
  const setQty = (itemId: string, qty: number) =>
    setF((cur) => ({ ...cur, lines: qty <= 0 ? cur.lines.filter((l) => l.itemId !== itemId) : cur.lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)) }));
  const tipsOn = preview || liveSettings.data?.tips.enabled !== false;
  const pick = (m: Method) => {
    setPayError(null);
    // The tip is asked first, on the customer's side, when the shop takes tips.
    if (tipsOn) set({ method: m, screen: 'tip', tip: null });
    else {
      set({ method: m, tip: { kind: 'none' } });
      afterTipFor(m);
    }
  };
  const afterTip = () => afterTipFor(f.method);
  const afterTipFor = (method: Method | null) => {
    if (method === 'clear') void raise();
    else if (method === 'card') setF((cur) => ({ ...cur, screen: 'card', reader: 'ready', run: cur.run + 1 }));
    else if (method === 'cash') set({ screen: 'cash', given: '' });
    // The split starts on card, as the reference draws it, where the shop takes cards.
    else set({ screen: 'split', legs: [], legMethod: preview || cardsOn ? 'card' : 'cash' });
  };

  // Tires usually go with mount and balance: suggested once, the count matched.
  const tires = f.lines.filter((l) => catalog.find((i) => i.id === l.itemId)?.thumb === 'tire').reduce((s, l) => s + l.qty, 0);
  // The reference's item is `mount`; a live shop's is whatever its catalogue calls it.
  const mountItem = catalog.find((i) => i.id === 'mount' || /^mount and balance$/i.test(i.name));
  const suggestion =
    f.catalog === 'shop' && mountItem && tires > 0 && !f.lines.some((l) => l.itemId === mountItem.id) && !f.suggested
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
    // A shop with a catalogue starts with an amount or its items; one without, with an amount.
    const hasItems = preview || shopItems.length > 0;
    const items = hasItems && f.mode === 'items';
    if (phone) {
      main =
        items && f.screen === 'cart' ? (
          <PhoneCart
            lines={f.lines}
            catalog={catalog}
            onQty={(l, n) => l.itemId && setQty(l.itemId, n)}
            onRemove={(l) => l.itemId && setQty(l.itemId, 0)}
            onBack={() => set({ screen: 'start' })}
            onCheckout={toCheckout}
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
            onContinue={toCheckout}
            onExit={exit}
            // A shop with a catalogue switches to its items here, as on a tablet.
            modeSwitch={hasItems ? modeSwitch : undefined}
          />
        );
    } else {
      top = hasItems ? (
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
                if (mountItem) addLine(mountItem, {}, tires);
                set({ suggested: true });
              }}
              onCheckout={toCheckout}
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
              onContinue={toCheckout}
            />
        );
      }
    }
  } else if (f.screen === 'checkout') {
    top = flowTop(`Checkout · ${usd(baseCents)}`);
    main = (
      <CheckoutView
        body={body}
        server={order ? totalsFromOrder(order) : null}
        // Live, cards open once Stripe is connected and cards are on in Settings › Payments.
        cardLocked={preview ? params.get('screen') === 'checkout-nostripe' : !cardsOn}
        unavailable={
          preview
            ? []
            : ([!liveSettings.data?.paymentMethods.cash && 'cash', !liveSettings.data?.paymentMethods.split && 'split'].filter(Boolean) as Method[])
        }
        onEditCart={() => set({ screen: 'start' })}
        onDiscount={() => set({ sheet: { k: 'discount' } })}
        onRemoveDiscount={() =>
          preview || !order
            ? set({ discount: null })
            : void attempt(async () => {
                setOrder(await merchant.removeDiscount(order.id));
                set({ discount: null });
              })
        }
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
        presets={preview ? [500, 1000, 2000] : (liveSettings.data?.tips.presets ?? [500, 1000, 2000])}
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
    // Live, the payment's own amount: once it's approved nothing is owed, so "due" would read $0.00.
    const shownCents = !preview && tender?.method === 'clear' ? tender.amountCents + tender.tipCents : dueCents;
    const s: ChargeState = preview
      ? approved
        ? { ...DANA_OK, raisedBy: me }
        : { ...DANA, raisedBy: me }
      : {
          code: f.code,
          raisedBy: me,
          amountCents: shownCents,
          status: approved ? 'approved' : 'waiting',
          howPaid: approved && live?.splitInto ? `${live.splitInto} payments of ${usd(exampleSplit(shownCents).each)}` : undefined,
          steps: [
            { t: 'Raised', det: raisedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', ''), state: 'd' },
            { t: 'Opened', det: live?.openedAt ? new Date(live.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '') : 'Not yet', state: approved || live?.openedAt ? 'd' : 'on' },
            { t: 'Approved', det: approved ? 'Just now' : 'Any time today', state: approved ? 'd' : live?.openedAt ? 'on' : '' },
          ],
        };
    const fee = fees ? { label: `Fee · ${fees.over ?? fees.now}%${fees.over ? ', over time' : ''}`, cents: Math.round((shownCents * (fees.over ?? fees.now)) / 100) } : undefined;
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
      if (!preview && tender) await merchant.cancelTender(tender.id).catch(() => undefined);
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
    // Live, once the card has gone through nothing may be owed: show the payment itself.
    const paidCard = !preview ? [...tenders].reverse().find((t) => t.method === 'card' && (t.status === 'authorised' || t.status === 'captured')) : undefined;
    const cardCents = f.reader === 'approved' && paidCard ? paidCard.amountCents + paidCard.tipCents : dueCents;
    top = flowTop(`${usd(cardCents)} · card`, false);
    const t = totals(body.lines);
    main = (
      <div className={one ? 'c-slab c-one' : 'c-slab'}>
        <CardChargeCell
          lines={body.lines}
          amountCents={preview ? (f.reader === 'approved' && !tipCents ? baseCents : body.lines.length ? t.totalCents : dueCents) : paidCard ? paidCard.amountCents : partCents}
        />
        <ReaderCell
          state={f.reader}
          amountCents={cardCents}
          at={preview ? '4:41pm' : nowTime()}
          receipt={
            preview ? (
              <ReceiptGroups by={f.sendBy} onBy={(sendBy) => set({ sendBy })} to="(909) 555-0177" onChange={() => set({ sheet: { k: 'send', by: 'text', to: '(909) 555-0177' } })} onPrint={() => set({ sheet: { k: 'print', printer: 'ready' } })} />
            ) : (
              <ReceiptGroups by={f.sendBy} onBy={(sendBy) => set({ sendBy })} onChange={() => set({ sheet: { k: 'send', by: 'text', to: '' } })} onPrint={() => set({ sheet: { k: 'print', printer: 'ready' } })} />
            )
          }
          reader={readerLabel}
          card={f.card}
          error={readerError}
          onCancel={() => set({ screen: 'checkout' })}
          onOtherReader={() => set({ sheet: { k: 'readers' } })}
          onTryAnother={() => setF((cur) => ({ ...cur, reader: 'ready', run: cur.run + 1 }))}
          onOfferClear={() => (preview ? set({ method: 'clear', screen: 'code', code: '8QK2' }) : void raise())}
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
          onTake={takeCash}
        />
    );
  } else if (f.screen === 'cashPaid') {
    // Live, what the server took and the change it worked out.
    const paidCents = tender && tender.method === 'cash' ? tender.amountCents + tender.tipCents : dueCents;
    top = flowTop(`Cash · ${usd(paidCents)}`);
    const given = tender && tender.method === 'cash' ? (tender.handedOverCents ?? paidCents) : Math.round(parseFloat(f.given || '0') * 100);
    main = (
      <CashPaidView
        dueCents={paidCents}
        givenCents={given}
        at={preview ? '4:41pm' : nowTime()}
        receipt={<ReceiptGroups icons={false} by={f.sendBy} onBy={(sendBy) => set({ sendBy })} none="No number for this customer" onPrint={() => set({ sheet: { k: 'print', printer: 'ready' } })} />}
        onDone={exit}
        onNew={again}
      />
    );
  } else if (f.screen === 'split') {
    top = flowTop(`Split · ${usd(dueCents)}`);
    // Live, the parts are the order's tenders and what's left is the server's.
    const done: Leg[] = preview ? f.legs : legsFromTenders(tenders);
    // The parts count toward the order's total; a tip rides on top of the first part it's paid with.
    const total = preview ? dueCents : (order?.totalCents ?? 0);
    const paid = done.filter((l) => l.state === 'paid').reduce((s, l) => s + l.amountCents, 0);
    const declined = preview && f.legs.some((l) => l.state === 'declined');
    const next = preview ? dueCents - paid : partCents;
    const legs: Leg[] = declined ? done : [...done, { method: f.legMethod, amountCents: next, det: 'Choose below', state: 'next' }];
    const chargeLeg = () => {
      if (preview) return set({ screen: f.legMethod === 'card' ? 'card' : f.legMethod === 'cash' ? 'cash' : 'code', code: '8QK2' });
      if (f.legMethod === 'cash') return set({ screen: 'cash', given: '' });
      if (f.legMethod === 'clear') return void raise();
      if (!cardsOn) return setPayError('Cards aren’t available for this shop yet. Take this part by Clear or cash.');
      setF((cur) => ({ ...cur, screen: 'card', reader: 'ready', run: cur.run + 1 }));
    };
    main = declined ? (
      <div className="c-slab c-one">
        <SplitLegsCell totalCents={total} legs={legs} />
      </div>
    ) : (
      <SplitView
        totalCents={total}
        legs={legs}
        nextCents={next}
        method={f.legMethod}
        onMethod={(legMethod) => set({ legMethod })}
        onCharge={chargeLeg}
        {...(preview ? {} : { typed: f.part, onAmount: (part: string) => set({ part }) })}
      />
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
        check={(c) => (preview ? (CODES[c] ?? null) : codeCheck(liveCodes.data ?? [], c))}
        askPin={!preview}
        initialMode={sh.mode}
        initialCode={sh.code}
        initialValue={sh.value}
        pinFilled={sh.pin}
        onApply={(discount, pin) =>
          preview || !order
            ? set({ discount, sheet: null })
            : void attempt(async () => {
                const o = await merchant.applyDiscount(
                  order.id,
                  discount.code
                    ? { kind: 'code', code: discount.code }
                    : {
                        kind: 'manual',
                        percent: discount.percent !== undefined ? Math.max(1, Math.round(discount.percent)) : null,
                        amountCents: discount.percent === undefined ? (discount.amountCents ?? null) : null,
                        reason: discount.reason ?? 'Other',
                        approverPin: pin,
                      },
                );
                setOrder(o);
                set({ discount: { ...discount, label: o.discount?.label ?? discount.label }, sheet: null });
              })
        }
        onClose={close}
      />
    ) : sh?.k === 'send' ? (
      <SendReceiptSheet
        shop={shop}
        totalCents={preview ? dueCents : tender ? tender.amountCents + tender.tipCents : dueCents}
        card={preview ? 'Visa ending 4242' : tender?.method === 'card' ? cardName(tender) : tender?.method === 'cash' ? 'Cash' : 'Clear'}
        date={preview ? 'Sep 22' : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        link={preview ? 'useclear.org/r/8QK2' : 'a link to the receipt'}
        initialBy={sh.by}
        initialTo={sh.to}
        onSend={
          preview || !order
            ? close
            : (by, to) =>
                void attempt(async () => {
                  await merchant.sendReceipt(order.id, { by, to });
                  close();
                })
        }
        onClose={close}
      />
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
    ) : sh?.k === 'readers' ? (
      <ReaderPickerSheet
        readers={readerList.readers}
        current={readerList.current}
        web={readerPlatform === 'web'}
        loading={readerList.loading}
        error={readerList.error}
        onPick={(r) =>
          void readerService(readerOpts)
            .then((service) => service.connect(r))
            .then(() => {
              setReaderLabel(r.label);
              setF((cur) => ({ ...cur, sheet: null, reader: 'ready', run: cur.run + 1 }));
            })
            .catch((e) => setReaderList((l) => ({ ...l, error: e instanceof Error ? e.message : 'That reader didn’t connect.' })))
        }
        onClose={close}
      />
    ) : sh?.k === 'fail' ? (
      <FailureSheet
        kind={sh.kind}
        customer={preview ? 'Dana R.' : undefined}
        onPrimary={() => (sh.kind === 'declined' ? set({ sheet: null, screen: 'start' }) : preview ? set({ sheet: null, screen: 'waiting' }) : void raise().then(close))}
        onCash={() => set({ sheet: null, screen: 'cash' })}
        onCard={() => setF((cur) => ({ ...cur, sheet: null, screen: 'card', reader: 'ready', run: cur.run + 1 }))}
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
      {(raiseError || payError) && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s2)' }}>
          {raiseError ?? payError}
        </p>
      )}
      {busy && (
        <p className="c-det" aria-live="polite" style={{ marginTop: 'var(--s2)' }}>
          One moment&hellip;
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
