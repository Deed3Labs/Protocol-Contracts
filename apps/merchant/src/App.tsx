import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { SignIn } from '@/auth/SignIn';
import { OwnerSignIn } from '@/auth/OwnerSignIn';
import { EnrollDevice } from '@/auth/EnrollDevice';
import { useAuth } from '@/auth/authContext';
import HomePage from '@/pages/HomePage';
import NewChargePage from '@/pages/NewChargePage';
import ChargesPage from '@/pages/ChargesPage';
import ChargeDetailPage from '@/pages/ChargeDetailPage';
import RefundPage from '@/pages/RefundPage';
import PayoutDetailPage from '@/pages/PayoutDetailPage';
import PayoutsPage from '@/pages/PayoutsPage';
import StaffPage from '@/pages/StaffPage';
import SettingsPage from '@/pages/SettingsPage';
import OnboardingPage from '@/pages/OnboardingPage';

/**
 * The routing skeleton.
 *
 * Payouts and Staff are owner-only. Guarded here rather than merely hidden in the nav: a counter
 * device is a shared device, and a URL somebody typed once is a URL somebody can type again.
 * `seesMoney` in the shared domain is what decides, so there is one answer to that question.
 */
function OwnerOnly({ children }: { children: React.ReactNode }) {
  const { canSeeMoney } = useAuth();
  return canSeeMoney ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { session, device, loading } = useAuth();

  // Dev-only. Enrollment sits behind a backend and an owner's Privy sign-in, which makes it the one
  // screen that cannot be looked at while building it. `import.meta.env.DEV` is statically false in
  // a production build, so this and the import fall out at bundle time.
  if (import.meta.env.DEV && window.location.search.includes('screen=enroll')) {
    return <EnrollDevice onDone={() => undefined} />;
  }

  // Nothing at all until the tablet has asked what it is. Rendering the PIN pad first and then
  // replacing it with the enrollment screen would flash a sign-in at an owner who is setting the
  // device up, which reads as a bug on the one screen that has to look deliberate.
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)]">
        <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Starting up…</p>
      </div>
    );
  }

  /**
   * Not set up, or removed — reference section 19.
   *
   * Distinct from signed out, and the app has to tell them apart: a signed-out tablet shows the
   * PIN pad, an unenrolled one cannot, because the roster itself is behind device authentication.
   * A tablet an owner revoked from across town lands here on its next request, which is what
   * "remove it any time, from any device" looks like from this side.
   *
   * Enrollment is the owner's act, so it goes through the owner's sign-in first. There is no way to
   * reach it with a shift PIN, which is the point — a device is authority being delegated.
   */
  if (!device) {
    if (!session || session.staff.role !== 'owner') {
      return (
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          {/* No `onBack`: there is no counter behind this yet. */}
          <Route path="*" element={<OwnerSignIn onDone={() => undefined} />} />
        </Routes>
      );
    }
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<EnrollDevice onDone={() => undefined} />} />
      </Routes>
    );
  }

  // Onboarding is reachable before anyone has a session — a shop setting up has no staff yet.
  if (!session) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<NewChargePage />} />
        <Route path="/charges" element={<ChargesPage />} />
        <Route path="/charges/:id" element={<ChargeDetailPage />} />
        <Route path="/charges/:id/refund" element={<RefundPage />} />
        <Route
          path="/payouts"
          element={
            <OwnerOnly>
              <PayoutsPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/payouts/:id"
          element={
            <OwnerOnly>
              <PayoutDetailPage />
            </OwnerOnly>
          }
        />
        <Route
          path="/staff"
          element={
            <OwnerOnly>
              <StaffPage />
            </OwnerOnly>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
