import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const PageTwo = () => {
  return (
    <div className="container mx-auto py-12 px-4 animate-fade-in">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 text-primary">Technical Specifications</h1>
          <p className="text-xl text-muted-foreground">
            Detailed technical information about the DeedNFT Protocol implementation
          </p>
        </div>
        <Separator className="mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Smart Contracts</CardTitle>
              <CardDescription>
                Core contract architecture and deployment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                ERC-721 compliant DeedNFT contracts with advanced metadata management
                and validation capabilities.
              </p>
              <Button variant="outline" className="w-full">
                View Contracts
              </Button>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Validation System</CardTitle>
              <CardDescription>
                Multi-layer validation and verification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Comprehensive validation system with support for multiple validator types
                and automated verification processes.
              </p>
              <Button variant="outline" className="w-full">
                Learn More
              </Button>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Metadata Standards</CardTitle>
              <CardDescription>
                ERC-7496 compliant metadata handling
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Dynamic metadata updates with support for custom traits, validation status,
                and extensible metadata structures.
              </p>
              <Button variant="outline" className="w-full">
                View Standards
              </Button>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Network Integration</CardTitle>
              <CardDescription>
                Multi-chain deployment and compatibility
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Deployed on Base Sepolia with support for multiple EVM-compatible networks
                and cross-chain functionality.
              </p>
              <Button variant="outline" className="w-full">
                Network Info
              </Button>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Security Features</CardTitle>
              <CardDescription>
                Advanced security and access control
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Role-based access control, upgradeable contracts, and comprehensive
                security audits for production deployment.
              </p>
              <Button variant="outline" className="w-full">
                Security Details
              </Button>
            </CardContent>
          </Card>
          <Card className="border border-border bg-card/80">
            <CardHeader>
              <CardTitle>API Integration</CardTitle>
              <CardDescription>
                RESTful API and SDK support
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Comprehensive API for metadata management, validation queries, and
                integration with external systems.
              </p>
              <Button variant="outline" className="w-full">
                API Docs
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="mt-12 text-center">
          <Card className="max-w-2xl mx-auto border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Development Resources</CardTitle>
              <CardDescription>
                Tools and resources for developers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Access our comprehensive developer documentation, SDK, and integration guides
                to build on top of the DeedNFT Protocol.
              </p>
              <div className="flex gap-4 justify-center">
                <Button variant="outline">Documentation</Button>
                <Button variant="outline">GitHub</Button>
                <Button variant="outline">Discord</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PageTwo;