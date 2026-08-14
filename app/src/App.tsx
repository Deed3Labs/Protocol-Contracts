import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import LoginPage from "@/pages/auth/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import SplashScreen from "@/components/SplashScreen";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { ModalProvider } from "@/context/ModalContext";
import { PortfolioProvider } from "@/context/PortfolioContext";
import { GlobalModalsProvider } from "@/context/GlobalModalsContext";
import ScrollToTop from "@/components/ScrollToTop";
import PwaInstallTakeover from "@/components/PwaInstallTakeover";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ShareTarget } from "@/pages/auth/ShareTarget";
import ClaimFunds from "@/pages/auth/ClaimFunds";
import UserOnboarding from "@/pages/auth/UserOnboarding";
import WalletLinkPage from "@/pages/auth/WalletLink";
import { PWAInitializer } from "@/components/PWAInitializer";
import AppShell from "@/components/shell/AppShell";
import HomePage from "@/pages/app/HomePage";
import SavingsPage from "@/pages/app/SavingsPage";
import ActivityPage from "@/pages/app/ActivityPage";
import CardPage from "@/pages/app/CardPage";
import ContactsPage from "@/pages/app/ContactsPage";
import AssurancePage from "@/pages/app/AssurancePage";
import AlertsPage from "@/pages/app/AlertsPage";
import ScanPage from "@/pages/app/ScanPage";
import ExplainerPage from "@/pages/app/ExplainerPage";
import PartnersPage from "@/pages/app/PartnersPage";
import SendPage from "@/pages/app/SendPage";
import EarnPage from "@/pages/app/EarnPage";
import SettingsPage from "@/pages/app/SettingsPage";

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
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/onboarding" element={<UserOnboarding />} />
                    <Route path="/wallet-link" element={<WalletLinkPage />} />
                    
                    {/* Share Target - Public */}
                    <Route path="/share" element={<ShareTarget />} />
                    <Route path="/claim/:token" element={<ClaimFunds />} />
                    
                    {/* Member app — protected. Routes follow the nav in
                        docs/ux/clear-app-design-spec.md §1.

                        NOT READY TO MERGE: each page below falls back to its
                        default prop, which is placeholder data from
                        data/clearPlaceholder.ts — so this build shows invented
                        balances. Wire each route to the real contexts
                        (useClearBalances / useClearTransactions / CreditContext /
                        useMemberProfile) before this branch goes anywhere near
                        dev. */}
                    <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/savings" element={<SavingsPage />} />
                      <Route path="/earn" element={<EarnPage />} />
                      <Route path="/send" element={<SendPage />} />
                      <Route path="/activity" element={<ActivityPage />} />
                      <Route path="/card" element={<CardPage />} />
                      <Route path="/contacts" element={<ContactsPage />} />
                      <Route path="/partners" element={<PartnersPage />} />
                      <Route path="/assurance" element={<AssurancePage />} />
                      <Route path="/alerts" element={<AlertsPage />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/learn/:topic" element={<ExplainerPage />} />
                      {/* Not a nav item — reached from the avatar menu (spec §1). */}
                      <Route path="/settings" element={<SettingsPage />} />
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
          </NotificationProvider>
        </PortfolioProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
