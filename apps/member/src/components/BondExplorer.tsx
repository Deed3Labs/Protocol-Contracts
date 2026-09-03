import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  SortAsc, 
  SortDesc, 
  RefreshCw,
  Loader2,
  Filter
} from 'lucide-react';
import BondCard from './BondCard';
import type { Bond } from './BondCard';
import BondViewer from './BondViewer';
import MakeOfferModal from './MakeOfferModal';

interface BondExplorerProps {
  onStatsUpdate: (stats: any) => void;
}

interface BondInfo extends Bond {
  tokenName: string;
  purchasePrice: string;
  bondType: 'short-term' | 'mid-term' | 'long-term';
}

const BondExplorer: React.FC<BondExplorerProps> = ({ onStatsUpdate }) => {
  const [bonds, setBonds] = useState<BondInfo[]>([]);
  const [filteredBonds, setFilteredBonds] = useState<BondInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBond, setSelectedBond] = useState<Bond | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [offerBond, setOfferBond] = useState<Bond | null>(null);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'maturity' | 'discount' | 'value' | 'created'>('maturity');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType] = useState<'all' | 'short-term' | 'mid-term' | 'long-term'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'matured' | 'redeemed'>('all');

  const handleViewDetails = (bond: BondInfo) => {
    setSelectedBond(bond);
    setIsViewerOpen(true);
  };

  const handleRedeem = (bond: BondInfo) => {
    // Mock redeem functionality
    console.log('Redeeming bond:', bond.id);
    // In real app, this would call the contract
  };

  const handleMakeOffer = (bond: BondInfo) => {
    setOfferBond(bond);
    setIsOfferModalOpen(true);
  };

  const handleCloseOfferModal = () => {
    setIsOfferModalOpen(false);
    setOfferBond(null);
  };

  // Mock data - in real app, this would come from contract calls
  const mockBonds: BondInfo[] = [
    {
      id: '1',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenAddress: '0xA0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '10000.00',
      purchasePrice: '9350.00',
      requiredDeposit: '9350.00',
      discountAmount: '650.00',
      discountPercentage: 6.5,
      maturityDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
      isRedeemed: false,
      creator: '0x1234...5678',
      createdAt: Math.floor(Date.now() / 1000) - (5 * 24 * 60 * 60),
      bondType: 'short-term'
    },
    {
      id: '2',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenAddress: '0xB0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '50000.00',
      purchasePrice: '43750.00',
      requiredDeposit: '43750.00',
      discountAmount: '6250.00',
      discountPercentage: 12.5,
      maturityDate: Math.floor(Date.now() / 1000) + (5 * 365 * 24 * 60 * 60), // 5 years
      isRedeemed: false,
      creator: '0x2345...6789',
      createdAt: Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60),
      bondType: 'mid-term'
    },
    {
      id: '3',
      tokenSymbol: 'USDT',
      tokenName: 'Tether USD',
      tokenAddress: '0xC0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '100000.00',
      purchasePrice: '65000.00',
      requiredDeposit: '65000.00',
      discountAmount: '35000.00',
      discountPercentage: 35.0,
      maturityDate: Math.floor(Date.now() / 1000) + (20 * 365 * 24 * 60 * 60), // 20 years
      isRedeemed: false,
      creator: '0x3456...7890',
      createdAt: Math.floor(Date.now() / 1000) - (15 * 24 * 60 * 60),
      bondType: 'long-term'
    },
    {
      id: '4',
      tokenSymbol: 'DAI',
      tokenName: 'Dai Stablecoin',
      tokenAddress: '0xD0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '25000.00',
      purchasePrice: '25000.00',
      requiredDeposit: '25000.00',
      discountAmount: '0.00',
      discountPercentage: 0.0,
      maturityDate: Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60), // Matured
      isRedeemed: true,
      creator: '0x4567...8901',
      createdAt: Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60),
      bondType: 'short-term'
    },
    {
      id: '5',
      tokenSymbol: 'WETH',
      tokenName: 'Wrapped Ether',
      tokenAddress: '0xE0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '5000.00',
      purchasePrice: '4750.00',
      requiredDeposit: '4750.00',
      discountAmount: '250.00',
      discountPercentage: 5.0,
      maturityDate: Math.floor(Date.now() / 1000) + (6 * 30 * 24 * 60 * 60), // 6 months
      isRedeemed: false,
      creator: '0x5678...9012',
      createdAt: Math.floor(Date.now() / 1000) - (2 * 24 * 60 * 60),
      bondType: 'short-term'
    },
    {
      id: '6',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenAddress: '0xF0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      faceValue: '1000000.00',
      purchasePrice: '500000.00',
      requiredDeposit: '500000.00',
      discountAmount: '500000.00',
      discountPercentage: 50.0,
      maturityDate: Math.floor(Date.now() / 1000) + (30 * 365 * 24 * 60 * 60), // 30 years
      isRedeemed: false,
      creator: '0x6789...0123',
      createdAt: Math.floor(Date.now() / 1000) - (1 * 24 * 60 * 60),
      bondType: 'long-term'
    }
  ];

  useEffect(() => {
    loadBonds();
  }, []);

  useEffect(() => {
    filterAndSortBonds();
  }, [bonds, searchTerm, sortBy, sortOrder, filterType, filterStatus]);

  const loadBonds = async () => {
    setIsLoading(true);
    try {
      // Mock API call - in real app, this would fetch from contracts
      await new Promise(resolve => setTimeout(resolve, 1000));
      setBonds(mockBonds);
      
      // Update stats
      const totalBonds = mockBonds.length;
      const totalValue = mockBonds.reduce((sum, bond) => sum + parseFloat(bond.faceValue), 0);
      const activeBonds = mockBonds.filter(bond => !bond.isRedeemed).length;
      const maturedBonds = mockBonds.filter(bond => bond.maturityDate < Date.now() && !bond.isRedeemed).length;
      
      onStatsUpdate({
        totalBonds,
        totalValue: totalValue.toFixed(2),
        activeBonds,
        maturedBonds
      });
    } catch (error) {
      console.error('Failed to load bonds:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterAndSortBonds = () => {
    let filtered = [...bonds];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(bond =>
        bond.tokenSymbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bond.tokenName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bond.creator.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(bond => bond.bondType === filterType);
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

  const getBondStatus = (bond: BondInfo) => {
    const now = Date.now();
    if (bond.isRedeemed) return { label: 'Redeemed', color: 'bg-gray-500' };
    if (bond.maturityDate < now) return { label: 'Matured', color: 'bg-green-500' };
    return { label: 'Active', color: 'bg-blue-500' };
  };


  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="space-y-3 md:space-y-6">
        {/* Search row with buttons inline */}
        <div className="flex items-end gap-2 sm:gap-2">
          <div className="flex-1 relative">
            <Label htmlFor="search" className="hidden sm:block text-sm font-medium mb-2">
              Search Bonds
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                id="search"
                placeholder="Search by token, creator, or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 md:h-12 text-base dark:bg-[#141414] border border-black/10 dark:border-white/10"
              />
            </div>
          </div>
          
          <Button
            variant="outline"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="h-11 w-11 md:h-12 md:w-12 p-0 flex-shrink-0 bg-white dark:bg-[#141414] border border-black/10 dark:border-white/10"
            title={`Sort ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
          >
            {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
          </Button>
          
          <Button
            variant="outline"
            onClick={loadBonds}
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

      {/* Bonds Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading bonds...</span>
          </div>
        </div>
      ) : filteredBonds.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-muted rounded-full">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">No bonds found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search criteria or filters
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBonds.map((bond) => {
            const status = getBondStatus(bond);
            const canRedeem = status.label === 'Matured' && !bond.isRedeemed;
            
            return (
              <BondCard
                key={bond.id}
                bond={bond}
                onViewDetails={handleViewDetails}
                onRedeem={handleRedeem}
                onMakeOffer={handleMakeOffer}
                showRedeemButton={canRedeem}
                canRedeem={canRedeem}
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

      {/* Make Offer Modal */}
      {offerBond && (
        <MakeOfferModal
          isOpen={isOfferModalOpen}
          onClose={handleCloseOfferModal}
          assetType="bond"
          assetId={offerBond.id}
          assetName={`${offerBond.tokenSymbol} Bond`}
        />
      )}
    </div>
  );
};

export default BondExplorer;
