import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import { PreviewBalancesProvider } from '@/hooks/useClearBalances';
import { PreviewIdentityProvider } from '@/context/IdentityContext';
import AppChrome from '@/components/shell/AppChrome';
import CycleCard from '@/components/clear/CycleCard';
import RepayDialog from '@/components/clear/RepayDialog';
import TermPlansCard from '@/components/clear/TermPlansCard';
import { Button } from '@/components/ui/button';
import HeaderActions from '@/components/shell/HeaderActions';
import { unreadThreads } from '@/lib/clearModel';
import HomePage from '@/pages/app/HomePage';
import SavingsPage from '@/pages/app/SavingsPage';
import ActivityPage from '@/pages/app/ActivityPage';
import CardPage from '@/pages/app/CardPage';
import SplashScreen from '@/components/SplashScreen';
import AssurancePage from '@/pages/app/AssurancePage';
import InboxPage from '@/pages/app/InboxPage';
import ScanPage from '@/pages/app/ScanPage';
import CodePage from '@/pages/app/CodePage';
import ExplainerPage from '@/pages/app/ExplainerPage';
import PartnersPage from '@/pages/app/PartnersPage';
import SendPage from '@/pages/app/SendPage';
import EarnPage from '@/pages/app/EarnPage';
import SettingsPage from '@/pages/app/SettingsPage';
import { EMPTY_ADDRESS, type MailingAddress } from '@/hooks/useMemberProfile';
import OnboardingFlow, { type OnboardingStep } from '@/pages/auth/OnboardingFlow';
import CounterOnboarding, { COUNTER_STEPS, type CounterStep } from '@/pages/auth/CounterOnboarding';
import { useInstallMode } from '@/hooks/useInstallMode';
import ChargeApproval from '@/pages/app/ChargeApproval';
import MoveMoneyDialog, { type MoveDirection } from '@/components/clear/MoveMoneyDialog';
import {
  HOME_IN_USE,
  HOME_DAY_ONE,
  HOME_DAY_ONE_COUNTER,
  SAVINGS_IN_USE,
  SAVINGS_DAY_ONE,
  ACTIVITY_IN_USE,
  ACTIVITY_DAY_ONE,
  CARD_IN_USE,
  CARD_DAY_ONE,
  SEND_IN_USE,
  SEND_DAY_ONE,
  CONTACTS,
  ALERTS,
  INBOX,
  SETTINGS,
  EARN_IN_USE,
  EARN_DAY_ONE,
} from '@/data/clearPlaceholder';

/**
 * Dev-only visual harness for the member-app rebuild.
 *
 * The real app mounts behind AppKitProvider + ProtectedRoute, so it can't render
 * without a wallet — which makes the shell and pages impossible to look at while
 * building them. This mounts AppChrome and the pages directly, with no providers
 * and no auth. Reach it at `/?preview=1` in dev; it is never bundled in prod
 * (main.tsx only imports it under `import.meta.env.DEV`).
 *
 * Pages are built presentational-first against placeholder data, so what renders
 * here is what renders in the app once the data is wired. The toggle switches
 * every page between its populated and empty states.
 */

const ONBOARDING_STEPS: OnboardingStep[] = [
  'enter',
  'verify',
  'welcome',
  'recovery',
  'join',
  'identity',
  'waitlist',
  'claim',
  'claimJoin',
];

/**
 * The cycle's four states — the harness equivalent of the reference's own screen.
 *
 * Home only ever shows whichever state that member is in, and the placeholder member is drawn and
 * short, so the other three would otherwise be unreachable to look at.
 */
