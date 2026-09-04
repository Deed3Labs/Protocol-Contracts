import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { track } from '@/lib/analytics';
import {
  approveCharge,
  declineCharge,
  getCharge,
  getCredit,
  type ChargeView,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useInstallMode } from '@/hooks/useInstallMode';
import { shopSlug } from '@clear/domain';
import ChargeApproval from './ChargeApproval';

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
export default function ChargeApprovalRoute() {
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
  // leave somebody unsure whether they had already paid.
  if (charge.status !== 'pending' && charge.status !== 'approved') {
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

  return (
    <ChargeApproval
      merchantName={charge.merchantName}
      amount={amount}
      splitInto={charge.splitInto ?? splitInto}
      onSplitChange={setSplitInto}
      perCycleLimit={perCycleLimit}
      doneBy={(n) => `${n} cycle${n === 1 ? '' : 's'} from now`}
      busy={busy}
      error={error}
      onApprove={onApprove}
      onDecline={onDecline}
      onBack={() => navigate('/')}
      approved={charge.status === 'approved'}
      /*
       * Only on iOS, and only outside the installed app.
       *
       * That is the one combination the platform strands: Android hands a scanned link to the
       * installed PWA, and inside the app there is nowhere to hand off to. On Android without the
       * app the useful offer is to install it, which is not this line's job.
       */
      appHandoffCode={installMode === 'ios' ? charge.code : null}
    />
  );
}
