import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import AppChrome from '@/components/shell/AppChrome';
import CycleCard from '@/components/clear/CycleCard';
import HeaderActions from '@/components/shell/HeaderActions';
import { unreadAlerts, unreadThreads } from '@/lib/clearModel';
import HomePage from '@/pages/app/HomePage';
import SavingsPage from '@/pages/app/SavingsPage';
import ActivityPage from '@/pages/app/ActivityPage';
import CardPage from '@/pages/app/CardPage';
import ContactsPage from '@/pages/app/ContactsPage';
import AssurancePage from '@/pages/app/AssurancePage';
import InboxPage from '@/pages/app/InboxPage';
import ScanPage from '@/pages/app/ScanPage';
import ExplainerPage from '@/pages/app/ExplainerPage';
import PartnersPage from '@/pages/app/PartnersPage';
import SendPage from '@/pages/app/SendPage';
import EarnPage from '@/pages/app/EarnPage';
import SettingsPage from '@/pages/app/SettingsPage';
import OnboardingFlow, { type OnboardingStep } from '@/pages/auth/OnboardingFlow';
import {
  HOME_IN_USE,
  HOME_DAY_ONE,
  SAVINGS_IN_USE,
  SAVINGS_DAY_ONE,
  ACTIVITY_IN_USE,
  ACTIVITY_DAY_ONE,
  CARD_IN_USE,
  CARD_DAY_ONE,
  SEND_IN_USE,
  SEND_DAY_ONE,
  CONTACTS,
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
  'join',
  'identity',
  'waitlist',
  'claim',
  'claimJoin',
];

/**
 * The cycle's three states side by side — the harness equivalent of the reference's own
 * "Cycle — three states" screen.
 *
 * Home only ever shows whichever state that member is in, and the placeholder member is fully
 * secured, so the other two would otherwise be unreachable to look at.
 */
function CyclePreview() {
  const { cycle, credit, cashAccount } = HOME_IN_USE;
  // The placeholder member carries $700 unsecured, so the secured state is the one that has to be
  // constructed here: same member with the income tier idle rather than drawn.
  const secured = {
    ...credit,
    tiers: credit.tiers.map((t) => (t.key === 'income' ? { ...t, used: 0 } : t)),
  };
  const states = [
    { name: 'fully secured', credit: secured, deposit: cashAccount.nextDepositEstimate },
    { name: 'unsecured, deposit covers', credit, deposit: 2000 },
    { name: 'unsecured, deposit short', credit, deposit: cashAccount.nextDepositEstimate },
  ];

  return (
    <div className="flex flex-col gap-6">
      {states.map((s) => (
        <div key={s.name}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.3px] text-muted-foreground">
            {s.name}
          </p>
          {/* Same breakpoints Home uses, so neither variant is judged at a width it never sees. */}
          <div className="hidden lg:block">
            <CycleCard
              cycle={cycle}
              credit={s.credit}
              expectedDeposit={s.deposit}
              depositOn={cashAccount.nextDepositOn}
              onRepay={() => {}}
            />
          </div>
          <div className="max-w-[330px] lg:hidden">
            <CycleCard
              cycle={cycle}
              credit={s.credit}
              expectedDeposit={s.deposit}
              depositOn={cashAccount.nextDepositOn}
              onRepay={() => {}}
              variant="card"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Onboarding sits outside the app chrome — there's no nav until you're a member. */
function OnboardingPreview() {
  const [step, setStep] = useState<OnboardingStep>('enter');

  return (
    <div className="min-h-screen bg-background">
      <OnboardingFlow step={step} onStepChange={setStep} />

      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap justify-center gap-1 border-t-[0.5px] border-border bg-background/90 p-2 backdrop-blur-sm">
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

export default function PreviewApp() {
  const [empty, setEmpty] = useState(false);

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <Routes>
          <Route path="/onboarding" element={<OnboardingPreview />} />

          <Route
            path="*"
            element={
              <>
                <AppChrome
                  trailing={
                    <HeaderActions
                      profile={SETTINGS.profile}
                      unread={empty ? 0 : unreadAlerts(INBOX.alerts) + unreadThreads(INBOX.threads)}
                      accelerationActive={SETTINGS.accelerationActive}
                    />
                  }
                >
                  <Routes>
                    <Route path="/" element={<HomePage data={empty ? HOME_DAY_ONE : HOME_IN_USE} />} />
                    <Route path="/savings" element={<SavingsPage data={empty ? SAVINGS_DAY_ONE : SAVINGS_IN_USE} />} />
                    <Route path="/earn" element={<EarnPage data={empty ? EARN_DAY_ONE : EARN_IN_USE} />} />
                    <Route path="/send" element={<SendPage key={String(empty)} data={empty ? SEND_DAY_ONE : SEND_IN_USE} />} />
                    <Route path="/activity" element={<ActivityPage data={empty ? ACTIVITY_DAY_ONE : ACTIVITY_IN_USE} />} />
                    <Route path="/card" element={<CardPage key={String(empty)} data={empty ? CARD_DAY_ONE : CARD_IN_USE} />} />
                    <Route path="/contacts" element={<ContactsPage contacts={empty ? [] : CONTACTS} />} />
                    <Route path="/partners" element={<PartnersPage />} />
                    <Route
                      path="/assurance"
                      element={<AssurancePage data={empty ? SAVINGS_DAY_ONE : SAVINGS_IN_USE} />}
                    />
                    <Route
                      path="/inbox"
                      element={
                        <InboxPage
                          data={empty ? { alerts: [], threads: [], messages: {} } : INBOX}
                        />
                      }
                    />
                    <Route path="/alerts" element={<Navigate to="/inbox" replace />} />
                    <Route path="/scan" element={<ScanPage />} />
                    <Route path="/cycle" element={<CyclePreview />} />
                    <Route path="/learn/:topic" element={<ExplainerPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
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
      </ThemeProvider>
    </BrowserRouter>
  );
}
