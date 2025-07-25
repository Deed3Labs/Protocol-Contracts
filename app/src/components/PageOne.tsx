import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const PageOne = () => {
  return (
    <div className="container mx-auto py-12 px-4 animate-fade-in">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 text-primary">Protocol Features</h1>
          <p className="text-xl text-muted-foreground">
            Explore the advanced features and capabilities of the DeedNFT Protocol
          </p>
        </div>
        <Separator className="mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="secondary">New</Badge>
                Asset Validation
              </CardTitle>
              <CardDescription>
                Validate your digital assets with our comprehensive validation system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Our validation system ensures the integrity and authenticity of your DeedNFTs
                through multiple layers of verification.
              </p>
              <Button variant="outline" className="w-full">
                Learn More
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Metadata Management</CardTitle>
              <CardDescription>
                Advanced metadata handling with dynamic trait updates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Update and manage your NFT metadata dynamically with our ERC-7496 compliant system.
              </p>
              <Button variant="outline" className="w-full">
                Explore
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Royalty Enforcement</CardTitle>
              <CardDescription>
                Built-in royalty protection for creators and validators
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Automatic royalty enforcement ensures fair compensation for all parties involved.
              </p>
              <Button variant="outline" className="w-full">
                Details
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Validator Network</CardTitle>
              <CardDescription>
                Connect with trusted validators in our decentralized network
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Access a network of verified validators to ensure your assets meet industry standards.
              </p>
              <Button variant="outline" className="w-full">
                Browse Validators
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Fund Management</CardTitle>
              <CardDescription>
                Integrated payment processing and fund management
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Seamless payment processing with support for multiple token types and automated fee collection.
              </p>
              <Button variant="outline" className="w-full">
                View Options
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Analytics Dashboard</CardTitle>
              <CardDescription>
                Track your DeedNFT performance and analytics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Comprehensive analytics and insights for your digital asset portfolio.
              </p>
              <Button variant="outline" className="w-full">
                View Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="mt-12 text-center">
          <Card className="max-w-2xl mx-auto shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Coming Soon</CardTitle>
              <CardDescription>
                More features are in development. Stay tuned for updates!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                We're constantly working on new features to enhance the DeedNFT Protocol.
                Follow our development progress and be the first to try new features.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PageOne;