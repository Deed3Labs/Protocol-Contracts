import { useContext, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { canAuthoriseRefund, canTransition, CHARGE_LABEL, refundQuote, splitQuote, toCents } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { OneColumn, cx, useDigitKeys } from '@/brand/ui';
import { PhoneBack } from '@/charge/phone';
import { api, type MerchantCharge } from '@/data/apiClient';
import { errorSentence, useApi } from '@/data/useApi';
import { STUB_MERCHANT } from '@/data/stubs';
import { clockTime, firstName, usd } from '@/home/model';
import { useLayout } from '@/lib/useBreakpoint';
import { FlowTop, roleLabel } from '@/shell/chrome';
import { useShiftActions } from '@/shell/shiftActions';
import type { OrderWithTenders } from '@clear/merchant-contracts';
import { CARD_SALE, MARCUS, MARCUS_DETAIL, SPLIT_SALE, saleFromOrder, type ClearDetail, type Sale } from '@/charges/model';
import { useMerchantApi } from '@/data/merchantApi';
import {
  ChoseCell,
  GoodsRefundSheet,
  PaidHowCell,
  RefundApproveSheet,
  RefundDeclinedSheet,
  RefundedSheet,
  RefundReviewSheet,
  RefundWaitingSheet,
  ShopGetsCell,
  SoldCell,
  ThisChargeCell,
  TipSheet,
  VoidSheet,
  type Person,
  type Quote,
  ManagerPinSheet,
} from '@/charges/views';

/**
 * A charge, opened — docs/merchant-reference/clear-merchant-charges.html ("A charge, opened", "A
 * Clear refund", "Refunds by how it was paid", "Void, and adjusting a tip").
 *
 * A flow at every size: back, what it is, who is on shift. An owner sees what the shop gets; a
 * counter shift sees the charge without the fee or the payout date. The refund is the reference's
 * two people, three steps, as sheets over the charge; `/charges/:id/refund` opens it, which is
 * where an owner's phone lands.
 *
 * **Nothing is said to the customer until step three completes**, and every sheet says whose it
 * is. The writer sees what the customer gets back; the owner sees what it does to their payout.
 * Both come from one `refundQuote`, so they cannot drift apart.
 *
 * A card, cash or split sale opens by its order id: what was sold and how it was paid. The same
 * day, before a card on it is captured, it can be voided (a manager's PIN) and a card's tip
 * adjusted; once money is taken, goods can be refunded, the card first and then cash, back into
 * stock or not, with a manager's PIN when a counter shift asks. The preview's reference sales are
 * `/charges/split` and `/charges/card`. Frames: `?preview=1&screen=counter|refund|waiting|approve|
 * refunded|declined` on /charges/marcus, `refund-goods` on /charges/split, `void|tip` on
 * /charges/card.
 */

type Step = 'review' | 'waiting' | 'approve' | 'done' | 'declined' | null;

const clockOf = (d: Date | string) => clockTime(typeof d === 'string' ? d : d.toISOString());

const toQuote = (q: ReturnType<typeof refundQuote>): Quote => ({
  amountCents: toCents(q.amount),
  memberCents: toCents(q.memberReceives),
  carryCents: toCents(q.carryKept),
  clawbackCents: toCents(q.merchantClawback),
  payoutAfterCents: toCents(q.payoutAfter),
});

/** Marcus T.'s refund, from the reference: $412.00 over four, one cleared, a $4,218.91 payout. */
const MARCUS_QUOTE = toQuote(
  refundQuote({ amount: 412, splitInto: 4, ratePerCycle: 0.02, cyclesCleared: 1, discountRate: 0.02, nextPayout: 4218.91 }),
);

export default function ChargeDetailPage() {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const layout = useLayout();
  const phone = layout === 'phone';
  const one = useContext(OneColumn);
  const shift = useShiftActions();
  const { session, canSeeMoney, authoriseWithOwnerCode } = useAuth();

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? '') : '';
  const q = preview
    ? '?preview=1'
    : import.meta.env.DEV && params.get('preview') === '1'
      ? `?preview=1&live=1${params.get('as') ? `&as=${params.get('as')}` : ''}`
      : '';
  const back = () => navigate(`/charges${q}`);
  const me = session?.staff.name ?? '';

  // ---- The live charge ------------------------------------------------------------------------------
  // No single-charge endpoint: the list is what the tablet already reads, and a shop's day is small
  // enough that finding the row in it costs less than another route.
  const { data: charges, loading } = useApi(() => (preview ? Promise.resolve(null) : api.charges({ limit: 200 })), [preview]);
  const { data: profile } = useApi(() => (preview ? Promise.resolve(null) : api.profile()), [preview]);
  const { data: position } = useApi(() => (preview || !canSeeMoney ? Promise.resolve(null) : api.payouts()), [preview, canSeeMoney]);
  // Who can clear a refund, by name: the roster every shift can read (the staff list is owners' and
  // managers' only, and a counter shift asking for a refund needs the owner's name as much as anyone).
  const { data: staff } = useApi(() => (preview ? Promise.resolve(null) : api.roster()), [preview]);
  const { data: threshold } = useApi(
    () => (preview || session?.staff.role !== 'owner' ? Promise.resolve(null) : api.refundThreshold()),
    [preview, session?.staff.role],
  );
  const { data: openRefund } = useApi(() => (preview ? Promise.resolve(null) : api.openRefundFor(id)), [preview, id]);

  const charge = (charges ?? []).find((c) => c.code === id);

  // Not a Clear charge: a card, cash or split sale, by its order id.
  const merchant = useMerchantApi();
  const lookForSale = !preview && !loading && !charge;
  const order = useApi<OrderWithTenders | null>(
    () => (lookForSale ? Promise.all([merchant.order(id), merchant.tenders(id)]).then(([o, tenders]) => ({ ...o, tenders })) : Promise.resolve(null)),
    [lookForSale, id],
  );
  const people = useApi(() => (preview ? Promise.resolve(null) : api.roster()), [preview]);
  const nameOf = (staffId: string) => people.data?.find((p) => p.id === staffId)?.name ?? '—';
  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const liveSale = order.data ? saleFromOrder(order.data, nameOf, localDay()) : null;
  // A void's PIN, or a counter shift's refund waiting on a manager's.
  const [pin, setPin] = useState('');
  const [pinFor, setPinFor] = useState<string[] | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);


  const [step, setStep] = useState<Step>(() => {
    if (screen === 'refund') return 'review';
    if (screen === 'waiting') return 'waiting';
    if (screen === 'approve') return 'approve';
    if (screen === 'refunded') return 'done';
    if (screen === 'declined') return 'declined';
    return pathname.endsWith('/refund') ? 'review' : null;
  });
  const [sheet, setSheet] = useState<'goods' | 'void' | 'tip' | null>(
    screen === 'refund-goods' ? 'goods' : screen === 'void' ? 'void' : screen === 'tip' ? 'tip' : null,
  );
  const pinOpen = !preview && (sheet === 'void' || pinFor !== null);
  const digit = (d: string) => (setSaleError(null), setPin((p) => (p.length >= 4 ? p : p + d)));
  const undigit = () => setPin((p) => p.slice(0, -1));
  useDigitKeys(pinOpen && !saleBusy, digit, undigit);
  const [refundId, setRefundId] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState(preview ? '2:31pm' : '');
  const [requester, setRequester] = useState<string>(preview ? 'Jen R.' : me);
  const [decided, setDecided] = useState(preview ? 'Mike · 2:36pm' : '');
  const [approver, setApprover] = useState<Person | null>(preview ? { name: 'Mike R.', role: 'owner' } : null);
  const [via, setVia] = useState<'code' | 'device'>('device');
  const [code, setCode] = useState(preview && screen === 'waiting' ? '12' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Adopt a refund this screen did not start: an owner opening it on their phone, or the same
   * tablet after a reload. The record on the server says which step this is.
   */
  useEffect(() => {
    if (!openRefund || refundId) return;
    setRefundId(openRefund.id);
    setRequestedAt(clockOf(openRefund.requestedAt));
    setRequester(openRefund.requestedByName);
    if (pathname.endsWith('/refund')) setStep('waiting');
  }, [openRefund, refundId, pathname]);

  // ---- What this page shows ------------------------------------------------------------------------
  const sale: Sale | null = preview ? (id === 'split' ? SPLIT_SALE : id === 'card' ? CARD_SALE : null) : liveSale;
  const counterView = screen === 'counter' || (!preview && !canSeeMoney);

  let name: string;
  let amountCents: number;
  let detail: ClearDetail | null = null;
  let status = '';
  let raisedBy = '';
  let live: MerchantCharge | undefined;
  if (sale) {
    name = sale.name;
    amountCents = sale.totalCents;
  } else if (preview) {
    name = MARCUS.name;
    amountCents = MARCUS.amountCents;
    detail = MARCUS_DETAIL;
    status = 'Confirmed';
    raisedBy = 'You, at 11:02am';
  } else {
    if (loading && !charge) return null;
    // Not a Clear charge: wait for its order, and go back to the list only once it isn't one either.
    if (!charge) return lookForSale && !order.error ? null : <Navigate to={`/charges${q}`} replace />;
    live = charge;
    name = charge.memberName ?? 'A customer';
    amountCents = toCents(charge.amount);
    const rate = profile?.discountRate ?? null;
    const n = charge.splitInto;
    detail = {
      payoutCents: charge.payout !== undefined ? toCents(charge.payout) : null,
      feeCents: charge.payout !== undefined ? amountCents - toCents(charge.payout) : null,
      rate: rate === null ? null : `${(rate * 100).toFixed(1)}%`,
      // An approved charge is paid with the next payout: its day, or net-30 when none is set.
      paidOut:
        charge.state !== 'approved' || !position
          ? null
          : position.nextPayoutOn
            ? new Date(position.nextPayoutOn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'Net-30',
      splitInto: n,
      perCycleCents: n && n > 1 ? toCents(splitQuote(charge.amount, n, STUB_MERCHANT.ratePerCycle).perCycle) : null,
    };
    status = CHARGE_LABEL[charge.state];
    raisedBy = `${charge.raisedByStaffId === session?.staff.id ? 'You' : (charge.raisedBy ?? '—')}, at ${clockTime(charge.createdAt)}`;
  }
  const title = `${name} · ${usd(amountCents)}`;

  // ---- The refund's numbers and who can clear it ---------------------------------------------------
  const quote: Quote = live
    ? toQuote(
        refundQuote({
          amount: live.amount,
          // How many cycles the member has cleared is not on the merchant's feed, so the clawback is
          // quoted against the whole plan: it never understates what a refund costs the shop.
          splitInto: live.splitInto ?? 1,
          ratePerCycle: STUB_MERCHANT.ratePerCycle,
          cyclesCleared: 0,
          discountRate: profile?.discountRate ?? 0,
          nextPayout: (position?.owedCents ?? 0) / 100,
        }),
      )
    : MARCUS_QUOTE;
  const roster = staff ?? [];
  const ownerName = preview ? 'Mike R.' : (roster.find((s) => s.role === 'owner')?.name ?? 'the owner');
  const managers = preview ? ['Luis'] : roster.filter((s) => s.role === 'manager').map((s) => firstName(s.name));
  const limitCents = preview ? 50000 : (threshold?.limitCents ?? null);
  const role = session?.staff.role ?? null;
  const limitKnown = limitCents !== null;
  /** A code at the counter is bounded, whoever's it is: strictly under the limit. */
  const codeCanClear = preview || !limitKnown || (limitCents > 0 && amountCents < limitCents);
  /** This viewer, signed in on this device: the stronger evidence, and uncapped for an owner. */
  const viewerCanDecide = !preview && role !== null && canAuthoriseRefund(role, amountCents, limitKnown ? limitCents : undefined);

  async function send() {
    if (!live) return setStep('waiting');
    setBusy(true);
    setError(null);
    try {
      const created = await api.requestRefund({
        chargeCode: live.code,
        splitInto: live.splitInto ?? 1,
        cyclesCleared: 0,
        ratePerCycle: STUB_MERCHANT.ratePerCycle,
        discountRate: profile?.discountRate ?? 0,
        nextPayoutCents: position?.owedCents ?? 0,
      });
      setRefundId(created.id);
      setRequestedAt(clockOf(new Date()));
      setRequester(me);
      setStep(viewerCanDecide ? 'approve' : 'waiting');
      if (viewerCanDecide) {
        setApprover({ name: me, role: role ?? 'owner' });
        setVia('device');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be sent just now.');
    } finally {
      setBusy(false);
    }
  }

  async function typed(pin: string) {
    setCode(pin);
    setError(null);
    if (pin.length < 4) return;
    if (preview) {
      setApprover({ name: 'Luis M.', role: 'manager' });
      setVia('code');
      return setStep('approve');
    }
    try {
      const who = await authoriseWithOwnerCode(pin);
      setApprover({ name: who.name, role: roleLabel(who.role).toLowerCase() });
      setVia('code');
      setStep('approve');
    } catch (e) {
      setCode('');
      setError(e instanceof Error ? e.message : 'That PIN was not recognised.');
    }
  }

  async function decide(decision: 'approve' | 'decline') {
    if (preview) {
      if (approver) setDecided(`${firstName(approver.name)} · 2:36pm`);
      return setStep(decision === 'approve' ? 'done' : 'declined');
    }
    if (!refundId) return setError('That refund was not recorded. Start it again.');
    setBusy(true);
    setError(null);
    try {
      if (via === 'code') await api.authoriseRefund(refundId, code, decision);
      else await api.decideRefund(refundId, decision);
      setDecided(`${firstName(approver?.name ?? me)} · ${clockOf(new Date())}`);
      setStep(decision === 'approve' ? 'done' : 'declined');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be recorded just now.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (live && refundId) await api.withdrawRefund(refundId).catch(() => undefined);
    setRefundId(null);
    setStep(null);
    setCode('');
  }

  // A viewer who can decide on this device goes straight to deciding.
  const waitingOrDecide: Step = step === 'waiting' && viewerCanDecide ? 'approve' : step;
  const writer: Person = { name: preview ? 'Jen R.' : requester || me, role: preview ? 'counter' : roleLabel(role ?? 'counter').toLowerCase() };
  const decider: Person = approver ?? { name: me, role: roleLabel(role ?? 'owner').toLowerCase() };

  // ---- The foot of the right-hand cell -------------------------------------------------------------
  const cancellable = !!live && canTransition(live.state, 'cancelled') && (canSeeMoney || live.raisedByStaffId === session?.staff.id);
  const refundable = preview || (!!live && canTransition(live.state, 'refund_requested'));
  const awaiting = !!live && live.state === 'refund_requested';
  const foot = cancellable ? (
    <button
      type="button"
      className="c-btn c-btn-lg"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.cancelCharge(live!.code);
          back();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That could not be cancelled just now.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Cancelling…' : 'Cancel charge'}
    </button>
  ) : awaiting ? (
    <button type="button" className="c-btn c-btn-lg" onClick={() => setStep('waiting')}>
      {canSeeMoney ? 'Approve or decline the refund' : 'See the refund'}
    </button>
  ) : refundable ? (
    // Never "Refund": the writer is beginning something, not completing it.
    <button type="button" className="c-btn c-btn-lg" onClick={() => setStep('review')}>
      Start a refund
    </button>
  ) : undefined;

  // ---- A live sale's actions ------------------------------------------------------------------------
  const o = order.data;
  const by = o ? firstName(nameOf(o.raisedBy)) : '';
  const authorisedCard = o?.tenders.find((t) => t.method === 'card' && t.status === 'authorised');
  const openSheet = (k: 'goods' | 'void' | 'tip') => (setPin(''), setSaleError(null), setSheet(k));
  const endSheet = () => (setSheet(null), setPinFor(null), setPin(''), setSaleError(null));
  async function act(fn: () => Promise<unknown>) {
    setSaleBusy(true);
    setSaleError(null);
    try {
      await fn();
      endSheet();
      order.reload();
    } catch (e) {
      setPin('');
      setSaleError(errorSentence(e));
    } finally {
      setSaleBusy(false);
    }
  }
  /**
   * Refund goods: the money goes back the way it came, the card first, then cash from the drawer,
   * one refund per tender (the items ride on the first). A manager's or owner's own request is
   * approved as it's made; a counter shift's waits for a manager's PIN.
   */
  async function refundGoods(returned: { index: number; quantity: number; backInStock: boolean; cents: number }[]) {
    if (!o) return;
    let left = returned.reduce((s, r) => s + r.cents, 0);
    const items = returned.map((r) => ({ orderLineId: o.lines[r.index]!.id, quantity: r.quantity, backInStock: r.backInStock }));
    const order_ = [...o.tenders.filter((t) => t.method === 'card'), ...o.tenders.filter((t) => t.method === 'cash')].filter((t) =>
      ['captured', 'approved', 'partly_refunded'].includes(t.status),
    );
    setSaleBusy(true);
    setSaleError(null);
    try {
      const waiting: string[] = [];
      for (const [i, t] of order_.entries()) {
        const cents = Math.min(left, t.amountCents + t.tipCents - t.refundedCents);
        if (cents <= 0) continue;
        const r = await merchant.requestRefund({ tenderId: t.id, amountCents: cents, items: i === 0 ? items : [], reason: null, idempotencyKey: crypto.randomUUID() });
        if (r.status === 'requested') waiting.push(r.id);
        left -= cents;
      }
      if (waiting.length) {
        setPin('');
        setPinFor(waiting);
        setSheet(null);
      } else {
        endSheet();
        order.reload();
      }
    } catch (e) {
      setSaleError(errorSentence(e));
    } finally {
      setSaleBusy(false);
    }
  }
  const returnLines =
    o?.lines.map((l) => ({
      t: `${l.quantity} × ${l.name}`,
      det: l.taxKind === 'labour' ? 'Labour, already done' : `${usd(l.unitCents)} each${l.taxCents && !o.taxIncluded ? ' + tax' : ''}`,
      cents: l.lineCents - l.discountCents + (o.taxIncluded ? 0 : l.taxCents),
      labour: l.taxKind === 'labour',
      stock: l.taxKind !== 'labour',
      quantity: l.quantity,
    })) ?? [];

  const cells = sale ? (
    <>
      <SoldCell s={sale} />
      <PaidHowCell
        s={sale}
        onRefund={preview || o?.tenders.some((t) => ['captured', 'approved', 'partly_refunded'].includes(t.status) && t.method !== 'clear') ? () => openSheet('goods') : undefined}
        onVoid={() => openSheet('void')}
        onTip={preview || authorisedCard ? () => openSheet('tip') : undefined}
      />
    </>
  ) : (
    <>
      {counterView || (live && live.state !== 'approved' && live.state !== 'refunded' && live.state !== 'refund_requested') ? (
        <ThisChargeCell amountCents={amountCents} raisedBy={raisedBy} status={status} />
      ) : (
        <ShopGetsCell d={detail!} />
      )}
      <ChoseCell d={live && (live.state === 'waiting' || live.state === 'resolving') ? null : detail} foot={foot} />
    </>
  );

  const sheets = (
    <>
      {waitingOrDecide === 'review' && (
        <RefundReviewSheet customer={name} q={quote} writer={writer} owner={ownerName} busy={busy} error={error} onSend={send} onCancel={() => setStep(null)} />
      )}
      {waitingOrDecide === 'waiting' && (
        <RefundWaitingSheet
          customer={name}
          amountCents={amountCents}
          writer={writer.name}
          owner={ownerName}
          requestedAt={requestedAt}
          limitCents={limitCents}
          managers={managers}
          pin={code}
          onPin={typed}
          codeCanClear={codeCanClear}
          error={error}
          onWithdraw={withdraw}
          onClose={() => setStep(null)}
        />
      )}
      {waitingOrDecide === 'approve' && (
        <RefundApproveSheet customer={name} q={quote} writer={writer.name} approver={decider} busy={busy} error={error} onApprove={() => decide('approve')} onDecline={() => decide('decline')} />
      )}
      {step === 'done' && <RefundedSheet customer={name} q={quote} asked={`${firstName(writer.name)} · ${requestedAt}`} approved={decided} onDone={back} />}
      {step === 'declined' && <RefundDeclinedSheet customer={name} decider={decider.name} onDone={() => setStep(null)} />}
      {sale && sheet === 'goods' && (
        <GoodsRefundSheet
          s={sale}
          lines={
            preview
              ? [
                  { t: '1 × Goodyear Assurance', det: '$162.00 + $3.00 disposal + tax', cents: 17779, stock: true },
                  { t: '1 × Mount and balance', det: 'Labour, already done', cents: 2500, labour: true },
                  { t: '1 × Tire rotation', det: 'Labour, already done', cents: 2500, labour: true },
                ]
              : returnLines
          }
          busy={saleBusy}
          error={saleError}
          onSend={preview ? () => setSheet(null) : (returned) => void refundGoods(returned)}
          onClose={endSheet}
        />
      )}
      {sale && sheet === 'void' &&
        (preview ? (
          <VoidSheet s={sale} by="Jen" manager="Luis" filled={3} onKeep={() => setSheet(null)} onVoid={() => setSheet(null)} />
        ) : (
          <VoidSheet
            s={sale}
            by={by}
            manager="A manager"
            filled={pin.length}
            busy={saleBusy}
            error={saleError}
            onDigit={digit}
            onDelete={undigit}
            onKeep={endSheet}
            onVoid={() => void act(() => merchant.voidOrder(o!.id, { pin }))}
          />
        ))}
      {sale && sheet === 'tip' &&
        (preview ? (
          <TipSheet s={sale} by="Jen" initial={1500} onSave={() => setSheet(null)} onClose={() => setSheet(null)} />
        ) : (
          <TipSheet
            s={sale}
            by={by}
            initial={authorisedCard?.tipCents ?? 0}
            busy={saleBusy}
            error={saleError}
            onSave={(tipCents) => void act(() => merchant.adjustTip(authorisedCard!.id, { tipCents }))}
            onClose={endSheet}
          />
        ))}
      {pinFor && sale && (
        <ManagerPinSheet
          title="A manager approves this refund"
          body={<>Nothing goes back to the customer until a manager or the owner approves. {sale.name} · {usd(sale.totalCents)}</>}
          filled={pin.length}
          busy={saleBusy}
          error={saleError}
          onDigit={digit}
          onDelete={undigit}
          onCancel={endSheet}
          onApprove={() => void act(async () => {
            for (const refundId of pinFor) await merchant.decideRefund(refundId, { decision: 'approve', pin });
          })}
        />
      )}
    </>
  );

  return (
    <div className="c-app c-mc-tablet c-mc-page">
      {phone ? (
        <PhoneBack back title={title} onExit={back} />
      ) : (
        <FlowTop back title={title} onExit={back} onShift={preview && screen === 'counter' ? 'Jen R.' : me} onChangeShift={shift.changeShift} />
      )}
      <div className={cx('c-slab', one && 'c-one')}>{cells}</div>
      {sheets}
    </div>
  );
}
