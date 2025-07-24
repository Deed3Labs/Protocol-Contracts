import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import MintForm from "@/components/MintForm";
import PageOne from "@/components/PageOne";
import PageTwo from "@/components/PageTwo";

function Home() {
  return (
    <div className="w-full flex items-center justify-center px-4">
      <div className="w-full max-w-xl bg-white dark:bg-card rounded-2xl shadow-xl p-10 flex flex-col items-center">
        <h1 className="text-3xl font-extrabold mb-4 text-center tracking-tight">Welcome to Protocol App</h1>
        <p className="text-lg text-muted-foreground text-center mb-2">A modern platform for digital asset management.</p>
        <p className="text-center text-muted-foreground">Use the navigation above to mint a DeedNFT or explore more features.</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-background dark:to-muted">
        <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-background/80 backdrop-blur border-b border-gray-200 dark:border-muted shadow-sm">
          <nav className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
            <div className="flex items-center space-x-6">
              <span className="text-xl font-bold tracking-tight text-primary">Protocol</span>
              <Link to="/" className="font-medium hover:underline transition-colors">Home</Link>
              <Link to="/mint" className="font-medium hover:underline transition-colors">Mint</Link>
              <Link to="/page-one" className="font-medium hover:underline transition-colors">Page One</Link>
              <Link to="/page-two" className="font-medium hover:underline transition-colors">Page Two</Link>
            </div>
          </nav>
        </header>
        <main className="flex-1 flex items-center justify-center w-full">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/mint" element={<MintForm />} />
            <Route path="/page-one" element={<PageOne />} />
            <Route path="/page-two" element={<PageTwo />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
