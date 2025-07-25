import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Home from "@/components/Home";
import MintForm from "@/components/MintForm";
import PageOne from "@/components/PageOne";
import PageTwo from "@/components/PageTwo";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-background dark:to-muted">
        <Header />
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
