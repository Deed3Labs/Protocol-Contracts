import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { track } from '@/lib/analytics';
import {
  approveCharge,
  declineCharge,
  getCharge,
  getCredit,
  releasePayNow,
  type ChargeView,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useInstallMode } from '@/hooks/useInstallMode';
import { usePayNow, type PayNowStep } from '@/hooks/usePayNow';
import { ClearBalancesProvider, useClearBalances } from '@/hooks/useClearBalances';
import { BridgeProvider } from '@/context/BridgeContext';
import { KycProvider } from '@/context/KycContext';
import { LinkedWalletsProvider } from '@/context/LinkedWalletsContext';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';
import { getNetworkByChainId } from '@/config/networks';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { PAY_OVER_TIME_MIN_CENTS, shopSlug, splitsOffered } from '@clear/domain';
import ChargeApproval, { type PayMode } from './ChargeApproval';

/**
 * `/c/<code>` — the link in the text a member gets when a merchant raises a charge.
 *
 * The code identifies the charge and nothing more. It travels by text and text gets forwarded, so
 * the server re-checks on every call that the charge belongs to the caller's own wallet; a member
 * who opens somebody else's link gets a 404-shaped answer rather than a screen.
 *
 * Approving is the only thing here that costs anything, and it is deliberately not optimistic. The
 * screen waits for the chain call, because a confirmation shown before the plan exists is a
 * promise the app cannot keep — and the reference's own line, "nothing is charged until you
 * approve", cuts both ways.
 */
/** The splits the approval screen offers, when the charge is big enough to split at all. */
const SPLITS = [1, 2, 4, 12];

/**
 * What paying now needs around it: the member's balances, and Add money for when they are short.
 *
 * This route renders outside AppShell (a scanned link must open without the app's chrome), so it
 * brings the few providers those need itself, rather than sending somebody standing at a counter
 * away from the charge to add money.
 */
function PayNowProviders({ children }: { children: ReactNode }) {
  return (
    <BridgeProvider>
      <KycProvider>
        <ClearBalancesProvider>
          <LinkedWalletsProvider>{children}</LinkedWalletsProvider>
        </ClearBalancesProvider>
      </KycProvider>
    </BridgeProvider>
  );
}

const PAYING: Record<PayNowStep, string> = { 1: 'Confirm with Face ID…', 2: 'Paying…', 3: 'Checking…' };

export default function ChargeApprovalRoute() {
  return (
    <PayNowProviders>
      <ChargeApprovalScreen />
    </PayNowProviders>
  );
}

