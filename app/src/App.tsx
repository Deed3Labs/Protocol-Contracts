import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/components/Home"; // Keeping for reference or fallback
import BrokerageHome from "@/components/BrokerageHome";
import BorrowHome from "@/components/portfolio/BorrowHome";
import MarketsHome from "@/components/portfolio/MarketsHome";
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
import Faucet from "@/components/Faucet";
import BurnerBondPage from "@/components/BurnerBondPage";
import PullToRefresh from "@/components/ui/PullToRefresh";

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
  const location = useLocation();
  const [isNavigating, setIsNavigating] = useState(false);
  const prevLocationRef = useRef(location.pathname);
  const isFirstRender = useRef(true);

  const handleRefresh = async () => {
    // Wait for animation (increased to 800ms to show skeleton)
    await new Promise(resolve => setTimeout(resolve, 800));
    window.location.reload();
  };

  // Detect route changes and show skeleton
  useEffect(() => {
    // Skip the initial mount - only trigger on actual navigation
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevLocationRef.current = location.pathname;
      return;
    }
    
    if (location.pathname !== prevLocationRef.current) {
      setIsNavigating(true);
      prevLocationRef.current = location.pathname;
      
      // Show skeleton for 800ms (same duration as refresh)
      const timer = setTimeout(() => {
        setIsNavigating(false);
      }, 800);
      
      return () => clearTimeout(timer);
    }
  }, [location.pathname]);

  return (
    <PullToRefresh 
      onRefresh={handleRefresh} 
      initialLoading={startWithSkeleton || isNavigating}
    >
      <Outlet />
    </PullToRefresh>
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

  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <NotificationProvider>
            <DeedNFTProvider>
              <XMTPProvider>
                <AnimatePresence>
                  {showSplash && <SplashScreen />}
                </AnimatePresence>
                
                <Routes>
              {/* App Routes wrapped in PullToRefresh Layout */}
              {/* Pass true if splash was skipped OR if splash just finished */}
              <Route element={<AppLayout startWithSkeleton={splashShown || showSkeletonAfterSplash} />}>
                <Route path="/" element={<BrokerageHome />} />
                <Route path="/markets" element={<MarketsHome />} />
                <Route path="/borrow" element={<BorrowHome />} />
              </Route>

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
              </XMTPProvider>
            </DeedNFTProvider>
      </NotificationProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
