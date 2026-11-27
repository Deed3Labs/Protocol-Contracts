import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Wallet, 
  DollarSign, 
  Clock, 
  TrendingUp, 
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  SortAsc,
  SortDesc,
  Filter
} from 'lucide-react';
import BondCard from './BondCard';
import type { Bond } from './BondCard';
import BondViewer from './BondViewer';

interface BondManagementProps {
  onStatsUpdate: (stats: any) => void;
}

interface UserBond extends Bond {
  tokenName: string;
  purchasePrice: string;
  bondType: 'short-term' | 'mid-term' | 'long-term';
  balance: string; // User's balance of this bond
}

interface PortfolioStats {
  totalValue: number;
  totalInvested: number;
  totalDiscount: number;
  averageDiscount: number;
  activeBonds: number;
  maturedBonds: number;
  redeemedBonds: number;
  potentialGains: number;
}

const BondManagement: React.FC<BondManagementProps> = ({ onStatsUpdate }) => {
  const [userBonds, setUserBonds] = useState<UserBond[]>([]);
  const [filteredBonds, setFilteredBonds] = useState<UserBond[]>([]);
  const [selectedBonds, setSelectedBonds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'maturity' | 'discount' | 'value' | 'created'>('maturity');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'matured' | 'redeemed'>('all');
  const [filterType, setFilterType] = useState<'all' | 'short-term' | 'mid-term' | 'long-term'>('all');
  const [selectedBond, setSelectedBond] = useState<Bond | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [portfolioStats, setPortfolioStats] = useState<PortfolioStats>({
    totalValue: 0,
    totalInvested: 0,
    totalDiscount: 0,
    averageDiscount: 0,
    activeBonds: 0,
    maturedBonds: 0,
    redeemedBonds: 0,
    potentialGains: 0
  });

  // Mock user bonds data
  const mockUserBonds: UserBond[] = [
    {
      id: '1',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenAddress: '0xA0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '1000.00',
      purchasePrice: '950.00',
      requiredDeposit: '950.00',
      discountAmount: '50.00',
      discountPercentage: 5.0,
      maturityDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
      isRedeemed: false,
      creator: '0x1234...5678',
      createdAt: Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60),
      bondType: 'short-term',
      balance: '1'
    },
    {
      id: '2',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenAddress: '0xB0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '5000.00',
      purchasePrice: '4250.00',
      requiredDeposit: '4250.00',
      discountAmount: '750.00',
      discountPercentage: 15.0,
      maturityDate: Math.floor(Date.now() / 1000) + (180 * 24 * 60 * 60),
      isRedeemed: false,
      creator: '0x2345...6789',
      createdAt: Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60),
      bondType: 'mid-term',
      balance: '1'
    },
    {
      id: '3',
      tokenSymbol: 'USDT',
      tokenName: 'Tether USD',
      tokenAddress: '0xC0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '10000.00',
      purchasePrice: '7000.00',
      requiredDeposit: '7000.00',
      discountAmount: '3000.00',
      discountPercentage: 30.0,
      maturityDate: Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60), // Matured
      isRedeemed: false,
      creator: '0x3456...7890',
      createdAt: Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60),
      bondType: 'long-term',
      balance: '1'
    },
    {
      id: '4',
      tokenSymbol: 'DAI',
      tokenName: 'Dai Stablecoin',
      tokenAddress: '0xD0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '2500.00',
      purchasePrice: '2500.00',
      requiredDeposit: '2500.00',
      discountAmount: '0.00',
      discountPercentage: 0.0,
      maturityDate: Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60), // Matured
      isRedeemed: true,
      creator: '0x4567...8901',
      createdAt: Math.floor(Date.now() / 1000) - (60 * 24 * 60 * 60),
      bondType: 'short-term',
      balance: '0'
    }
  ];

  useEffect(() => {
    loadUserBonds();
  }, []);

  useEffect(() => {
    filterBonds();
    calculatePortfolioStats();
  }, [userBonds, searchTerm, sortBy, sortOrder, filterStatus, filterType]);

  const loadUserBonds = async () => {
    setIsLoading(true);
    try {
      // Mock API call - in real app, this would fetch user's bonds from contracts
      await new Promise(resolve => setTimeout(resolve, 1000));
      setUserBonds(mockUserBonds);
    } catch (error) {
      console.error('Failed to load user bonds:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterBonds = () => {
    let filtered = [...userBonds];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(bond =>
        bond.tokenSymbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bond.tokenName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bond.id.includes(searchTerm)
      );
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(bond => {
        const now = Date.now();
        const isMatured = bond.maturityDate < now;
        
        switch (filterStatus) {
          case 'active':
            return !bond.isRedeemed && !isMatured;
          case 'matured':
            return !bond.isRedeemed && isMatured;
          case 'redeemed':
            return bond.isRedeemed;
          default:
            return true;
        }
      });
    }

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(bond => bond.bondType === filterType);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'maturity':
          comparison = a.maturityDate - b.maturityDate;
          break;
        case 'discount':
          comparison = a.discountPercentage - b.discountPercentage;
          break;
        case 'value':
          comparison = parseFloat(a.faceValue) - parseFloat(b.faceValue);
          break;
        case 'created':
          comparison = a.createdAt - b.createdAt;
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    setFilteredBonds(filtered);
  };

  const calculatePortfolioStats = () => {
    const now = Date.now();
    let totalValue = 0;
    let totalInvested = 0;
    let totalDiscount = 0;
    let totalDiscountPercentage = 0;
    let activeBonds = 0;
    let maturedBonds = 0;
    let redeemedBonds = 0;
    let potentialGains = 0;

    userBonds.forEach(bond => {
      const faceValue = parseFloat(bond.faceValue);
      const purchasePrice = parseFloat(bond.purchasePrice);
      const isMatured = bond.maturityDate < now;

      totalValue += faceValue;
      totalInvested += purchasePrice;
      totalDiscount += faceValue - purchasePrice;
      totalDiscountPercentage += bond.discountPercentage;

      if (bond.isRedeemed) {
        redeemedBonds++;
      } else if (isMatured) {
        maturedBonds++;
        potentialGains += faceValue - purchasePrice;
      } else {
        activeBonds++;
        potentialGains += faceValue - purchasePrice;
      }
    });

    // Calculate average discount percentage
    const averageDiscount = userBonds.length > 0 ? totalDiscountPercentage / userBonds.length : 0;

    setPortfolioStats({
      totalValue,
      totalInvested,
      totalDiscount,
      averageDiscount,
      activeBonds,
      maturedBonds,
      redeemedBonds,
      potentialGains
    });
  };

  const handleBondSelection = (bondId: string, checked: boolean) => {
    if (checked) {
      setSelectedBonds([...selectedBonds, bondId]);
    } else {
      setSelectedBonds(selectedBonds.filter(id => id !== bondId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const redeemableBonds = filteredBonds.filter(bond => {
        const now = Date.now();
        return !bond.isRedeemed && bond.maturityDate < now;
      });
      setSelectedBonds(redeemableBonds.map(bond => bond.id));
    } else {
      setSelectedBonds([]);
    }
  };

  const handleRedeemBonds = async () => {
    if (selectedBonds.length === 0) return;

    setIsRedeeming(true);
    try {
      // Mock redemption - in real app, this would call the contract
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update bonds as redeemed
      setUserBonds(prev => prev.map(bond => 
        selectedBonds.includes(bond.id) 
          ? { ...bond, isRedeemed: true, balance: '0' }
          : bond
      ));
      
      setSelectedBonds([]);
      
      // Update stats
      onStatsUpdate({
        totalBonds: (prev: number) => prev - selectedBonds.length,
        activeBonds: (prev: number) => prev - selectedBonds.length,
        maturedBonds: (prev: number) => prev - selectedBonds.length
      });
    } catch (error) {
      console.error('Failed to redeem bonds:', error);
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleViewDetails = (bond: UserBond) => {
    setSelectedBond(bond);
    setIsViewerOpen(true);
  };

  const handleRedeem = (bond: UserBond) => {
    // Mock redeem functionality
    console.log('Redeeming bond:', bond.id);
    // In real app, this would call the contract
  };

  const getBondStatus = (bond: UserBond) => {
    const now = Date.now();
    if (bond.isRedeemed) return { label: 'Redeemed', color: 'bg-gray-500', icon: CheckCircle };
    if (bond.maturityDate < now) return { label: 'Matured', color: 'bg-green-500', icon: AlertCircle };
    return { label: 'Active', color: 'bg-blue-500', icon: Clock };
  };


  const redeemableBonds = filteredBonds.filter(bond => {
    const now = Date.now();
    return !bond.isRedeemed && bond.maturityDate < now;
  });

  return (
    <div className="space-y-6">
      {/* Portfolio Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-black/10 dark:border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Value</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  ${portfolioStats.totalValue.toFixed(2)}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-black/10 dark:border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">Average Discount</p>
                <p className="text-2xl font-bold text-green-900 dark:text-green-100">
                  {portfolioStats.averageDiscount.toFixed(1)}%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-black/10 dark:border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-600 dark:text-orange-400">Active Bonds</p>
                <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                  {portfolioStats.activeBonds}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-black/10 dark:border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Potential Gains</p>
                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                  ${portfolioStats.potentialGains.toFixed(2)}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="space-y-2 md:space-y-6">
        {/* Search row with buttons inline */}
        <div className="flex items-end gap-2 sm:gap-2">
          <div className="flex-1 relative">
            <Label htmlFor="search" className="hidden sm:block text-sm font-medium mb-2">
              Search My Bonds
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                id="search"
                placeholder="Search by token, ID, or type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 md:h-12 text-base dark:bg-[#141414] border border-black/10 dark:border-white/10"
              />
            </div>
          </div>
          
          <Button
            variant="outline"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] h-11 w-11 md:h-12 md:w-12 p-0 flex-shrink-0"
            title={`Sort ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
          >
            {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
          </Button>
          
          <Button
            variant="outline"
            onClick={loadUserBonds}
            disabled={isLoading}
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] h-11 w-11 md:h-12 md:w-12 p-0 flex-shrink-0"
            title="Refresh"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>

        {/* Dropdowns row - all inline horizontally */}
        <div className="flex flex-row gap-2 md:gap-2 w-full">
          <div className="flex-1 space-y-1 md:space-y-3 min-w-0">
            <Label className="text-xs md:text-sm font-medium hidden sm:block">Sort By</Label>
            <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
              <SelectTrigger className="h-11 md:h-12 text-sm md:text-base w-full dark:bg-[#141414] border border-black/10 dark:border-white/10">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="maturity" className="h-11 md:h-12 text-sm md:text-base">Maturity Date</SelectItem>
                <SelectItem value="discount" className="h-11 md:h-12 text-sm md:text-base">Discount %</SelectItem>
                <SelectItem value="value" className="h-11 md:h-12 text-sm md:text-base">Face Value</SelectItem>
                <SelectItem value="created" className="h-11 md:h-12 text-sm md:text-base">Created Date</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-1 md:space-y-3 min-w-0">
            <Label className="text-xs md:text-sm font-medium hidden sm:block">Bond Type</Label>
            <Select value={filterType} onValueChange={(value: any) => setFilterType(value)}>
              <SelectTrigger className="h-11 md:h-12 text-sm md:text-base w-full dark:bg-[#141414] border border-black/10 dark:border-white/10">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="h-11 md:h-12 text-sm md:text-base">All Types</SelectItem>
                <SelectItem value="short-term" className="h-11 md:h-12 text-sm md:text-base">Short-term</SelectItem>
                <SelectItem value="mid-term" className="h-11 md:h-12 text-sm md:text-base">Mid-term</SelectItem>
                <SelectItem value="long-term" className="h-11 md:h-12 text-sm md:text-base">Long-term</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-1 md:space-y-3 min-w-0">
            <Label className="text-xs md:text-sm font-medium hidden sm:block">Status</Label>
            <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
              <SelectTrigger className="h-11 md:h-12 text-sm md:text-base w-full dark:bg-[#141414] border border-black/10 dark:border-white/10">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="h-11 md:h-12 text-sm md:text-base">All Status</SelectItem>
                <SelectItem value="active" className="h-11 md:h-12 text-sm md:text-base">Active</SelectItem>
                <SelectItem value="matured" className="h-11 md:h-12 text-sm md:text-base">Matured</SelectItem>
                <SelectItem value="redeemed" className="h-11 md:h-12 text-sm md:text-base">Redeemed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {filteredBonds.length} bond{filteredBonds.length !== 1 ? 's' : ''} found
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Filter className="w-4 h-4" />
          <span>Filtered results</span>
        </div>
      </div>

      {/* Batch Actions */}
      {redeemableBonds.length > 0 && (
        <Card className="bg-green-50 dark:bg-green-900/20 border-black/10 dark:border-white/10">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selectedBonds.length === redeemableBonds.length}
                  onCheckedChange={handleSelectAll}
                />
                <div>
                  <p className="font-medium text-green-900 dark:text-green-100">
                    {redeemableBonds.length} matured bond{redeemableBonds.length !== 1 ? 's' : ''} ready for redemption
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Double-click or double-tap bonds to select them, or use "Select All" to redeem all matured bonds
                  </p>
                </div>
              </div>
              <Button
                onClick={handleRedeemBonds}
                disabled={selectedBonds.length === 0 || isRedeeming}
                className="bg-green-600 hover:bg-green-700 h-12 text-base w-full sm:w-auto"
              >
                {isRedeeming ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Redeeming...
                  </>
                ) : (
                  <>
                    <DollarSign className="w-4 h-4 mr-2" />
                    Redeem Selected ({selectedBonds.length})
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bonds List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading your bonds...</span>
          </div>
        </div>
      ) : filteredBonds.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-muted rounded-full">
                <Wallet className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">No bonds found</h3>
                <p className="text-muted-foreground">
                  You don't have any bonds matching your criteria
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBonds.map((bond) => {
            const isMatured = bond.maturityDate < Date.now() && !bond.isRedeemed;
            const canRedeem = isMatured;
            const isSelected = selectedBonds.includes(bond.id);
            
            return (
              <BondCard
                key={bond.id}
                bond={bond}
                onViewDetails={handleViewDetails}
                onRedeem={handleRedeem}
                showRedeemButton={canRedeem}
                canRedeem={canRedeem}
                isMyBonds={true}
                isSelected={isSelected}
                onToggleSelect={(b) => handleBondSelection(b.id, !isSelected)}
                canSelect={canRedeem}
              />
            );
          })}
        </div>
      )}

      {/* Bond Viewer Modal */}
      <BondViewer
        bond={selectedBond}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        onRedeem={handleRedeem}
        canRedeem={selectedBond ? getBondStatus(selectedBond as any).label === 'Matured' && !selectedBond.isRedeemed : false}
      />
    </div>
  );
};

export default BondManagement;
