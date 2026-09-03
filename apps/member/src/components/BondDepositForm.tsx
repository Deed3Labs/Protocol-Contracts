import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Calculator, 
  DollarSign, 
  AlertCircle,
  CheckCircle,
  Loader2,
  Info,
  CalendarIcon
} from 'lucide-react';

interface BondDepositFormProps {
  onStatsUpdate: (stats: any) => void;
}

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  iconUrl?: string;
  usdPrice?: number;
}

interface BondCalculation {
  requiredDeposit: string;
  discountAmount: string;
  discountPercentage: number;
  purchasePrice: string;
  faceValue: string;
  maturityDate: number;
}

const BondDepositForm: React.FC<BondDepositFormProps> = ({ onStatsUpdate }) => {
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [faceValue, setFaceValue] = useState<string>('');
  const [maturityDate, setMaturityDate] = useState<Date | undefined>(undefined);
  const [discountPercentage, setDiscountPercentage] = useState<string>('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [calculation, setCalculation] = useState<BondCalculation | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Mock token data - in real app, this would come from contract calls
  const [tokens] = useState<TokenInfo[]>([
    {
      address: '0xA0b86a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: '1000.00',
      iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
      usdPrice: 1.0
    },
    {
      address: '0xB1c97a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      balance: '500.00',
      iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
      usdPrice: 1.0
    },
    {
      address: '0xC2d88a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      balance: '2500.00',
      iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
      usdPrice: 1.0
    },
    {
      address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc',
      symbol: 'USDS',
      name: 'Sky Dollar',
      decimals: 18,
      balance: '3000.00',
      iconUrl: 'https://basescan.org/token/images/skyusds_32.svg',
      usdPrice: 1.0
    },
    {
      address: '0xD3e99a33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      balance: '0.5',
      iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
      usdPrice: 67000.0
    },
    {
      address: '0xE4f0aa33E6441b8C4C8C0C4C0C4C0C4C0C4C0C4C',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      balance: '2.5',
      iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
      usdPrice: 3500.0
    }
  ]);

  // Calculate bond parameters when inputs change
  useEffect(() => {
    // Only auto-calculate discount percentage when maturity date changes
    if (maturityDate) {
      const currentDate = new Date();
      if (maturityDate > currentDate) {
        const timeDiff = maturityDate.getTime() - currentDate.getTime();
        const maturityDaysNum = Math.ceil(timeDiff / (1000 * 3600 * 24));
        const maxDiscount = Math.min(50, (maturityDaysNum / (365 * 30)) * 50);
        setDiscountPercentage(maxDiscount.toFixed(2));
      }
    }
  }, [maturityDate]);

  // Show calculation section when user has entered basic info
  const shouldShowCalculation = selectedToken && faceValue && maturityDate;

  const calculateBond = async () => {
    if (!selectedToken || !faceValue || !maturityDate) return;

    setIsCalculating(true);
    setError('');

    try {
      // Mock calculation - in real app, this would call contract functions
      const faceValueNum = parseFloat(faceValue);
      const currentDate = new Date();
      
      if (faceValueNum <= 0) {
        setError('Face value must be positive');
        return;
      }

      if (maturityDate <= currentDate) {
        setError('Maturity date must be in the future');
        return;
      }

      // Use the discount percentage from the input field
      const discountPct = parseFloat(discountPercentage) || 0;
      
      const discountAmount = (faceValueNum * discountPct) / 100;
      const requiredDeposit = faceValueNum - discountAmount;
      const maturityTimestamp = dateToUnixTimestamp(maturityDate);

      setCalculation({
        requiredDeposit: requiredDeposit.toFixed(6),
        discountAmount: discountAmount.toFixed(6),
        discountPercentage: discountPct,
        purchasePrice: requiredDeposit.toFixed(6),
        faceValue: faceValueNum.toFixed(6),
        maturityDate: maturityTimestamp
      });
    } catch (err) {
      setError('Failed to calculate bond parameters');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleDeposit = async () => {
    if (!calculation || !selectedToken) return;

    setIsDepositing(true);
    setError('');
    setSuccess('');

    try {
      // Mock deposit - in real app, this would call the BurnerBondDeposit contract
      // The contract expects: makeDeposit(tokenAddress, faceValue, maturityDate, discountPercentage)
      // where maturityDate is a Unix timestamp in seconds
      const maturityTimestamp = dateToUnixTimestamp(maturityDate!);
      
      // In real implementation, this would be:
      // await burnerBondDeposit.makeDeposit(
      //   selectedToken,
      //   ethers.utils.parseUnits(calculation.faceValue, selectedTokenInfo?.decimals || 6),
      //   maturityTimestamp,
      //   Math.floor(calculation.discountPercentage * 100) // Convert to basis points
      // );
      
      console.log('Bond creation parameters:', {
        tokenAddress: selectedToken,
        faceValue: calculation.faceValue,
        maturityTimestamp,
        discountPercentage: Math.floor(calculation.discountPercentage * 100)
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setSuccess('Bond created successfully!');
      onStatsUpdate({
        totalBonds: (prev: number) => prev + 1,
        totalValue: (prev: string) => (parseFloat(prev) + parseFloat(calculation.faceValue)).toFixed(2)
      });
      
      // Reset form
      setFaceValue('');
      setMaturityDate(undefined);
      setDiscountPercentage('');
      setCalculation(null);
    } catch (err) {
      setError('Failed to create bond. Please try again.');
    } finally {
      setIsDepositing(false);
    }
  };

  const selectedTokenInfo = tokens.find(t => t.address === selectedToken);

  // Helper function to get minimum allowed date (tomorrow)
  const getMinDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  };

  // Helper function to get maximum allowed date (30 years from now)
  const getMaxDate = () => {
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 30);
    return maxDate;
  };

  // Helper function to convert date to Unix timestamp (seconds)
  const dateToUnixTimestamp = (date: Date): number => {
    return Math.floor(date.getTime() / 1000);
  };

  return (
    <div className="space-y-8">
      {/* Token Selection */}
      <div className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="token-select" className="text-sm font-medium">
            Select Token
          </Label>
          <Select value={selectedToken} onValueChange={setSelectedToken}>
            <SelectTrigger className="w-full h-12 text-base dark:bg-[#141414] border border-black/10 dark:border-white/10">
              {selectedTokenInfo ? (
                <div className="flex items-center gap-2">
                  {selectedTokenInfo.iconUrl ? (
                    <img src={selectedTokenInfo.iconUrl} alt={selectedTokenInfo.symbol} className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">
                      {selectedTokenInfo.symbol.substring(0, 2)}
                    </div>
                  )}
                  <span className="font-medium">{selectedTokenInfo.symbol}</span>
                </div>
              ) : (
                <SelectValue placeholder="Choose a token to deposit" />
              )}
            </SelectTrigger>
            <SelectContent className="dark:bg-[#141414]">
              {tokens.map((token) => (
                <SelectItem key={token.address} value={token.address} className="h-12 text-base">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      {token.iconUrl ? (
                        <img src={token.iconUrl} alt={token.symbol} className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">
                          {token.symbol.substring(0, 2)}
                        </div>
                      )}
                      <span className="font-medium">{token.symbol}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{token.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground ml-2">
                      Balance: {token.balance}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedTokenInfo && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Info className="w-4 h-4" />
          <span>Balance: {selectedTokenInfo.balance} {selectedTokenInfo.symbol}</span>
        </div>
        )}
      </div>

      {/* Bond Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <Label htmlFor="face-value" className="text-sm font-medium">
            Face Value ({selectedTokenInfo?.symbol || 'Token'})
          </Label>
          <Input
            id="face-value"
            type="number"
            placeholder="1000.00"
            value={faceValue}
            onChange={(e) => setFaceValue(e.target.value)}
            className="h-12 text-base dark:bg-[#141414] border border-black/10 dark:border-white/10"
          />
          {selectedTokenInfo && faceValue && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              ≈ ${(parseFloat(faceValue || '0') * (selectedTokenInfo.usdPrice || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label htmlFor="maturity-date" className="text-sm font-medium">
            Maturity Date
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full h-12 text-base justify-start text-left font-normal dark:bg-[#141414] border border-black/10 dark:border-white/10"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {maturityDate ? maturityDate.toLocaleDateString() : "Select maturity date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={maturityDate}
                onSelect={setMaturityDate}
                disabled={(date) => date < getMinDate() || date > getMaxDate()}
                className="rounded-md border shadow-sm w-[320px]"
                captionLayout="dropdown"
                fromYear={new Date().getFullYear()}
                toYear={new Date().getFullYear() + 30}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Select a date between tomorrow and 30 years from now
          </p>
        </div>
      </div>

      {/* Discount Percentage */}
      <div className="space-y-3">
        <Label htmlFor="discount" className="text-sm font-medium">
          Discount Percentage (%)
        </Label>
        <Input
          id="discount"
          type="number"
          placeholder="Auto-calculated"
          value={discountPercentage}
          onChange={(e) => setDiscountPercentage(e.target.value)}
          className="h-12 text-base dark:bg-[#141414] border border-black/10 dark:border-white/10"
          max="50"
          min="0"
          step="0.01"
        />
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Automatically calculated based on maturity period (up to 50% for 30 years)
        </p>
      </div>

      {/* Calculation Results */}
      {shouldShowCalculation && (
        <>
          {isCalculating && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Calculating bond parameters...</span>
            </div>
          )}

          {calculation && !isCalculating && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Bond Calculation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-600 dark:text-gray-400">Face Value</p>
                <p className="font-semibold">{calculation.faceValue} {selectedTokenInfo?.symbol}</p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">Discount</p>
                <p className="font-semibold text-green-600">
                  {calculation.discountPercentage.toFixed(2)}% ({calculation.discountAmount} {selectedTokenInfo?.symbol})
                </p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">Required Deposit</p>
                <p className="font-semibold text-blue-600">
                  {calculation.requiredDeposit} {selectedTokenInfo?.symbol}
                </p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">Maturity Date</p>
                <p className="font-semibold">
                  {new Date(calculation.maturityDate * 1000).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Discount Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Discount Level</span>
                <span>{calculation.discountPercentage.toFixed(1)}%</span>
              </div>
              <Progress 
                value={calculation.discountPercentage} 
                className="h-2"
                max={30}
              />
            </div>
          </CardContent>
        </Card>
          )}

          {!calculation && !isCalculating && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Calculator className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Click "Calculate" to see bond parameters</p>
            </div>
          )}
        </>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
          <span className="text-sm text-green-700 dark:text-green-300">{success}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          onClick={calculateBond}
          disabled={!selectedToken || !faceValue || !maturityDate || isCalculating}
          variant="outline"
          className="flex-1 h-12 w-12 md:w-auto md:px-4 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] flex-shrink-0"
        >
          <Calculator className={`w-4 h-4 md:mr-2 ${isCalculating ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">Calculate</span>
        </Button>
        
        <Button
          onClick={handleDeposit}
          disabled={!calculation || isDepositing}
          className="flex-1 h-12 text-base border-black/10 dark:border-white/10"
        >
          {isDepositing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Bond...
            </>
          ) : (
            <>
              <DollarSign className="w-4 h-4 mr-2" />
              Create Bond
            </>
          )}
        </Button>
      </div>

      {/* Info Section */}
      <div className="bg-slate-50 dark:bg-[#141414]/50 rounded-lg p-4 border border-black/10 dark:border-white/10">
        <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" />
          How Bond Creation Works
        </h4>
        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <li>• Your tokens are deposited into the AssurancePool as backing</li>
          <li>• You receive a bond NFT representing your claim</li>
          <li>• The bond can be redeemed for its face value at maturity</li>
          <li>• Longer maturity periods offer higher discounts</li>
        </ul>
      </div>
    </div>
  );
};

export default BondDepositForm;
