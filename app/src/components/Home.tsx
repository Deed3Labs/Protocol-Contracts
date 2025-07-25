import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <div className="w-full flex items-center justify-center px-4">
      <div className="w-full max-w-4xl bg-white dark:bg-card rounded-2xl shadow-xl p-10 flex flex-col items-center">
        <h1 className="text-4xl font-extrabold mb-6 text-center tracking-tight">
          Welcome to DeedNFT Protocol
        </h1>
        <p className="text-xl text-muted-foreground text-center mb-8 max-w-2xl">
          A modern platform for digital asset management and deed tokenization on Base Sepolia.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Mint DeedNFT</CardTitle>
              <CardDescription>
                Create and mint your digital deeds with customizable metadata
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/mint">
                <Button className="w-full">Start Minting</Button>
              </Link>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Explore Features</CardTitle>
              <CardDescription>
                Discover additional functionality and tools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/page-one">
                <Button variant="outline" className="w-full">Learn More</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
        
        <div className="text-center text-muted-foreground">
          <p>Use the navigation above to explore different sections of the protocol.</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
