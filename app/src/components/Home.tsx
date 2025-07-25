import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <div className="w-full flex items-center justify-center px-4 bg-gradient-to-br from-background via-muted to-card min-h-[60vh] animate-fade-in">
      <div className="w-full max-w-4xl bg-card rounded-2xl shadow-xl p-10 flex flex-col items-center">
        <h1 className="text-4xl font-extrabold mb-6 text-center tracking-tight text-primary">Welcome to DeedNFT Protocol</h1>
        <p className="text-xl text-muted-foreground text-center mb-8 max-w-2xl">
          A modern platform for digital asset management and deed tokenization on Base Sepolia.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl mb-8">
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Mint DeedNFT</CardTitle>
              <CardDescription>
                Create and mint your digital deeds with customizable metadata
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/mint">
                <button className="w-full btn btn-primary">Start Minting</button>
              </Link>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Explore Features</CardTitle>
              <CardDescription>
                Discover additional functionality and tools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/page-one">
                <button className="w-full btn btn-outline">Learn More</button>
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