function CyclePreview() {
  const { cycle, credit, cashAccount } = HOME_IN_USE;
  const setUsed = (key: string, used: number) => ({
    ...credit,
    tiers: credit.tiers.map((t) => (t.key === key ? { ...t, used } : t)),
  });
  const states = [
    { name: 'unsecured, deposit short', credit, deposit: cashAccount.nextDepositEstimate },
    { name: 'unsecured, deposit covers', credit, deposit: 2000 },
    { name: 'own savings, nothing owed', credit: setUsed('income', 0), deposit: 2000 },
    {
      name: 'all clear',
      credit: { ...credit, tiers: credit.tiers.map((t) => ({ ...t, used: 0 })) },
      deposit: 2000,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {states.map((s) => (
        <div key={s.name}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.3px] text-muted-foreground">
            {s.name}
          </p>
          <CycleCard
            cycle={cycle}
            credit={s.credit}
            expectedDeposit={s.deposit}
            depositOn={cashAccount.nextDepositOn}
            onRepay={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Repay and Move to cash — the same modal, both ways round.
 *
 * Which title it wears depends on whether a balance is in the way, and the placeholder member is
 * carrying one, so Home can only ever open it as Repay. This is the only place to see the other.
 */
function RepayPreview() {
  const { credit, cashAccount, cycle } = HOME_IN_USE;
  const [which, setWhich] = useState<'repay' | 'move' | 'over' | null>(null);
  const settled = { ...credit, tiers: credit.tiers.map((t) => ({ ...t, used: 0 })) };
  // Overpaying needs a source bigger than everything carried, which the placeholder member's $700
  // parked on-chain can't be against $6,100 drawn.
  const flush = { ...cashAccount, readyToAllocate: 7000 };

  return (
    <div className="flex flex-col items-start gap-2.5">
      <p className="text-[11px] uppercase tracking-[0.3px] text-muted-foreground">
        One modal, three shapes
      </p>
      <Button variant="clear" size="xs" onClick={() => setWhich('repay')}>
        Carrying a balance → Repay
      </Button>
      <Button variant="clear" size="xs" onClick={() => setWhich('move')}>
        Nothing outstanding → Move to cash
      </Button>
      <Button variant="clear" size="xs" onClick={() => setWhich('over')}>
        Paying past the balance → spills to Spendable
      </Button>

      <RepayDialog
        key={which ?? 'none'}
        credit={which === 'move' ? settled : credit}
        account={which === 'over' ? flush : cashAccount}
        cycle={cycle}
        open={which !== null}
        onOpenChange={(o) => !o && setWhich(null)}
      />
    </div>
  );
}

/**
 * The term-plan shelf across its three moments — the harness equivalent of the reference's own
 * section. Home only ever shows one member's shelf, and none of them is the empty one.
 */
function TermPlansPreview() {
  const joined = HOME_IN_USE.termPlans;
  // Years in: a dental split nearly done, a cash plan mid-way, and the home actually bought. Ordered
  // by how soon the member reaches them, not by size — which is why a $248k mortgage sits last.
  const later = {
    ...joined,
    plans: [
      { id: 'valley-dental', name: 'Valley Dental', openedOn: 'May', balance: 410, splitInto: 2, cyclesLeft: 1, rate: '2% / cycle', ratePerCycle: 0.02 },
      { id: 'cash-plan', name: 'Clear Cash', balance: 2500, splitInto: 12, cyclesLeft: 9, rate: '2.5% / cycle', ratePerCycle: 0.025 },
      { id: 'elpa', name: 'ELPA · 1042 Julia St', balance: 250000, perCycle: 1410, progressNote: 'payment 7 of 360' },
    ],
    // No balance cap once the mortgage is on the shelf — it was never inside one.
    balanceLimit: undefined,
  };
  const shelves = [
    {
      name: 'joined at a merchant',
      data: {
        ...joined,
        plans: [joined.plans[0], ...HOME_DAY_ONE.termPlans.plans.slice(1)],
        balanceLimit: 1500,
      },
    },
    { name: 'signed up directly — everything locked', data: HOME_DAY_ONE.termPlans },
    { name: 'later — three active plans', data: later },
  ];

  return (
    <div className="flex flex-col gap-5">
      {shelves.map((s) => (
        <div key={s.name}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.3px] text-muted-foreground">
            {s.name}
          </p>
          <div className="max-w-[400px]">
            <TermPlansCard data={s.data} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Move money, with figures supplied.
 *
 * The presentational dialog, not the connected one, and that is the point: the live component
 * reads balances from chain and shows a member with nothing exactly that. Fixtures belong here,
 * passed in explicitly by a design harness, rather than sitting behind the real component as a
 * fallback where they would eventually be shown to somebody as their own money.
 */
function MoveMoneyPreview() {
  const [direction, setDirection] = useState<MoveDirection>('deposit');
  const [empty, setEmpty] = useState(false);
  const [progress, setProgress] = useState<{ status: 'processing' | 'done' | 'failed'; step: number; failureNote?: string } | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <MoveMoneyDialog
        open
        onOpenChange={() => {}}
        direction={direction}
        onDirectionChange={setDirection}
        cashReady={empty ? 0 : 2109}
        savingsTotal={6000}
        savingsFree={3000}
        credits={1500}
        creditsGoal={15000}
        reachesGoalBy="Jan 2028"
        goalShift="2 later"
        progress={progress}
        onMove={() => {}}
      />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        {([
          ['moving', { status: 'processing' as const, step: 1 }],
          ['done', { status: 'done' as const, step: 3 }],
          ['failed', { status: 'failed' as const, step: 1, failureNote: 'the network was busy' }],
          ['form', null],
        ] as const).map(([label, next]) => (
          <button
            key={label}
            type="button"
            onClick={() => setProgress(next)}
            className="rounded-md border-[0.5px] border-border px-2 py-1 text-[11px] text-muted-foreground"
          >
            {label}
          </button>
        ))}
        {([['deposit', false], ['withdraw', false], ['empty', true]] as const).map(([label, isEmpty]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setEmpty(isEmpty);
              if (!isEmpty) setDirection(label as MoveDirection);
            }}
            className="rounded-md border-[0.5px] border-border px-2 py-1 text-[11px] text-muted-foreground"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The yield pool — the same component, pointed elsewhere.
 *
 * Figures passed in explicitly, as with the savings preview: the live component reads them and
 * shows a member with nothing exactly that, so fixtures belong in the harness rather than behind
 * it. The states are the three the reference draws, including the pool being fully lent.
 */
function PoolMovePreview() {
  const [direction, setDirection] = useState<MoveDirection>('deposit');
  const [lent, setLent] = useState(false);
  // The reference's short states: carrying $11,000 against $12,300, with Ready to allocate either
  // covering the $450 gap or not.
  const [short, setShort] = useState<'no' | 'covered' | 'capped'>('no');

  return (
    <div className="min-h-screen bg-background">
      <MoveMoneyDialog
        open
        onOpenChange={() => {}}
        destination="pool"
        direction={direction}
        onDirectionChange={setDirection}
        cashReady={short === 'capped' ? 120 : 2109}
        savingsTotal={2500}
        savingsFree={short === 'no' ? 2541 : 2500}
        credits={0}
        creditsGoal={0}
        pool={{
          apyPercent: 6.8,
          haircutBps: 7_000,
          freeNow: lent ? 600 : 2541,
          utilizationBps: lent ? 7_600 : 7_400,
          limit: 12300,
          owed: short === 'no' ? 2400 : 11000,
        }}
        onMove={() => {}}
      />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        {([
          ['add', 'deposit', false, 'no'],
          ['take', 'withdraw', false, 'no'],
          ['fully lent', 'withdraw', true, 'no'],
          ['short, covered', 'withdraw', false, 'covered'],
          ['short, capped', 'withdraw', false, 'capped'],
        ] as const).map(
          ([label, dir, isLent, isShort]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setDirection(dir as MoveDirection);
                setLent(isLent);
                setShort(isShort);
              }}
              className="rounded-md border-[0.5px] border-border px-2 py-1 text-[11px] text-muted-foreground"
            >
              {label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** A bond — the same modal, one destination further, with the one exception it has to carry. */
function BondPreview() {
  const [months, setMonths] = useState(24);
  // The reference's own figures: $5,000 face at 24 months costs $4,367.19.
  const price = 4367.19;

  return (
    <div className="min-h-screen bg-background">
      <MoveMoneyDialog
        open
        onOpenChange={() => {}}
        destination="bond"
        direction="deposit"
        onDirectionChange={() => {}}
        cashReady={6200}
        savingsTotal={0}
        savingsFree={0}
        credits={0}
        creditsGoal={0}
        bond={{
          termOptions: [6, 12, 24, 36],
          months,
          onMonthsChange: setMonths,
          priceToday: price,
          maturesShort: 'Aug 2028',
          maturesLong: 'Aug 25, 2028',
          ratePercent: 7,
          haircutBps: 9_500,
          // The deployment's own limits: $100 to $1,000,000 of face value.
          minFace: 100,
          maxFace: 1_000_000,
        }}
        onMove={() => {}}
      />
    </div>
  );
}

/** A charge arriving — the approval screen and the state after it. */
function ChargeApprovalPreview() {
  const [splitInto, setSplitInto] = useState(4);
  const [approved, setApproved] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <ChargeApproval
        merchantName="Mike's Tire"
        amount={940}
        splitInto={splitInto}
        onSplitChange={setSplitInto}
        perCycleLimit={850}
        clearsFromLabel="Chase ····4471"
        firstPaymentOn="Dec 14"
        doneBy={() => 'Mar 14'}
        onApprove={() => setApproved(true)}
        onDecline={() => setApproved(false)}
        onBack={() => setApproved(false)}
        approved={approved}
      />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        {(['approve', 'approved'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setApproved(s === 'approved')}
            className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
              approved === (s === 'approved')
                ? 'border-tier-boost text-tier-boost-fg'
                : 'border-border text-muted-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The counter path — five steps, outside the app chrome like the direct one.
 *
 * Driven the way `CounterOnboardingRoute` drives it rather than on the component's own defaults,
 * so the harness shows what a member actually sees: the install mode this browser is really in,
 * and the link step's skip. A harness that renders a screen the live container never produces is
 * worse than no harness — the skip in particular is the resolution of an open question, and it
 * should be lookable-at.
 */
function CounterOnboardingPreview() {
  const [step, setStep] = useState<CounterStep>('scan');
  const [linked, setLinked] = useState(false);
  const [partial, setPartial] = useState(false);
  const installMode = useInstallMode();

  return (
    <div className="min-h-screen bg-background">
      <CounterOnboarding
        step={step}
        onStepChange={setStep}
        install={{ mode: installMode, onInstall: () => setStep('enter') }}
        bank={{
          linked,
          busy: false,
          onConnect: () => setLinked(true),
          onSkip: () => setStep('choose'),
        }}
        // Null is the real default: unchecked until the contracts have been read. The toggle below
        // shows the other branch, where the line covers less than the counter is asking for.
        approvedCents={partial ? 42_000 : null}
      />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setPartial((p) => !p)}
          className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
            partial ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
          }`}
        >
          partial
        </button>
        {COUNTER_STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
              s === step ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings, with the one row that saves something.
 *
 * Home address is editable only when a container can store it, so the harness keeps it for the
 * session — otherwise the row is an em dash nobody can open, and the dialog cannot be looked at.
 */
function SettingsPreview({ empty }: { empty: boolean }) {
  const [address, setAddress] = useState<MailingAddress>(EMPTY_ADDRESS);
  // Changing a phone number is two screens, so the harness carries the step rather than the change.
  const [stage, setStage] = useState<'enter' | 'code'>('enter');

  return (
    <SettingsPage
      contacts={empty ? [] : CONTACTS}
      available={empty ? 0 : SEND_IN_USE.available}
      address={address}
      onSaveAddress={setAddress}
      phoneChange={{
        stage,
        busy: false,
        error: null,
        onSendCode: () => setStage('code'),
        onVerify: () => setStage('enter'),
        onClose: () => setStage('enter'),
      }}
    />
  );
}

/**
 * The splash, which the app itself only shows for a few hundred milliseconds.
 *
 * Both progress states are here because they are different screens: a real bar when there is
 * something to measure, the dot and the word when there is not. The slow line appears on its own
 * after three seconds, which is also how a member meets it.
 */
function SplashPreview() {
  const [known, setKnown] = useState(false);
  const [progress, setProgress] = useState(38);

  return (
    <>
      <SplashScreen progress={known ? progress : undefined} />
      <div className="fixed inset-x-0 bottom-0 z-[10000] flex flex-wrap justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setKnown((k) => !k)}
          className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
            known ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
          }`}
        >
          {known ? 'known progress' : 'unknown progress'}
        </button>
        {known &&
          [12, 38, 74, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProgress(p)}
              className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
                p === progress ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
              }`}
            >
              {p}%
            </button>
          ))}
      </div>
    </>
  );
}

/**
 * Card, driven the way `CardRoute` drives it.
 *
 * New card is the reason: the button only appears when a container is handling it, and the sheet's
 * last step needs a card to have been made. The harness makes one up so all three steps can be
 * looked at, with an address on file so the physical branch is not stuck on its first screen.
 */
function CardPreview({ empty, many }: { empty: boolean; many: boolean }) {
  const [newCard, setNewCard] = useState<{ kind: 'virtual' | 'physical'; last4: string; label?: string } | null>(null);
  const base = empty ? CARD_DAY_ONE : CARD_IN_USE;
  const data = many
    ? {
        ...base,
        cards: [
          ...(base.cards ?? []),
          { id: 'v2', variant: 'virtual' as const, last4: '5507', frozen: false, where: 'subscriptions' },
          { id: 'v3', variant: 'virtual' as const, last4: '2291', frozen: false, where: 'online' },
          { id: 'v4', variant: 'virtual' as const, last4: '8691', frozen: true, where: 'Apple Pay' },
        ],
      }
    : base;

  return (
    <CardPage
      key={String(empty) + String(many)}
      data={data}
      onAddCard={(kind, label) => setNewCard({ kind, last4: kind === 'virtual' ? '5507' : '4102', label })}
      newCard={newCard}
      onNewCardDone={() => setNewCard(null)}
      address={{ name: 'Kai Moore', lines: '1420 Orange St, Redlands, CA 92374' }}
      /*
       * A session the issuer will never honour, so the sheet can be looked at in both of its
       * states: the rows with their frames mounting, and the fallback it takes when they do not
       * arrive. The real one comes from the server and is exchanged by the SDK.
       */
      onRevealDetails={async () => ({ session: { session: 'preview', environment: 'sandbox' as const } })}
    />
  );
}

/** A wallet of five, because a stack of two hides everything a stack of five gets wrong. */
function CardPreviewFrame({ empty }: { empty: boolean }) {
  const [many, setMany] = useState(false);
  return (
    <>
      <CardPreview empty={empty} many={many} />
      <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setMany((m) => !m)}
          className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
            many ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
          }`}
        >
          5 cards
        </button>
      </div>
    </>
  );
}

/** Onboarding sits outside the app chrome — there's no nav until you're a member. */
function OnboardingPreview() {
  const [step, setStep] = useState<OnboardingStep>('enter');
  // A code that failed is the same screen with a reason on it, so the harness can produce one.
  const [failed, setFailed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <OnboardingFlow
        step={step}
        onStepChange={setStep}
        member={{ name: 'Kai Moore', handle: '@kaim' }}
        auth={{
          busy: false,
          error: failed ? 'Expired · sent again just now' : null,
          resendIn: 24,
          onContinue: () => setStep('verify'),
          onOAuth: () => setStep('verify'),
          onSubmitCode: () => setStep('join'),
          onResend: () => setFailed(false),
          onPasskey: () => setStep('join'),
        }}
      />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setFailed((f) => !f)}
          className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
            failed ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
          }`}
        >
          bad code
        </button>
        {ONBOARDING_STEPS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={`rounded-md border-[0.5px] px-2 py-1 text-[11px] ${
              s === step ? 'border-tier-boost text-tier-boost-fg' : 'border-border text-muted-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The header, with the notification panel's own state behind it.
 *
 * Read and Clear are the panel's whole point, so the harness holds a copy of the list to act on —
 * the live app dismisses them through the notifications context instead.
 */
function PreviewHeaderActions({ empty }: { empty: boolean }) {
  const [notifications, setNotifications] = useState(() =>
    ALERTS.map((a) => ({
      id: a.id,
      title: a.title,
      detail: a.detail,
      time: a.time,
      unread: !a.read,
      ...(a.action ? { action: a.action } : {}),
    })),
  );
  const shown = empty ? [] : notifications;

  return (
    <HeaderActions
      profile={SETTINGS.profile}
      unread={empty ? 0 : shown.filter((n) => n.unread).length + unreadThreads(INBOX.threads)}
      accelerationActive={SETTINGS.accelerationActive}
      notifications={shown}
      onMarkAllRead={() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))}
      onRead={(id) => setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, unread: false } : n)))}
      onClear={(id) => setNotifications((prev) => prev.filter((n) => n.id !== id))}
      onClearAll={() => setNotifications([])}
    />
  );
}

export default function PreviewApp() {
  const [empty, setEmpty] = useState(false);

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <PreviewBalancesProvider>
          <PreviewIdentityProvider>
            <Routes>
              <Route path="/splash" element={<SplashPreview />} />
              <Route path="/onboarding" element={<OnboardingPreview />} />
              <Route path="/onboarding-counter" element={<CounterOnboardingPreview />} />
              <Route path="/charge" element={<ChargeApprovalPreview />} />
              <Route path="/move-money" element={<MoveMoneyPreview />} />
              <Route path="/pool" element={<PoolMovePreview />} />
              <Route path="/bond" element={<BondPreview />} />

              <Route
                path="*"
                element={
                  <>
                    <AppChrome
                      trailing={
                        <PreviewHeaderActions empty={empty} />
                      }
                    >
                      <Routes>
                        <Route path="/" element={<HomePage data={empty ? HOME_DAY_ONE : HOME_IN_USE} />} />
                        {/* Day one has two arrivals; the toggle only reaches the direct one. */}
                        <Route path="/day-one-counter" element={<HomePage data={HOME_DAY_ONE_COUNTER} />} />
                        {/* All clear: nothing carried, nothing owed, nothing prompting — the slot drops out. */}
                        <Route
                          path="/all-clear"
                          element={
                            <HomePage
                              data={{
                                ...HOME_IN_USE,
                                // The reference's all-clear member: cash in hand, nothing parked, and
                                // only the locked ELPA left on the shelf.
                                cash: 2000,
                                cashAccount: { ...HOME_IN_USE.cashAccount, spendable: 2000, readyToAllocate: 0 },
                                termPlans: {
                                  ...HOME_IN_USE.termPlans,
                                  plans: HOME_IN_USE.termPlans.plans.filter((p) => p.balance === undefined),
                                },
                                credit: {
                                  ...HOME_IN_USE.credit,
                                  carryCost: 0,
                                  tiers: HOME_IN_USE.credit.tiers.map((t) => ({ ...t, used: 0 })),
                                },
                                tasks: HOME_IN_USE.tasks.map((t) => ({ ...t, done: true })),
                              }}
                            />
                          }
                        />
                        <Route path="/savings" element={<SavingsPage data={empty ? SAVINGS_DAY_ONE : SAVINGS_IN_USE} />} />
                        <Route path="/earn" element={<EarnPage data={empty ? EARN_DAY_ONE : EARN_IN_USE} />} />
                        <Route path="/send" element={<SendPage key={String(empty)} data={empty ? SEND_DAY_ONE : SEND_IN_USE} />} />
                        <Route path="/activity" element={<ActivityPage key={String(empty)} data={empty ? ACTIVITY_DAY_ONE : ACTIVITY_IN_USE} email="kai@example.com" />} />
                        <Route path="/card" element={<CardPreviewFrame empty={empty} />} />
                        <Route path="/contacts" element={<Navigate to="/settings/contacts" replace />} />
                        <Route path="/partners" element={<PartnersPage />} />
                        <Route
                          path="/assurance"
                          element={<AssurancePage data={empty ? SAVINGS_DAY_ONE : SAVINGS_IN_USE} />}
                        />
                        <Route
                          path="/inbox"
                          element={
                            <InboxPage
                              key={String(empty)}
                              data={empty ? { threads: [], messages: {} } : INBOX}
                              contacts={empty ? [] : CONTACTS}
                            />
                          }
                        />
                        <Route
                          path="/inbox/:threadId"
                          element={
                            <InboxPage
                              key={String(empty)}
                              data={empty ? { threads: [], messages: {} } : INBOX}
                              contacts={empty ? [] : CONTACTS}
                            />
                          }
                        />
                        <Route path="/alerts" element={<Navigate to="/inbox" replace />} />
                        <Route path="/scan" element={<ScanPage />} />
                        <Route path="/code" element={<CodePage data={empty ? SEND_DAY_ONE : SEND_IN_USE} />} />
                        <Route path="/cycle" element={<CyclePreview />} />
                        <Route path="/repay" element={<RepayPreview />} />
                        <Route path="/term-plans" element={<TermPlansPreview />} />
                        <Route path="/learn/:topic" element={<ExplainerPage />} />
                        <Route path="/settings" element={<SettingsPreview empty={empty} />} />
                        <Route path="/settings/:page" element={<SettingsPreview empty={empty} />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </AppChrome>

                    {/* Harness control — not part of the app */}
                    <button
                      type="button"
                      onClick={() => setEmpty((e) => !e)}
                      className="fixed right-3 top-[62px] z-[60] rounded-md border-[0.5px] border-border bg-background/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
                    >
                      state: {empty ? 'empty' : 'populated'}
                    </button>
                  </>
                }
              />
            </Routes>
          </PreviewIdentityProvider>
        </PreviewBalancesProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
