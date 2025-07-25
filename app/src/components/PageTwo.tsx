import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

const PageTwo = () => {
  return (
    <div className="container mx-auto py-12 px-4 animate-fade-in">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 text-primary">Protocol Statistics</h1>
          <p className="text-xl text-muted-foreground">
            Track the performance and usage metrics of the DeedNFT Protocol
          </p>
        </div>
        <Separator className="mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Total DeedNFTs Minted</CardTitle>
              <CardDescription>All time statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">1,247</div>
              <div className="text-sm text-muted-foreground mb-4">
                +12% from last month
              </div>
              <Progress value={75} className="w-full" />
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Active Validators</CardTitle>
              <CardDescription>Currently active validator count</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">23</div>
              <div className="text-sm text-muted-foreground mb-4">
                +3 new this week
              </div>
              <Progress value={60} className="w-full" />
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Total Volume</CardTitle>
              <CardDescription>Transaction volume in ETH</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">1,847.32 ETH</div>
              <div className="text-sm text-muted-foreground mb-4">
                +8% from last week
              </div>
              <Progress value={85} className="w-full" />
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Average Gas Used</CardTitle>
              <CardDescription>Per transaction average</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">0.0024 ETH</div>
              <div className="text-sm text-muted-foreground mb-4">
                -5% from last month
              </div>
              <Progress value={45} className="w-full" />
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Asset Type Distribution</CardTitle>
              <CardDescription>Breakdown by asset type</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span>Land</span>
                <span className="font-medium">45%</span>
              </div>
              <Progress value={45} className="w-full" />
              <div className="flex justify-between items-center">
                <span>Vehicle</span>
                <span className="font-medium">28%</span>
              </div>
              <Progress value={28} className="w-full" />
              <div className="flex justify-between items-center">
                <span>Estate</span>
                <span className="font-medium">18%</span>
              </div>
              <Progress value={18} className="w-full" />
              <div className="flex justify-between items-center">
                <span>Commercial Equipment</span>
                <span className="font-medium">9%</span>
              </div>
              <Progress value={9} className="w-full" />
            </CardContent>
          </Card>
          <Card className="shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest protocol events</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium">New DeedNFT Minted</div>
                  <div className="text-sm text-muted-foreground">Land parcel #1247</div>
                </div>
                <div className="text-sm text-muted-foreground">2 min ago</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium">Validator Added</div>
                  <div className="text-sm text-muted-foreground">Real Estate Validator v2.1</div>
                </div>
                <div className="text-sm text-muted-foreground">15 min ago</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium">Metadata Updated</div>
                  <div className="text-sm text-muted-foreground">Vehicle #892 traits</div>
                </div>
                <div className="text-sm text-muted-foreground">1 hour ago</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <div className="font-medium">Royalty Payment</div>
                  <div className="text-sm text-muted-foreground">0.05 ETH to validator</div>
                </div>
                <div className="text-sm text-muted-foreground">3 hours ago</div>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="mt-8 text-center">
          <Card className="max-w-2xl mx-auto shadow-md border border-border bg-card/80">
            <CardHeader>
              <CardTitle>Export Data</CardTitle>
              <CardDescription>
                Download protocol statistics and analytics
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button variant="outline">Export CSV</Button>
                <Button variant="outline">Export JSON</Button>
                <Button variant="outline">Generate Report</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PageTwo;