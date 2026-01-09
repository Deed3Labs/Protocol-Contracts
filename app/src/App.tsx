import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/components/Home"; // Keeping for reference or fallback
import BrokerageHome from "@/components/BrokerageHome";
import BorrowHome from "@/components/portfolio/BorrowHome";
import MintForm from "@/components/MintForm";
import Explore from "@/components/Explore";
import Dashboard from "@/components/Dashboard";
import Validation from "@/components/Validation";
import AdminPanel from "@/components/AdminPanel";
import InstallPrompt from "@/components/InstallPrompt";
import { SWIXAuth } from "@/components/SWIXAuth";
import { SWIXDemo } from "@/components/SWIXDemo";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import { NotificationProvider } from "@/context/NotificationContext";
import Faucet from "@/components/Faucet";
import BurnerBondPage from "@/components/BurnerBondPage";

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

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <NotificationProvider>
            <DeedNFTProvider>
              <XMTPProvider>
                <Routes>
              {/* New Brokerage Home Route - No Legacy Header/Footer */}
              <Route path="/" element={<BrokerageHome />} />
              <Route path="/borrow" element={<BorrowHome />} />

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
