import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  DollarSign, 
  TrendingUp, 
  Clock,
  User,
  Hash,
  ExternalLink,
  Copy,
  CheckCircle,
  BarChart3,
  History,
  Info,
  RefreshCw,
  Maximize2,
  Minimize2,
  X,
  MessageCircle
} from 'lucide-react';
import type { Bond } from './BondCard';
import MessageOwnerModal from './MessageOwnerModal';

interface BondViewerProps {
  bond: Bond | any | null; // Accept any bond type that extends Bond
  isOpen: boolean;
  onClose: () => void;
  onRedeem?: (bond: any) => void;
  canRedeem?: boolean;
}

interface OwnerHistoryEntry {
  address: string;
  timestamp: number;
  action: 'created' | 'transferred' | 'redeemed';
  transactionHash: string;
}


const BondViewer: React.FC<BondViewerProps> = ({ 
  bond, 
  isOpen, 
  onClose, 
  onRedeem,
  canRedeem = false 
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryEntry[]>([]);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isFullPage, setIsFullPage] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [offers, setOffers] = useState<Array<{
    id: string;
    offerAmount: string;
    bidder: string;
    timestamp: number;
    status: 'open' | 'accepted' | 'rejected' | 'expired';
    message?: string;
    tokenSymbol: string;
  }>>([]);
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [newOfferNote, setNewOfferNote] = useState('');
  const [selectedOfferToken, setSelectedOfferToken] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Simple token registry for offers (icons + symbols)
  const offerTokens: Array<{ symbol: string; iconUrl: string }> = [
    { symbol: 'USDC', iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
    { symbol: 'USDT', iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
    { symbol: 'DAI',  iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png' },
    { symbol: 'USDS', iconUrl: 'https://basescan.org/token/images/skyusds_32.svg' },
    { symbol: 'WBTC', iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png' },
    { symbol: 'WETH', iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png' },
  ];

  // Update current time every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (bond && isOpen) {
      // Mock data - in real app, this would come from contract calls
      setOwnerHistory([
        {
          address: bond.creator,
          timestamp: bond.createdAt,
          action: 'created',
          transactionHash: '0x1234...5678'
        }
      ]);
      
      // No-op for now; keep owner history up to date
      // Seed mock offers for this session
      setOffers([
        {
          id: 'offer-1',
          offerAmount: (Number(bond.requiredDeposit) * 0.98).toFixed(2),
          bidder: '0xA1b2...C3d4',
          timestamp: Date.now() - 1000 * 60 * 60 * 24 * 2,
          status: 'open',
          message: 'Ready to settle this week.',
          tokenSymbol: bond.tokenSymbol
        },
        {
          id: 'offer-2',
          offerAmount: (Number(bond.requiredDeposit) * 0.96).toFixed(2),
          bidder: '0x9Efa...71B2',
          timestamp: Date.now() - 1000 * 60 * 60 * 24 * 7,
          status: 'rejected',
          tokenSymbol: bond.tokenSymbol
        }
      ]);

      // Default offer token to the bond's token symbol if available
      setSelectedOfferToken(bond.tokenSymbol || 'USDC');
    }
  }, [bond, isOpen]);

  const tokenUsdRates: Record<string, number> = {
    USDC: 1,
    USDT: 1,
    DAI: 1,
    WETH: 3200,
    WBTC: 65000,
  };
  const currentUsdValue = Number(bond?.currentValue || bond?.faceValue || '0') * (tokenUsdRates[bond?.tokenSymbol] ?? 1);
  const sparkPoints = React.useMemo(() => {
    if (!bond) return [0];
    const n = 24;
    const base = currentUsdValue || 1000;
    const pts: number[] = [];
    let v = base * 0.98;
    for (let i = 0; i < n; i++) {
      const drift = (Math.random() - 0.5) * 0.02;
      v = Math.max(base * 0.9, Math.min(base * 1.1, v * (1 + drift)));
      pts.push(v);
    }
    return pts;
  }, [bond?.id, currentUsdValue]);

  if (!bond) return null;

  // Format countdown timer - show 3-4 key times based on timeframe (same as BondCard)
  const formatCountdown = (ms: number): string => {
    if (ms <= 0) return '0s';
    
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    
    const parts: string[] = [];
    
    // If more than a year: show years, months, days, hours
    if (totalDays >= 365) {
      const years = Math.floor(totalDays / 365);
      const daysAfterYears = totalDays % 365;
      const months = Math.floor(daysAfterYears / 30);
      const daysAfterMonths = daysAfterYears % 30;
      const hours = totalHours % 24;
      
      if (years > 0) parts.push(`${years}y`);
      if (months > 0) parts.push(`${months}mo`);
      if (daysAfterMonths > 0) parts.push(`${daysAfterMonths}d`);
      if (hours > 0) parts.push(`${hours}h`);
    }
    // If more than a month: show months, days, hours, minutes
    else if (totalDays >= 30) {
      const months = Math.floor(totalDays / 30);
      const daysAfterMonths = totalDays % 30;
      const hours = totalHours % 24;
      const minutes = totalMinutes % 60;
      
      if (months > 0) parts.push(`${months}mo`);
      if (daysAfterMonths > 0) parts.push(`${daysAfterMonths}d`);
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
    }
    // If less than a month: show days, hours, minutes, seconds
    else {
      const hours = totalHours % 24;
      const minutes = totalMinutes % 60;
      const seconds = totalSeconds % 60;
      
      if (totalDays > 0) parts.push(`${totalDays}d`);
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
      if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    }
    
    // Return up to 4 parts with "·" separator
    return parts.slice(0, 4).join(' · ') || '0s';
  };

  const getStatusInfo = () => {
    if (bond.isRedeemed) {
      return { 
        label: 'Redeemed', 
        variant: 'secondary' as const, 
        color: 'text-gray-500',
        className: 'border border-black/10 dark:border-white/10'
      };
    }
    
    const maturityTime = bond.maturityDate * 1000;
    const remaining = maturityTime - currentTime;
    
    if (remaining <= 0) {
      return { 
        label: 'Matured', 
        variant: 'outline' as const, 
        color: 'text-red-600',
        className: 'border-red-400 text-red-600 dark:text-red-400'
      };
    }
    
    const countdown = formatCountdown(remaining);
    
    return { 
      label: countdown, 
      variant: 'outline' as const, 
      color: 'text-green-600',
      className: 'border-green-400 text-green-600 dark:text-green-400'
    };
  };

  const status = getStatusInfo();
  const maturityProgress = bond.isRedeemed ? 100 : 
    Math.max(0, Math.min(100, ((Date.now() - bond.createdAt * 1000) / (bond.maturityDate * 1000 - bond.createdAt * 1000)) * 100));

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(type);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
  
  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refresh of data (e.g., refetch from chain)
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  const toggleFullPage = () => setIsFullPage((v) => !v);
  const openMessage = () => setIsMessageModalOpen(true);
  const closeMessage = () => setIsMessageModalOpen(false);
  const handleSubmitOffer = () => {
    if (!newOfferAmount || !selectedOfferToken) return;
    const clean = newOfferAmount.trim();
    if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(clean)) return;
    setOffers((prev) => [{
      id: `offer-${Date.now()}`,
      offerAmount: clean,
      bidder: 'You',
      timestamp: Date.now(),
      status: 'open',
      message: newOfferNote.trim() || undefined,
      tokenSymbol: selectedOfferToken
    }, ...prev]);
    setNewOfferAmount('');
    setNewOfferNote('');
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isFullPage ? 'max-w-[95vw] md:max-w-[95vw] max-h-[95vh]' : 'max-w-4xl max-h-[90vh]'} overflow-y-auto`}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-3">
              <DollarSign className="w-6 h-6" />
              <span>{bond.tokenSymbol} Bond Details</span>
              <Badge variant={status.variant} className={`ml-2 text-xs ${status.className || ''}`}>
                {status.label}
              </Badge>
            </DialogTitle>
            <div className="flex items-center space-x-1 md:space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullPage}
                className="hidden md:block text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title={isFullPage ? 'Minimize' : 'Expand'}
              >
                {isFullPage ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Close"
              >
                <X className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={openMessage}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Message"
              >
                <MessageCircle className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-gray-100 dark:bg-[#0e0e0e] border border-black/10 dark:border-white/10">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              Overview
            </TabsTrigger>
            <TabsTrigger value="financials" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              Financials
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              History
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-white dark:data-[state=active]:bg-[#141414]">
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 pt-4 md:pt-6">
            {/* Bond Information */}
            <Card className="dark:bg-[#0e0e0e]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  Bond Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Bond ID</label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{bond.id}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(bond.id, 'id')}
                        className="h-8 w-8 p-0"
                      >
                        {copiedAddress === 'id' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Token Address</label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{formatAddress(bond.tokenAddress)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(bond.tokenAddress, 'token')}
                        className="h-8 w-8 p-0"
                      >
                        {copiedAddress === 'token' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Creator</label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{formatAddress(bond.creator)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(bond.creator, 'creator')}
                        className="h-8 w-8 p-0"
                      >
                        {copiedAddress === 'creator' ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Created</label>
                    <p className="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{new Date(bond.createdAt * 1000).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Maturity Progress */}
            <Card className="dark:bg-[#0e0e0e]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Maturity Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span>Progress to Maturity</span>
                    <span>{maturityProgress.toFixed(1)}%</span>
                  </div>
                  <Progress value={maturityProgress} className="h-2" />
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span>Created: {new Date(bond.createdAt * 1000).toLocaleDateString()}</span>
                    <span>Matures: {new Date(bond.maturityDate * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Financials Tab */}
          <TabsContent value="financials" className="space-y-6 pt-4 md:pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Key Metrics */}
              <Card className="dark:bg-[#0e0e0e]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Key Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-black/10 dark:border-white/10">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Face Value</span>
                      <span className="font-semibold text-lg">{bond.faceValue} {bond.tokenSymbol}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-black/10 dark:border-white/10">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Purchase Price</span>
                      <span className="font-semibold text-lg text-blue-600">{bond.requiredDeposit} {bond.tokenSymbol}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-black/10 dark:border-white/10">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Discount Amount</span>
                      <span className="font-semibold text-lg text-green-600">{bond.discountAmount} {bond.tokenSymbol}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Discount Percentage</span>
                      <span className="font-semibold text-lg text-green-600">{bond.discountPercentage.toFixed(2)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Current Value */}
              <Card className="dark:bg-[#0e0e0e]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Current Value
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* USD Value */}
                  <div className="text-center space-y-1">
                    <div className="text-3xl font-bold text-gray-900 dark:text-white">
                      ${currentUsdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      ≈ {(bond.currentValue || bond.faceValue)} {bond.tokenSymbol} @ ${tokenUsdRates[bond.tokenSymbol] ?? 1} / {bond.tokenSymbol}
                    </p>
                  </div>

                  {/* Sparkline visualization */}
                  <div className="h-24 w-full">
                    <svg viewBox="0 0 240 80" className="w-full h-full">
                      <defs>
                        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.6" />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {(() => {
                        const xs = sparkPoints.map((_, i) => (i / (sparkPoints.length - 1)) * 240);
                        const min = Math.min(...sparkPoints);
                        const max = Math.max(...sparkPoints);
                        const ys = sparkPoints.map(v => 80 - ((v - min) / Math.max(1, (max - min))) * 70 - 5);
                        const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(' ');
                        const area = `${d} L 240 80 L 0 80 Z`;
                        return (
                          <g>
                            <path d={area} fill="url(#spark)" />
                            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" />
                          </g>
                        );
                      })()}
                    </svg>
                  </div>

                  {/* Context */}
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span>24h trend (mock)</span>
                    <span>{bond.isRedeemed ? 'Redeemed' : 'At Maturity'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Offers: Make an offer + Offer history */}
            <Card className="dark:bg-[#0e0e0e]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Offers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Make an offer */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Make an Offer</label>
                  <div className="flex flex-col sm:flex-row gap-3 mt-2">
                    {/* Token select */}
                    <Select value={selectedOfferToken} onValueChange={setSelectedOfferToken}>
                      <SelectTrigger className="w-34 h-12 min-w-0 flex items-center">
                        <SelectValue placeholder="Token" />
                      </SelectTrigger>
                      <SelectContent>
                        {offerTokens.map((t) => (
                          <SelectItem key={t.symbol} value={t.symbol} className="h-11">
                            <div className="flex items-center gap-2">
                              <img src={t.iconUrl} alt={t.symbol} className="w-5 h-5 rounded-full" />
                              <span>{t.symbol}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.000001"
                      placeholder={`Amount in ${selectedOfferToken || bond.tokenSymbol}`}
                      value={newOfferAmount}
                      onChange={(e) => setNewOfferAmount(e.target.value)}
                      className="flex-1 h-11 px-4 rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white min-w-0"
                    />
                    <Button className="h-11 w-32 px-4 whitespace-nowrap border border-black/10 dark:border-white/10" onClick={handleSubmitOffer} disabled={!newOfferAmount}>
                      Submit Offer
                    </Button>
                  </div>
                  <textarea
                    placeholder="Optional note to the bondholder"
                    value={newOfferNote}
                    onChange={(e) => setNewOfferNote(e.target.value)}
                    className="w-full min-h-[80px] rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white p-3"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-400">Offers are off-chain drafts for now; contract integration coming soon.</p>
                </div>

                {/* Offer history */}
                <div className="space-y-4">
                  <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Offer History</label>
                  {offers.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No offers yet.</p>
                  ) : (
                    <div className="space-y-3 mt-2">
                      {offers.map((o) => {
                        const tokenInfo = offerTokens.find(t => t.symbol === o.tokenSymbol);
                        return (
                          <div key={o.id} className="flex items-center justify-between border rounded-md px-4 py-3 border-black/10 dark:border-white/10">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                {tokenInfo && (
                                  <img src={tokenInfo.iconUrl} alt={o.tokenSymbol} className="w-5 h-5 rounded-full" />
                                )}
                                <span>{o.offerAmount} {o.tokenSymbol}</span>
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {o.bidder} · {new Date(o.timestamp).toLocaleString()}
                              </div>
                              {o.message && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">"{o.message}"</div>
                              )}
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                o.status === 'open'
                                  ? 'border-green-400 text-green-600 dark:text-green-400'
                                  : o.status === 'accepted'
                                  ? 'border-blue-400 text-blue-600 dark:text-blue-400'
                                  : o.status === 'rejected'
                                  ? 'border-red-400 text-red-600 dark:text-red-400'
                                  : 'border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400'
                              }
                            >
                              {o.status}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            {canRedeem && !bond.isRedeemed && (
              <Card className="dark:bg-[#0e0e0e]">
                <CardContent className="pt-6">
                  <Button 
                    onClick={() => onRedeem?.(bond)}
                    className="w-full h-12 text-base"
                    size="lg"
                  >
                    <DollarSign className="w-5 h-5 mr-2" />
                    Redeem Bond
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-6 pt-4 md:pt-6">
            <Card className="dark:bg-[#0e0e0e]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" />
                  Ownership History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {ownerHistory.map((entry, index) => (
                    <div key={index} className="flex items-center gap-4 p-3 rounded-lg bg-white dark:bg-[#141414] border border-black/10 dark:border-white/10">
                      <div className="flex-shrink-0">
                        {entry.action === 'created' && <User className="w-5 h-5 text-blue-600" />}
                        {entry.action === 'transferred' && <Hash className="w-5 h-5 text-yellow-600" />}
                        {entry.action === 'redeemed' && <CheckCircle className="w-5 h-5 text-green-600" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}</span>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            by {formatAddress(entry.address)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(entry.transactionHash, `tx-${index}`)}
                        className="h-6 w-6 p-0"
                      >
                        {copiedAddress === `tx-${index}` ? <CheckCircle className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6 pt-4 md:pt-6">
            <Card className="dark:bg-[#0e0e0e]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Token Price Chart
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Price chart for {bond.tokenSymbol} (Last 30 days)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      Chart implementation would go here
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    {/* Message Owner Modal */}
    <MessageOwnerModal
      isOpen={isMessageModalOpen}
      onClose={closeMessage}
      ownerAddress={bond.creator}
      tokenId={`${bond.tokenSymbol}-BB-${bond.id}`}
      assetType={`${bond.tokenSymbol} Bond (${bond.discountPercentage.toFixed(1)}% discount, ${bond.faceValue} ${bond.tokenSymbol} face value)`}
      isBond={true}
    />
    </>
  );
};

export default BondViewer;
