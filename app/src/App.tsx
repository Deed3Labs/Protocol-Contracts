import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/components/Home"; // Keeping for reference or fallback
import BrokerageHome from "@/components/BrokerageHome";
import BorrowHome from "@/components/portfolio/BorrowHome";
import EarnHome from "@/components/portfolio/EarnHome";
import UnifiedWealthHome from "@/components/portfolio/UnifiedWealthHome";
import MarketsHome from "@/components/portfolio/MarketsHome";
import LoginPage from "@/components/LoginPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import MintForm from "@/components/MintForm";
import Explore from "@/components/Explore";
import Dashboard from "@/components/Dashboard";
import Validation from "@/components/Validation";
import AdminPanel from "@/components/AdminPanel";
import InstallPrompt from "@/components/InstallPrompt";
import SplashScreen from "@/components/SplashScreen";
import { SWIXAuth } from "@/components/SWIXAuth";
import { SWIXDemo } from "@/components/SWIXDemo";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { ModalProvider, useModal } from "@/context/ModalContext";
import { PortfolioProvider, usePortfolio } from "@/context/PortfolioContext";
import { GlobalModalsProvider } from "@/context/GlobalModalsContext";
import GlobalModals from "@/components/GlobalModals";
import Faucet from "@/components/Faucet";
import BurnerBondPage from "@/components/BurnerBondPage";
import PullToRefresh from "@/components/ui/PullToRefresh";
import ScrollToTop from "@/components/ScrollToTop";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ShareTarget } from "@/pages/ShareTarget";
import { PWAInitializer } from "@/components/PWAInitializer";

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
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
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
                    
                    {/* Share Target - Public */}
                    <Route path="/share" element={<ShareTarget />} />
                    
                    {/* App Routes wrapped in PullToRefresh Layout - Protected */}
                    {/* Pass true if splash was skipped OR if splash just finished */}
                    <Route element={<AppLayout startWithSkeleton={splashShown || showSkeletonAfterSplash} />}>
                      <Route path="/" element={<BrokerageHome />} />
                      <Route path="/markets" element={<MarketsHome />} />
                      <Route path="/earn" element={<EarnHome />} />
                      <Route path="/equity" element={<UnifiedWealthHome />} />
                      <Route path="/borrow" element={<BorrowHome />} />
                    </Route>
                    
                    {/* Redirect unknown routes to login */}
                    <Route path="*" element={<Navigate to="/login" replace />} />

                    {/* Legacy Routes wrapped in Layout */}
                    <Route element={<LegacyLayout />}>
                      <Route path="/legacy-home" element={<Home />} />
                      <Route path="/mint" element={<MintForm />} />
                      <Route path="/explore" element={<Explore />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/validation" element={<Validation />} />
                      <Route path="/bonds" element={<BurnerBondPage />} />
                      <Route path="/admin" element={<AdminPanel />} />
                      <Route path="/auth" element={<SWIXAuth />} />
                      <Route path="/profile" element={<SWIXDemo />} />
                      <Route path="/faucet" element={<Faucet />} />
                    </Route>
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
