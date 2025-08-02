import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/components/Home";
import MintForm from "@/components/MintForm";
import Explore from "@/components/Explore";
import Dashboard from "@/components/Dashboard";
import Validation from "@/components/Validation";
import AdminPanel from "@/components/AdminPanel";
import InstallPrompt from "@/components/InstallPrompt";
import { SWIXAuth } from "@/components/SWIXAuth";
import { SWIXDemo } from "@/components/SWIXDemo";
import { ThemeToggle } from "./components/ThemeToggle";
import { DeedNFTProvider } from "@/context/DeedNFTContext";
import { XMTPProvider } from "@/context/XMTPContext";
import Faucet from "@/components/Faucet";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <Header>
          <div className="ml-auto flex items-center space-x-2">
            <ThemeToggle />
          </div>
        </Header>
        <main className="flex-1 w-full pb-20 md:pb-0">
          <DeedNFTProvider>
            <XMTPProvider>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/mint" element={<MintForm />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/validation" element={<Validation />} />
                <Route path="/admin" element={<AdminPanel />} />
                <Route path="/auth" element={<SWIXAuth />} />
                <Route path="/profile" element={<SWIXDemo />} />
                <Route path="/faucet" element={<Faucet />} />
              </Routes>
            </XMTPProvider>
          </DeedNFTProvider>
        </main>
        <Footer />
        <InstallPrompt />
      </div>
    </BrowserRouter>
  );
}

export default App;