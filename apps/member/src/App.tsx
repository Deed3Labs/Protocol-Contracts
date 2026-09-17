import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import SplashScreen from "@/components/SplashScreen";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
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
import { MemberProfileProvider } from '@/hooks/useMemberProfile';
import LoginRoute from "@/pages/auth/LoginRoute";
import WalletLinkPage from "@/pages/auth/WalletLink";
import { PWAInitializer } from "@/components/PWAInitializer";
import AppShell from "@/components/shell/AppShell";
import HomeRoute from "@/pages/app/HomeRoute";
import SavingsRoute from "@/pages/app/SavingsRoute";
import ActivityRoute from "@/pages/app/ActivityRoute";
import CardRoute from "@/pages/app/CardRoute";
import CodeRoute from "@/pages/app/CodeRoute";
import AssuranceRoute from "@/pages/app/AssuranceRoute";
import AssuranceReservePage from "@/pages/app/AssuranceReservePage";
import ReserveReportsPage from "@/pages/app/ReserveReportsPage";
import ClaimRoute from "@/pages/app/ClaimRoute";
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
  /** Fading out: the screen holds its place for the 180ms fade, then goes. */
  const [splashLeaving, setSplashLeaving] = useState(false);

  /*
   * The splash goes when the app is up, not when a timer says so.
   *
   * It was a flat four seconds, which is the one thing the spec rules out: a wait that finishes
   * before or after the app does is a claim about progress nobody is measuring. Two frames is the
   * app having painted; the short floor is so a warm start reads as an opening rather than a flash.
   */
  useEffect(() => {
    if (!showSplash) return;
    const started = performance.now();
    let fade: ReturnType<typeof setTimeout>;
    let gone: ReturnType<typeof setTimeout>;
    const done = () => {
      fade = setTimeout(
        () => {
          setSplashLeaving(true);
          gone = setTimeout(() => {
            setShowSplash(false);
            setSplashLeaving(false);
            sessionStorage.setItem('splash_shown', 'true');
          }, 180);
        },
        Math.max(0, 450 - (performance.now() - started)),
      );
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(done));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fade);
      clearTimeout(gone);
    };
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
          <ClearNotificationsProvider>
            <DeedNFTProvider>
              <XMTPProvider>
                <ModalProvider>
                  <GlobalModalsProvider>
                  <ScrollToTop />
                  {showSplash && <SplashScreen leaving={splashLeaving} />}
                  
                  <OfflineIndicator />
                  <PWAInitializer />
                  <PwaInstallTakeover />
                  
                  <Routes>
                    {/* Login Page - Public */}
                    <Route path="/login" element={<LoginRoute />} />
                    {/* Outside the shell, and it reads the member's legal name for the Verify
                        step, so it brings its own provider for the same reason /c/:code does. */}
                    <Route
                      path="/onboarding"
                      element={
                        <MemberProfileProvider>
                          <OnboardingRoute />
                        </MemberProfileProvider>
                      }
                    />
                    {/* The counter entry. `/s/<shop>` is what a shop's code opens, and it is a
                        separate route rather than a mode of /onboarding because the two flows
                        differ in their first step, their last step, and whether an account
                        exists when they begin. `?total=` carries the sale for display only --
                        see CounterOnboardingRoute on why it can never authorize one. */}
                    <Route path="/s/:shop" element={<CounterOnboardingRoute />} />
                    {/* `/c/<code>` — the link in the charge alert. Outside the protected shell
                        because the route sends an unauthenticated member to sign in and come
                        back, which reads better than the shell bouncing them somewhere else. */}
                    {/* The provider lives inside AppShell, and this route is outside it on
                        purpose, so it has to bring its own. Without one the hook falls back to a
                        frozen default whose `loaded` never turns true -- the screen waits on the
                        member's status forever. */}
                    <Route
                      path="/c/:code"
                      element={
                        <MemberProfileProvider>
                          <ChargeApprovalRoute />
                        </MemberProfileProvider>
                      }
                    />
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
                      <Route path="/contacts" element={<Navigate to="/settings/contacts" replace />} />
                      <Route path="/partners" element={<PartnersPage />} />
                      <Route path="/assurance" element={<AssuranceRoute />} />
                      <Route path="/assurance/reserve" element={<AssuranceReservePage />} />
                      <Route path="/assurance/reports" element={<ReserveReportsPage />} />
                      <Route path="/assurance/claim" element={<ClaimRoute />} />
                      <Route path="/inbox" element={<InboxRoute />} />
                      <Route path="/inbox/:threadId" element={<InboxRoute />} />
                      {/* The standalone Alerts page became the Inbox's first tab */}
                      <Route path="/alerts" element={<Navigate to="/inbox" replace />} />
                      <Route path="/scan" element={<ScanPage />} />
                      <Route path="/code" element={<CodeRoute />} />
                      <Route path="/learn/:topic" element={<ExplainerPage />} />
                      {/* Not a nav item — reached from the avatar menu (spec §1). */}
                      <Route path="/settings" element={<SettingsRoute />} />
                      <Route path="/settings/:page" element={<SettingsRoute />} />
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
        </PortfolioProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
