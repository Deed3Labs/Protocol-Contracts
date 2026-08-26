import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import SplashScreen from "@/components/SplashScreen";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { ClearNotificationsProvider } from "@/context/ClearNotificationsContext";
import { ModalProvider } from "@/context/ModalContext";
import { PortfolioProvider } from "@/context/PortfolioContext";
import { GlobalModalsProvider } from "@/context/GlobalModalsContext";
import ScrollToTop from "@/components/ScrollToTop";
import PwaInstallTakeover from "@/components/PwaInstallTakeover";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ShareTarget } from "@/pages/auth/ShareTarget";
import ClaimFunds from "@/pages/auth/ClaimFunds";
import OnboardingRoute from "@/pages/auth/OnboardingRoute";
import CounterOnboardingRoute from "@/pages/auth/CounterOnboardingRoute";
import ChargeApprovalRoute from "@/pages/app/ChargeApprovalRoute";
import LoginRoute from "@/pages/auth/LoginRoute";
import WalletLinkPage from "@/pages/auth/WalletLink";
import { PWAInitializer } from "@/components/PWAInitializer";
import AppShell from "@/components/shell/AppShell";
import HomeRoute from "@/pages/app/HomeRoute";
import SavingsRoute from "@/pages/app/SavingsRoute";
import ActivityRoute from "@/pages/app/ActivityRoute";
import CardRoute from "@/pages/app/CardRoute";
import ContactsPage from "@/pages/app/ContactsPage";
import AssurancePage from "@/pages/app/AssurancePage";
import InboxRoute from "@/pages/app/InboxRoute";
import ScanPage from "@/pages/app/ScanPage";
import ExplainerPage from "@/pages/app/ExplainerPage";
import PartnersPage from "@/pages/app/PartnersPage";
import SendRoute from "@/pages/app/SendRoute";
import EarnRoute from "@/pages/app/EarnRoute";
import SettingsRoute from "@/pages/app/SettingsRoute";

function App() {
  // Check if splash has been shown in this session
  const [splashShown] = useState(() => !!sessionStorage.getItem('splash_shown'));
  const [showSplash, setShowSplash] = useState(!splashShown);

  useEffect(() => {
    if (showSplash) {
      // Show splash screen for 4 seconds
      const timer = setTimeout(() => {
        setShowSplash(false);
        sessionStorage.setItem('splash_shown', 'true');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showSplash]);

  // Listen for disconnect and connect events to show splash
  useEffect(() => {
    const handleDisconnect = () => {
      // Clear splash shown flag to show splash again
      sessionStorage.removeItem('splash_shown');
      setShowSplash(true);
    };

    const handleConnect = () => {
      // Show splash when user connects
      sessionStorage.removeItem('splash_shown');
      setShowSplash(true);
    };

    // Listen for custom events
    window.addEventListener('wallet-disconnected', handleDisconnect);
    window.addEventListener('wallet-connected', handleConnect);
    
    return () => {
      window.removeEventListener('wallet-disconnected', handleDisconnect);
      window.removeEventListener('wallet-connected', handleConnect);
    };
  }, []);

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <PortfolioProvider>
          <NotificationProvider>
            <ClearNotificationsProvider>
            <DeedNFTProvider>
              <XMTPProvider>
                <ModalProvider>
                  <GlobalModalsProvider>
                  <ScrollToTop />
                  <AnimatePresence>
                    {showSplash && <SplashScreen />}
                  </AnimatePresence>
                  
                  <OfflineIndicator />
                  <PWAInitializer />
                  <PwaInstallTakeover />
                  
                  <Routes>
                    {/* Login Page - Public */}
                    <Route path="/login" element={<LoginRoute />} />
                    <Route path="/onboarding" element={<OnboardingRoute />} />
                    {/* The counter entry. `/s/<shop>` is what a shop's code opens, and it is a
                        separate route rather than a mode of /onboarding because the two flows
                        differ in their first step, their last step, and whether an account
                        exists when they begin. `?total=` carries the sale for display only --
                        see CounterOnboardingRoute on why it can never authorize one. */}
                    <Route path="/s/:shop" element={<CounterOnboardingRoute />} />
                    {/* `/c/<code>` — the link in the charge alert. Outside the protected shell
                        because the route sends an unauthenticated member to sign in and come
                        back, which reads better than the shell bouncing them somewhere else. */}
                    <Route path="/c/:code" element={<ChargeApprovalRoute />} />
                    <Route path="/wallet-link" element={<WalletLinkPage />} />
                    
                    {/* Share Target - Public */}
                    <Route path="/share" element={<ShareTarget />} />
                    <Route path="/claim/:token" element={<ClaimFunds />} />
                    
                    {/* Member app — protected. Routes follow the nav in
                        docs/ux/clear-app-design-spec.md §1.

                        Home, Savings, Send, Activity and Card read real data
                        through their *Route containers. What is still
                        placeholder is term plans, which wait on a member
                        having one, and the projections neither the chain nor
                        the server holds. Each field
                        falls back rather than blanking, so a page never shows a
                        zero it has not actually read. */}
                    <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                      <Route path="/" element={<HomeRoute />} />
                      <Route path="/savings" element={<SavingsRoute />} />
                      <Route path="/earn" element={<EarnRoute />} />
                      <Route path="/send" element={<SendRoute />} />
                      <Route path="/activity" element={<ActivityRoute />} />
                      <Route path="/card" element={<CardRoute />} />
                      <Route path="/contacts" element={<ContactsPage />} />
                      <Route path="/partners" element={<PartnersPage />} />
                      <Route path="/assurance" element={<AssurancePage />} />
                      <Route path="/inbox" element={<InboxRoute />} />
                      {/* The standalone Alerts page became the Inbox's first tab */}
                      <Route path="/alerts" element={<Navigate to="/inbox" replace />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/learn/:topic" element={<ExplainerPage />} />
                      {/* Not a nav item — reached from the avatar menu (spec §1). */}
                      <Route path="/settings" element={<SettingsRoute />} />
                    </Route>

                    {/* Archived pages (src/pages/_archive + src/pages/legacy) are kept on disk
                        for reference but are intentionally NOT routed — they fall through to
                        the catch-all below. */}

                    {/* Redirect unknown routes to login */}
                    <Route path="*" element={<Navigate to="/login" replace />} />
                  </Routes>
                  </GlobalModalsProvider>
                </ModalProvider>
              </XMTPProvider>
            </DeedNFTProvider>
            </ClearNotificationsProvider>
          </NotificationProvider>
        </PortfolioProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