function ChargeApprovalScreen() {
  const { code = '' } = useParams<{ code: string }>();
  const { isAuthenticated, address } = useAppKitAuth();
  const { memberStatus, loaded: profileLoaded } = useMemberProfile();
  const installMode = useInstallMode();
  const navigate = useNavigate();
  const location = useLocation();

  const [charge, setCharge] = useState<ChargeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [splitInto, setSplitInto] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perCycleLimit, setPerCycleLimit] = useState<number | null>(null);
  const [mode, setMode] = useState<PayMode>('choose');
  const [paying, setPaying] = useState<PayNowStep | null>(null);
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const payNow = usePayNow();
  const { cash, loading: balancesLoading, applyOptimistic } = useClearBalances();

  useEffect(() => {
    if (!isAuthenticated) {
      // Signing in is the gate, not the code. Coming back here afterwards is the whole point of
      // the link, so the destination rides along in `state.from` — the same shape ProtectedRoute
      // uses and the only one LoginPage reads. A `?next=` here would be silently ignored and drop
      // somebody on the home screen wondering where their charge went.
      navigate('/login', { state: { from: location }, replace: true });
      return;
    }
    /**
     * Wait for the profile before reading the charge.
     *
     * `memberStatus` is null while it loads, and reading the charge first would render the
     * approval screen to somebody who is not a member yet -- then yank it away a beat later when
     * the status lands. Opening a charge also claims it, so this is a screen with a side effect;
     * it should happen once, after there is enough known to say where it belongs.
     */
    if (!profileLoaded) return;

    let cancelled = false;
    void getCharge(code)
      .then((found) => {
        if (cancelled) return;

        /**
         * Scanned by somebody who is not a member yet — merchant reference section 03.
         *
         * "Scanning installs the app and starts signup with this charge already waiting." Signing
         * in creates a Privy account, which is not the same as being a member: no region check, no
         * terms, no credit. Landing them on an approval screen they cannot act on is the worst
         * version of this, because a writer has already turned the tablet toward them and said it
         * is waiting.
         *
         * So they go to the counter flow — the one built for signing up while standing at a shop —
         * and the code rides along so approval is where they finish rather than something they
         * have to find again.
         */
        if (found && memberStatus === 'ONBOARDING') {
          const params = new URLSearchParams({ c: code });
          // `?total=` is display only on the counter flow, and it is dollars there.
          if (found.amountCents) params.set('total', String(found.amountCents / 100));
          navigate(`/s/${shopSlug(found.merchantName ?? 'clear')}?${params}`, { replace: true });
          return;
        }

        setCharge(found);
        if (found?.splitInto) setSplitInto(found.splitInto);
        // Came back to a charge held for paying now (a reload mid-payment): that is where it was.
        if (found?.payingNow) setMode('now');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, isAuthenticated, memberStatus, profileLoaded, navigate, location]);

  /**
   * The limit shown on the footer — the one this decision is checked against.
   *
   * The term ceiling, not the revolving tiers. TermIssuer.openPlan measures a new plan against
   * `termLimitOf(member)`, and the contract is explicit that this is a separate line: underwritten
   * off-chain against attested income, where the tiers are backed by pledged collateral. Summing
   * the tiers here quoted a member $747.59 of room on a line the plan cannot draw on, and the
   * approval then reverted with a ceiling of zero.
   *
   * Left null when the read fails. "Not set" is the honest thing to show when we could not ask — a
   * number invented here would be sitting next to a decision somebody is about to make.
   */
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getCredit(address).then((credit) => {
      if (cancelled || !credit?.term) return;
      setPerCycleLimit(credit.term.availableCents / 100);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const amount = useMemo(() => (charge ? charge.amountCents / 100 : 0), [charge]);
  // Under the pay-over-time minimum a charge is paid now: over time is shown greyed, with the reason.
  const splitOptions = useMemo(() => (charge ? splitsOffered(charge.amountCents, SPLITS) : SPLITS), [charge]);
  const payNowOnly = splitOptions.length === 1;
  useEffect(() => {
    if (payNowOnly) setSplitInto(1);
  }, [payNowOnly]);

  /**
   * A payment on its way: asked again every few seconds until the server has seen it land. The
   * server marks it paid on its own (its reconciliation finds it), so this is only the screen
   * catching up, never the thing that makes it true.
   */
  const onItsWay = charge?.status === 'resolving' && Boolean(charge.payingNow?.sent);
  useEffect(() => {
    if (!onItsWay) return;
    const timer = setInterval(() => {
      void getCharge(code).then((next) => {
        if (next && next.status !== 'resolving') setCharge(next);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [onItsWay, code]);

  const onPayNow = useCallback(async () => {
    if (!charge) return;
    setError(null);
    const result = await payNow(charge.code, setPaying);
    setPaying(null);
    if (result.charge) setCharge(result.charge);
    if (result.error) setError(result.error);
    if (result.charge?.paidNow || result.pending) {
      applyOptimistic(-charge.amountCents / 100, 0);
      track('charge_paid_now', {}); // no amount and no merchant
    }
  }, [charge, payNow, applyOptimistic]);

  /**
   * Back from Pay now. If Pay was pressed and nothing left the wallet, the server is still holding
   * the charge for it: let it go, so over time (or the shop) can act on it again.
   */
  const onModeChange = useCallback(
    (next: PayMode) => {
      setError(null);
      setMode(next);
      if (next !== 'now' && charge?.status === 'resolving' && charge.payingNow && !charge.payingNow.sent) {
        void releasePayNow(charge.code).then((r) => r.charge && setCharge(r.charge));
      }
    },
    [charge],
  );

  const onApprove = useCallback(async () => {
    if (!charge) return;
    setBusy(true);
    setError(null);
    const result = await approveCharge(charge.code, splitInto);
    setBusy(false);
    if (result.error || !result.charge) {
      setError(result.error ?? 'We could not approve this charge.');
      return;
    }
    setCharge(result.charge);
    track('charge_approved', { installments: splitInto }); // split only, no amount and no merchant
  }, [charge, splitInto]);

  const onDecline = useCallback(async () => {
    if (!charge) return;
    setBusy(true);
    setError(null);
    const result = await declineCharge(charge.code);
    setBusy(false);
    if (result.error || !result.charge) {
      setError(result.error ?? 'We could not decline this charge.');
      return;
    }
    track('charge_declined', {});
    navigate('/', { replace: true });
  }, [charge, navigate]);

  /**
   * Hold until the profile has answered, because the answer decides whose screen this is.
   *
   * Rendering first would show a non-member an approval they cannot give and then pull it away a
   * beat later. `loaded` rather than `memberStatus !== null`: a failed read has also answered, and
   * gating on the status would park an existing member on a spinner for as long as the API is
   * unhappy.
   */
  if (loading || (isAuthenticated && !profileLoaded)) {
    return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>;
  }

  if (!charge) {
    return (
      <div className="w-full px-5 py-8 lg:mx-auto lg:max-w-[420px] text-center">
        <p className="mb-1.5 text-[19px] font-medium">Nothing to approve</p>
        <p className="text-[13px] leading-relaxed text-foreground-secondary">
          This charge has already been dealt with, or it was never yours.
        </p>
      </div>
    );
  }

  // Every state that is not "waiting on you" says which one it is. A single "unavailable" would
  // leave somebody unsure whether they had already paid. Held for paying now is still theirs.
  const heldForThem = charge.status === 'resolving' && Boolean(charge.payingNow);
  if (charge.status !== 'pending' && charge.status !== 'approved' && !heldForThem) {
    const explain =
      charge.status === 'expired'
        ? 'This charge expired. Ask the shop to send a new one — nothing was charged.'
        : charge.status === 'declined'
          ? 'You declined this charge. Nothing was charged.'
          : 'This one is still going through. Give it a moment before trying again.';
    return (
      <div className="w-full px-5 py-8 lg:mx-auto lg:max-w-[420px] text-center">
        <p className="mb-1.5 text-[19px] font-medium">{charge.merchantName}</p>
        <p className="text-[13px] leading-relaxed text-foreground-secondary">{explain}</p>
      </div>
    );
  }

  const explorer = getNetworkByChainId(ACTIVE_CHAIN_ID)?.blockExplorer;
  const paidNow = charge.status === 'approved' && charge.paidNow;

  return (
    <>
    <ChargeApproval
      merchantName={charge.merchantName}
      amount={amount}
      raisedBy={charge.raisedBy}
      raisedAt={charge.createdAt}
      items={charge.items}
      taxCents={charge.taxCents}
      discountCents={charge.discountCents}
      mode={mode}
      onModeChange={onModeChange}
      overTimeMinimum={payNowOnly ? PAY_OVER_TIME_MIN_CENTS / 100 : null}
      readyToAllocate={balancesLoading ? null : cash}
      spendable={null}
      onPayNow={onPayNow}
      payingLabel={paying ? PAYING[paying] : null}
      onAddMoney={() => setAddMoneyOpen(true)}
      paid={
        paidNow
          ? {
              at: charge.paidAt ?? null,
              left: balancesLoading ? null : Math.max(0, cash),
              receiptUrl: explorer && charge.txHash ? `${explorer}/tx/${charge.txHash}` : null,
            }
          : null
      }
      onItsWay={onItsWay}
      onDone={() => navigate('/', { replace: true })}
      splitInto={charge.splitInto ?? splitInto}
      onSplitChange={setSplitInto}
      splitOptions={splitOptions}
      perCycleLimit={perCycleLimit}
      doneBy={(n) => `${n} cycle${n === 1 ? '' : 's'} from now`}
      busy={busy}
      error={error}
      onApprove={onApprove}
      onDecline={onDecline}
      approved={charge.status === 'approved' && !charge.paidNow}
      /*
       * Only on iOS, and only outside the installed app.
       *
       * That is the one combination the platform strands: Android hands a scanned link to the
       * installed PWA, and inside the app there is nowhere to hand off to. On Android without the
       * app the useful offer is to install it, which is not this line's job.
       */
      appHandoffCode={installMode === 'ios' ? charge.code : null}
    />
    <AddMoneyModal open={addMoneyOpen} onOpenChange={setAddMoneyOpen} />
    </>
  );
}
