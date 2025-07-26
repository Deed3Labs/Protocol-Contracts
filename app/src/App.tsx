import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Home from "@/components/Home";
import MintForm from "@/components/MintForm";
import Explore from "@/components/Explore";
import Dashboard from "@/components/Dashboard";
import Validation from "@/components/Validation";
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
        <main className="flex-1 w-full">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/mint" element={<MintForm />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/validation" element={<Validation />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;