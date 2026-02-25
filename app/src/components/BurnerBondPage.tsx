import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  PlusCircle, 
  Search, 
  Wallet, 
  TrendingUp, 
  Clock, 
  DollarSign
} from 'lucide-react';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { getContractAddressForNetwork } from '@/config/networks';
import { useNetworkValidation } from '@/hooks/useNetworkValidation';
import BondDepositForm from '@/components/BondDepositForm';
import BondExplorer from '@/components/BondExplorer';
import BondManagement from '@/components/BondManagement';

interface BondStats {
  totalBonds: number;
  totalValue: string;
  activeBonds: number;
  maturedBonds: number;
}

const BurnerBondPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('deposit');
  const [stats, setStats] = useState<BondStats>({
    totalBonds: 0,
    totalValue: '0',
    activeBonds: 0,
    maturedBonds: 0
  });

  const { address, isConnected: isAppKitConnected, embeddedWalletInfo, status } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const isWalletConnected = isAppKitConnected || (embeddedWalletInfo && status === 'connected');
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  const { isCorrectNetwork } = useNetworkValidation();
  const contractAddress = chainId ? getContractAddressForNetwork(chainId) : null;

  const handleStatsUpdate = (newStats: Partial<BondStats>) => {
    setStats(prev => ({ ...prev, ...newStats }));
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e]">
      <div className="container mx-auto px-4 pt-4 pb-8">
        {/* Debug Information */}
        {isWalletConnected && isCorrectNetwork && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-blue-800 dark:text-blue-200 text-sm">
              <strong>Debug Info:</strong> Chain ID: {chainId}, Contract: {contractAddress || 'Not found'}, 
              Address: {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'None'}
              {embeddedWalletInfo && (
                <span className="ml-2">
                  | Embedded Wallet: {embeddedWalletInfo.authProvider} ({embeddedWalletInfo.accountType})
                </span>
              )}
            </p>
            <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
              Connection Status: {isAppKitConnected ? 'Connected' : 'Disconnected'} | 
              Network: {isCorrectNetwork ? 'Correct' : 'Incorrect'}
            </p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm border-black/10 dark:border-white/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Bonds</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalBonds}</p>
                  </div>
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                    <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm border-black/10 dark:border-white/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Value</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">${stats.totalValue}</p>
                  </div>
                  <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                    <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm border-black/10 dark:border-white/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Active Bonds</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.activeBonds}</p>
                  </div>
                  <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-full">
                    <Clock className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm border-black/10 dark:border-white/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Matured</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.maturedBonds}</p>
                  </div>
                  <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-full">
                    <Wallet className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-gray-100 dark:bg-[#0e0e0e] border border-black/10 dark:border-white/10">
            <TabsTrigger value="deposit" className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              <PlusCircle className="w-4 h-4" />
              Create Bond
            </TabsTrigger>
            <TabsTrigger value="explore" className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              <Search className="w-4 h-4" />
              Explore Bonds
            </TabsTrigger>
            <TabsTrigger value="manage" className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              <Wallet className="w-4 h-4" />
              My Bonds
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="space-y-6">
            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlusCircle className="w-5 h-5" />
                  Create New Bond
                </CardTitle>
                <CardDescription>
                  Deposit tokens to create a discount bond. The longer the maturity, the higher the discount.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BondDepositForm onStatsUpdate={handleStatsUpdate} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="explore" className="space-y-6">
            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Explore All Bonds
                </CardTitle>
                <CardDescription>
                  Discover and filter through all available bonds in the protocol.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BondExplorer onStatsUpdate={handleStatsUpdate} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manage" className="space-y-6">
            <Card className="bg-white/80 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5" />
                  My Bond Portfolio
                </CardTitle>
                <CardDescription>
                  Manage your bonds, redeem mature ones, and track your portfolio performance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BondManagement onStatsUpdate={handleStatsUpdate} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Info Section */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-700">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-blue-500 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">How It Works</h3>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Deposit tokens to create bonds with face value and maturity date. The longer the term, 
                the higher the discount you receive.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-black/10 dark:border-white/10">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-500 rounded-lg">
                  <DollarSign className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-green-900 dark:text-green-100">Backed by Assets</h3>
              </div>
              <p className="text-sm text-green-700 dark:text-green-300">
                All bonds are backed by real underlying tokens in the AssurancePool, 
                ensuring your investment is secure.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-purple-200 dark:border-purple-700">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-purple-500 rounded-lg">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-purple-900 dark:text-purple-100">Flexible Terms</h3>
              </div>
              <p className="text-sm text-purple-700 dark:text-purple-300">
                Choose from short-term to long-term bonds with different discount rates 
                based on the maturity curve.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BurnerBondPage;
