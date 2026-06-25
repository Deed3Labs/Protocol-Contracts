import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import AppShell from '@/components/shell/AppShell';
import AccountsPage from '@/pages/app/AccountsPage';
import PayPage from '@/pages/app/PayPage';
import TransactionsPage from '@/pages/app/TransactionsPage';
import SettingsPage from '@/pages/app/SettingsPage';
import LoginView from '@/pages/auth/LoginView';
import OnboardingView from '@/pages/auth/OnboardingView';

/**
 * Dev-only preview harness. Mounts just the redesigned shell + pages with the
 * ThemeProvider, bypassing AppKitProvider/Wagmi/auth (which can't initialize in a
 * headless sandbox). Activated only in dev via the `?preview` flag — see main.tsx.
 * Never used in production builds.
 */
export default function PreviewApp() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginView onGetStarted={() => {}} onPreviewOnboarding={() => {}} />} />
          <Route path="/onboarding" element={<OnboardingView onComplete={() => {}} onExit={() => {}} />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<AccountsPage />} />
            <Route path="/pay" element={<PayPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
