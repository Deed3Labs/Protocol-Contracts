import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Home from "@/components/Home";
import MintForm from "@/components/MintForm";
import PageOne from "@/components/PageOne";
import PageTwo from "@/components/PageTwo";
import { ThemeToggle } from "./components/ThemeToggle";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <Header>
          <div className="ml-auto flex items-center space-x-2">
            <ThemeToggle />
          </div>
        </Header>
        <main className="flex-1 flex flex-col items-center justify-center w-full container animate-fade-in">
          <section className="w-full max-w-3xl text-center py-12">
            <h1 className="text-4xl font-bold mb-4 tracking-tight">Welcome to DeedNFT Protocol</h1>
            <p className="text-lg text-muted-foreground mb-8">A modern protocol for minting and managing digital deeds on EVM chains.</p>
          </section>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/mint" element={<MintForm />} />
            <Route path="/page-one" element={<PageOne />} />
            <Route path="/page-two" element={<PageTwo />} />
          </Routes>
        </main>
        <footer className="w-full py-6 text-center text-muted-foreground border-t border-border bg-card animate-fade-in">
          &copy; {new Date().getFullYear()} DeedNFT Protocol. Powered by ShadCN UI.
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;