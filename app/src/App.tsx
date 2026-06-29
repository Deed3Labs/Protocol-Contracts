import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/pages/legacy/Home"; // Keeping for reference or fallback
import BrokerageHome from "@/pages/app/BrokerageHome";
import BorrowHome from "@/pages/app/BorrowHome";
import SavingsHome from "@/pages/legacy/SavingsHome"; // legacy — superseded by the TransferModal gasless savings flow
import UnifiedWealthHome from "@/pages/app/UnifiedWealthHome";
import MarketsHome from "@/pages/app/MarketsHome";
import TransactionsHome from "@/pages/app/TransactionsHome";
import AccountHome from "@/pages/app/AccountHome";
import LoginPage from "@/pages/auth/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import MintForm from "@/pages/legacy/MintForm";
import Explore from "@/pages/legacy/Explore";
import Dashboard from "@/pages/legacy/Dashboard";
import Validation from "@/pages/legacy/Validation";
import AdminPanel from "@/pages/legacy/AdminPanel";
import InstallPrompt from "@/components/InstallPrompt";
import SplashScreen from "@/components/SplashScreen";
import { SWIXAuth } from "@/pages/legacy/SWIXAuth";
import { SWIXDemo } from "@/pages/legacy/SWIXDemo";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { ModalProvider, useModal } from "@/context/ModalContext";
import { PortfolioProvider, usePortfolio } from "@/context/PortfolioContext";
import { GlobalModalsProvider } from "@/context/GlobalModalsContext";
import GlobalModals from "@/components/GlobalModals";
import Faucet from "@/pages/legacy/Faucet";
import BurnerBondPage from "@/pages/legacy/BurnerBondPage";
import PullToRefresh from "@/components/ui/PullToRefresh";
import ScrollToTop from "@/components/ScrollToTop";
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

const LegacyLayout = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 w-full pb-20 md:pb-0">
        <Outlet />
      </main>
      <Footer />
      <InstallPrompt />
    </div>
  );
};

const AppLayout = ({ startWithSkeleton = false }: { startWithSkeleton?: boolean }) => {
  const { isModalOpen } = useModal();
  const { refreshAll } = usePortfolio();
  
  const handleRefresh = async () => {
    // Wait for animation (increased to 800ms to show skeleton)
    await new Promise(resolve => setTimeout(resolve, 800));
    // Soft refresh: refresh all portfolio data without reloading the page
    // This preserves previous data during refresh (no flashing to 0.00)
    await refreshAll();
  };

  return (
    <ProtectedRoute>
      <PullToRefresh onRefresh={handleRefresh} initialLoading={startWithSkeleton} disabled={isModalOpen}>
        {/* Global Modals (ActionModal + TradeModal) - shared across all pages */}
        <GlobalModals />
        
        <Outlet />
      </PullToRefresh>
    </ProtectedRoute>
  );
};

function App() {
  // Check if splash has been shown in this session
  const [splashShown] = useState(() => !!sessionStorage.getItem('splash_shown'));
  const [showSplash, setShowSplash] = useState(!splashShown);
  // Track if we should show skeleton after splash
  const [showSkeletonAfterSplash, setShowSkeletonAfterSplash] = useState(false);

  useEffect(() => {
    if (showSplash) {
      // Show splash screen for 4 seconds
      const timer = setTimeout(() => {
        setShowSplash(false);
        setShowSkeletonAfterSplash(true); // Trigger skeleton after splash
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

                    {/* Parked legacy fintech homes — off-nav, reachable for reference */}
                    <Route element={<AppLayout startWithSkeleton={splashShown || showSkeletonAfterSplash} />}>
                      <Route path="/legacy/brokerage" element={<BrokerageHome />} />
                      <Route path="/legacy/markets" element={<MarketsHome />} />
                      <Route path="/legacy/transactions" element={<TransactionsHome />} />
                      <Route path="/legacy/savings" element={<SavingsHome />} />
                      <Route path="/legacy/equity" element={<UnifiedWealthHome />} />
                      <Route path="/legacy/borrow" element={<BorrowHome />} />
                      <Route path="/legacy/account" element={<AccountHome />} />
                    </Route>

                    {/* Parked legacy utility pages — off-nav */}
                    <Route element={<LegacyLayout />}>
                      <Route path="/legacy/home" element={<Home />} />
                      <Route path="/legacy/mint" element={<MintForm />} />
                      <Route path="/legacy/explore" element={<Explore />} />
                      <Route path="/legacy/dashboard" element={<Dashboard />} />
                      <Route path="/legacy/validation" element={<Validation />} />
                      <Route path="/legacy/bonds" element={<BurnerBondPage />} />
                      <Route path="/legacy/admin" element={<AdminPanel />} />
                      <Route path="/legacy/auth" element={<SWIXAuth />} />
                      <Route path="/legacy/profile" element={<SWIXDemo />} />
                      <Route path="/legacy/faucet" element={<Faucet />} />
                    </Route>

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
