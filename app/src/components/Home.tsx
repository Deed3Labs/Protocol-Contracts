import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Home = () => {
  return (
    <main className="container mx-auto py-16 px-4">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 dark:text-white mb-6">
          Do more than just <br /> "NFTing" your Property
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
          A Modern Platform for Deed Tokenization, Validation, and Management.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        <Card className="group hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-semibold text-gray-900 dark:text-white">
              Mint T-Deed
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-300">
              Create and mint your digital trust deed with customizable metadata and on-chain validation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11">
              <Link to="/mint">Start Minting</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="group hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-semibold text-gray-900 dark:text-white">
              Explore T-Deeds
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-300">
              Browse and discover existing T-Deeds and their metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild className="w-full border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] font-semibold py-3 rounded-lg transition-colors duration-200 h-11">
              <Link to="/explore">Explore T-Deeds</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="text-center mt-16">
        <p className="text-gray-500 dark:text-gray-400 text-lg">
          Use the navigation above to explore different sections of the protocol.
        </p>
      </div>
    </main>
  );
};

export default Home;
