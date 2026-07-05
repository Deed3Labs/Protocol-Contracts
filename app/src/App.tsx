import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { trackPageview } from "@/lib/analytics";
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
import AccountsPage from "@/pages/app/AccountsPage";
import PayPage from "@/pages/app/PayPage";
import TransactionsPage from "@/pages/app/TransactionsPage";
import SettingsPage from "@/pages/app/SettingsPage";
import BorrowPage from "@/pages/app/BorrowPage";
import AssurancePage from "@/pages/app/AssurancePage";

/** Fires a sanitized Plausible pageview on every client-side route change (live app only; no-op else). */
function RouteAnalytics() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
  return null;
}

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
                  <RouteAnalytics />
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
                    
                    {/* Redesigned app — protected, bottom tab navigation */}
                    <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                      <Route path="/" element={<AccountsPage />} />
                      <Route path="/pay" element={<PayPage />} />
                      <Route path="/borrow" element={<BorrowPage />} />
                      <Route path="/assurance" element={<AssurancePage />} />
                      <Route path="/transactions" element={<TransactionsPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Route>

                    {/* Legacy pages (src/pages/legacy + parked src/pages/app homes) are kept in the repo
                        for reference but are intentionally NOT routed — no /legacy/* path is reachable;
                        they fall through to the catch-all below. */}

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
