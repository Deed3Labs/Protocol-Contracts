import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { SignIn } from '@/auth/SignIn';
import { useAuth } from '@/auth/authContext';
import HomePage from '@/pages/HomePage';
import NewChargePage from '@/pages/NewChargePage';
import ChargesPage from '@/pages/ChargesPage';
import ChargeDetailPage from '@/pages/ChargeDetailPage';
import RefundPage from '@/pages/RefundPage';
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
  const { session } = useAuth();

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
