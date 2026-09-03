import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { track } from '@/lib/analytics';
import {
  acceptMemberTerms,
  bootstrapMemberAccount,
  getCredit,
  getServedZipPrefixes,
  submitMemberOnboarding,
  updateMemberOnboarding,
  updateMemberProfile,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { isServed } from '@/lib/servedRegion';
import { runPlaidLink } from '@/lib/plaidLink';
import { claimInstallUi, promptInstall } from '@/lib/installPrompt';
import { parsePendingTotal, shopDisplayName } from '@/lib/counterCode';
import { useInstallMode } from '@/hooks/useInstallMode';
import CounterOnboarding, {
  type CounterStep,
  type CounterValues,
} from './CounterOnboarding';
import OnboardingFlow from './OnboardingFlow';

/**
 * The counter entry: signing up while standing at a shop, with the submit chain behind it.
 *
 * The sibling of `OnboardingRoute`, not a mode of it. It starts at `scan` rather than `join`
 * because nobody here has signed in yet — a member arrives by pointing a camera at a code, which
 * is the opposite of arriving through a login gate — and it ends at a split choice rather than at
 * saving, because there is a bill on the counter.
 *
 * ## Where the pending total comes from
 *
 * The plan left this open (§6.3): the reference shows the total on every step and does not say
 * where it came from. It is read from the code, and it is **display only**.
 *
 * That is a deliberately narrow claim. A number in a URL is written by whoever wrote the URL, so
 * it can motivate a signup and it must never authorize a debt. Nothing here creates a plan from
 * it: the amount is shown, and the only figure this route treats as true is the credit line it
 * reads back from the contracts after submitting. The reference's own charge link is
 * `clear.coop/c/8QK2` — an opaque code, not an amount — which is the shape the binding number
 * takes at approval, and that screen is Phase C. When it exists, this reads the total from it and
 * the query parameter becomes the fallback for a printed sticker rather than the source.
 */

export default function CounterOnboardingRoute() {
  const { shop = '' } = useParams<{ shop: string }>();
  const [params] = useSearchParams();
  const { isAuthenticated, address, openModal } = useAppKitAuth();
  const navigate = useNavigate();
  const installMode = useInstallMode();

  const [step, setStep] = useState<CounterStep>('scan');
  const [values, setValues] = useState<CounterValues>({ phone: '', zip: '', splitInto: 4 });
  const [servedPrefixes, setServedPrefixes] = useState<string[] | null>(null);
  const [bankLinked, setBankLinked] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedCents, setApprovedCents] = useState<number | null>(null);
  const [unserved, setUnserved] = useState(false);
  // Set when `join` sent them to sign in, so the effect below knows the flow is waiting on it
  // rather than the member simply having been signed in all along.
  const awaitingAuth = useRef(false);
  // Whether the submit chain has actually come back. Not derived from the step: the point is to
  // catch the case where it did not, and the step advances for other reasons.
  const submitted = useRef(false);

  const amount = useMemo(() => parsePendingTotal(params.get('total')), [params]);
  const merchant = useMemo(() => shopDisplayName(shop), [shop]);
  const inviteCode = useMemo(() => shop.toUpperCase(), [shop]);
  const shopUrl = `clear.coop/${shop}`;

  // The first-visit takeover would otherwise land on top of step one of five, which is the worst
  // moment in the product to interrupt. It stands down while this flow owns the ask.
  useEffect(() => claimInstallUi(), []);

  useEffect(() => {
    let cancelled = false;
    void getServedZipPrefixes().then((prefixes) => {
      if (!cancelled) setServedPrefixes(prefixes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    track('counter_onboarding_started', { hasTotal: amount != null }); // no shop, no amount: no PII
  }, [amount]);

  const onValuesChange = useCallback((patch: Partial<CounterValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
  }, []);

  /**
   * Everything the counter path knows, sent once.
   *
   * The same chain the direct path runs, differing in the three things the entry actually decides:
   * where they came from, the shop's code, and that a counter member gave a phone rather than an
   * email. The other ten fields are defaults for the same reasons documented on the direct route.
   */
  const submit = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const bootstrapped = await bootstrapMemberAccount();
      if (!bootstrapped) throw new Error("We couldn't create your member record.");

      const onboarding = await updateMemberOnboarding({
        currentStep: 'discovery',
        accessTrack: 'hybrid',
        accountMethod: 'appkit-account',
        identityModeSelected: 'privacy',
        // The branch itself is the answer -- arriving through a shop's code rather than a site.
        // This is the field the reference's branch table is describing.
        referralSource: 'counter',
        // Pre-filled from the shop's code. The member never types it, and shouldn't have to.
        inviteCode: inviteCode || null,
        incomeSource: '',
        reasons: [],
        goalsNote: null,
        recoveryMethod: 'passkey',
        residencyCountry: 'US',
        settlementCurrency: 'USD',
        membershipPlan: 'YEARLY',
        cardWaitlist: false,
        localPools: false,
      });
      if (!onboarding) throw new Error("We couldn't save your onboarding preferences.");

      const profile = await updateMemberProfile({
        displayName: null,
        legalName: null,
        // No email at a counter -- the reference collects phone, ZIP and the shop's code, and
        // nothing else. Sending an empty string would overwrite whatever sign-in supplied.
        email: null,
        phone: values.phone.trim() || null,
        cityRegion: '',
        residencyCountry: 'US',
        settlementCurrency: 'USD',
        notificationsOptIn: true,
      });
      if (!profile) throw new Error("We couldn't save your profile details.");

      const terms = await acceptMemberTerms('membership_terms', '2026-03');
      if (!terms) throw new Error("We couldn't record your terms acceptance.");

      const account = await submitMemberOnboarding();
      if (!account) throw new Error("We couldn't complete onboarding.");

      submitted.current = true;
      track('onboarding_completed', { access: 'hybrid', entry: 'counter' });
      window.dispatchEvent(new Event('wallet-connected'));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't finish onboarding.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [inviteCode, values.phone]);

  /**
   * What the line actually covers, read back from the contracts that hold it.
   *
   * Left null on a failed read rather than set to zero. `getCredit` returns null when the chain
   * could not be read, and a member whose RPC blipped has not been declined -- the screen falls
   * back to the amount on the code rather than telling them they were approved for nothing.
   */
  const readApproved = useCallback(async () => {
    if (!address) return;
    const credit = await getCredit(address);
    if (!credit) return;
    const available = credit.tiers
      .filter((tier) => tier.active)
      .reduce((sum, tier) => sum + Math.max(0, tier.limitCents - tier.usedCents), 0);
    setApprovedCents(available);
  }, [address]);

  /** Linked or deliberately skipped, the member is joining. What differs is what they leave with. */
  const finish = useCallback(
    async (linked: boolean) => {
      // Idempotent so a retry after a failed submit does not re-run a chain that half-succeeded.
      const ok = submitted.current || (await submit());
      if (!ok) return;
      if (!linked) {
        // Required for the plan, not for the membership (§6.4). Day one leads with saving, the
        // plan is locked, and the shop was told nothing was approved -- which is what happened.
        navigate('/', { replace: true });
        return;
      }
      await readApproved();
      setStep('choose');
    },
    [submit, navigate, readApproved],
  );

  const connectBank = useCallback(async () => {
    if (!address) {
      setLinkError('Sign in first so we can connect the right account.');
      return;
    }
    setLinking(true);
    setLinkError(null);
    try {
      const linked = await runPlaidLink(address);
      // False is an exit, not a failure: they closed the window. Leave the step as it was so the
      // button still says "Connect securely" rather than reporting an error they did not hit.
      if (!linked) return;
      setBankLinked(true);
      await finish(true);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "We couldn't connect your bank.");
    } finally {
      setLinking(false);
    }
  }, [address, finish]);

  const install = useMemo(
    () => ({
      mode: installMode,
      onInstall: () => {
        // Only Chromium has anything to press. On iOS and on desktop the button moves them on,
        // because the instructions are the step and a button that cannot install should not claim
        // to -- see `installActionLabel`.
        if (installMode === 'prompt') void promptInstall().finally(() => setStep('enter'));
        else setStep('enter');
      },
    }),
    [installMode],
  );

  /**
   * Leaving `join` is where the counter path decides two things at once: whether the co-op serves
   * them, and whether they have an account yet.
   */
  const onStepChange = useCallback(
    (next: CounterStep) => {
      if (busy) return;

      // The link step's own button advances when an account is already connected -- but a submit
      // that failed leaves them connected and *not* a member, and walking on from there would put
      // somebody on the split screen with no member record behind it. Retry instead of advancing.
      if (step === 'link' && next === 'choose' && !submitted.current) {
        void finish(bankLinked);
        return;
      }

      if (step === 'join' && next === 'link') {
        // Only diverts on a definite no. Not knowing where the co-op serves is not the same as it
        // serving nowhere, and a member standing in the region is the worse one to turn away.
        if (values.zip && isServed(values.zip, servedPrefixes) === false) {
          setUnserved(true);
          return;
        }
        if (!isAuthenticated) {
          // "Agree & join" is where an account starts existing, so this is where signing in
          // belongs. Privy's modal opens over the flow rather than navigating away -- a redirect
          // here would drop somebody three steps into a five-step flow at a counter.
          awaitingAuth.current = true;
          void openModal();
          return;
        }
      }

      setStep(next);
    },
    [busy, step, values.zip, servedPrefixes, isAuthenticated, openModal, finish, bankLinked],
  );

  // Signing in happens in a modal, so the flow resumes by watching for it rather than by a return
  // navigation. Guarded on the ref so an already-signed-in member is not pushed forward on mount.
  useEffect(() => {
    if (isAuthenticated && awaitingAuth.current) {
      awaitingAuth.current = false;
      setStep('link');
    }
  }, [isAuthenticated]);

  if (unserved) {
    // One waitlist, two ways in. A ZIP that is unserved should reach the same screen whichever
    // entry found it, and the counter path has no waitlist step of its own by design.
    return <OnboardingFlow step="waitlist" values={{ contact: '', code: '', zip: values.zip, invite: '', email: '' }} />;
  }

  return (
    <>
      <CounterOnboarding
        step={step}
        onStepChange={onStepChange}
        values={values}
        onValuesChange={onValuesChange}
        merchant={merchant}
        amount={amount}
        shopUrl={shopUrl}
        inviteCode={inviteCode}
        install={install}
        bank={{
          linked: bankLinked,
          busy: linking,
          error: linkError,
          onConnect: connectBank,
          onSkip: () => void finish(false),
        }}
        approvedCents={approvedCents}
        busy={busy}
      />
      {error && (
        <p className="fixed inset-x-0 bottom-4 mx-auto max-w-sm rounded-lg bg-negative/10 px-4 py-2 text-center text-[13px] text-negative">
          {error}
        </p>
      )}
    </>
  );
}
