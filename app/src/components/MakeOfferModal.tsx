import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, DollarSign, AlertCircle, Send } from 'lucide-react';

interface MakeOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetType: 'bond' | 'deed';
  assetId: string;
  assetName?: string;
}

// Mock token list with icons and USD prices
const tokens = [
  { address: '0x1', symbol: 'USDC', decimals: 6, iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', usdPrice: 1.0 },
  { address: '0x2', symbol: 'USDT', decimals: 6, iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', usdPrice: 1.0 },
  { address: '0x3', symbol: 'DAI', decimals: 18, iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png', usdPrice: 1.0 },
  { address: '0x820c137fa70c8691f0e44dc420a5e53c168921dc', symbol: 'USDS', decimals: 18, iconUrl: 'https://basescan.org/token/images/skyusds_32.svg', usdPrice: 1.0 },
  { address: '0x4', symbol: 'WBTC', decimals: 8, iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png', usdPrice: 67000.0 },
  { address: '0x5', symbol: 'WETH', decimals: 18, iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png', usdPrice: 3500.0 },
];

const MakeOfferModal: React.FC<MakeOfferModalProps> = ({ 
  isOpen, 
  onClose, 
  assetType,
  assetId,
  assetName 
}) => {
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [offerAmount, setOfferAmount] = useState<string>('');
  const [offerNote, setOfferNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);

  const selectedTokenInfo = tokens.find(t => t.address === selectedToken);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!selectedToken) {
      setError('Please select a token');
      return;
    }
    
    if (!offerAmount || parseFloat(offerAmount) <= 0) {
      setError('Please enter a valid offer amount');
      return;
    }

    setIsSubmitting(true);
    
    // Mock API call
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Mock success
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
        // Reset form
        setSelectedToken('');
        setOfferAmount('');
        setOfferNote('');
      }, 2000);
    } catch (err) {
      setError('Failed to submit offer. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError('');
      setSuccess(false);
      setSelectedToken('');
      setOfferAmount('');
      setOfferNote('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md border-black/10 dark:border-white/10">
        <DialogHeader>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              <DialogTitle>Make Offer</DialogTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-8 w-8 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <DialogDescription>
            Submit an offer for {assetType === 'bond' ? `Bond #${assetId}` : `T-Deed #${assetId}`}
            {assetName && ` - ${assetName}`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Token Selection */}
          <div className="space-y-3">
            <Label htmlFor="token-select" className="text-sm font-medium">
              Offer Token
            </Label>
            <Select value={selectedToken} onValueChange={setSelectedToken}>
              <SelectTrigger className="w-full h-12 text-base dark:bg-[#141414]">
                {selectedTokenInfo ? (
                  <div className="flex items-center gap-2">
                    {selectedTokenInfo.iconUrl ? (
                      <img 
                        src={selectedTokenInfo.iconUrl} 
                        alt={selectedTokenInfo.symbol} 
                        className="w-5 h-5 rounded-full" 
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">
                        {selectedTokenInfo.symbol.substring(0, 2)}
                      </div>
                    )}
                    <span className="font-medium">{selectedTokenInfo.symbol}</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Choose a token" />
                )}
              </SelectTrigger>
              <SelectContent className="dark:bg-[#141414]">
                {tokens.map((token) => (
                  <SelectItem key={token.address} value={token.address} className="h-12 text-base">
                    <div className="flex items-center gap-2">
                      {token.iconUrl ? (
                        <img 
                          src={token.iconUrl} 
                          alt={token.symbol} 
                          className="w-5 h-5 rounded-full" 
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">
                          {token.symbol.substring(0, 2)}
                        </div>
                      )}
                      <span>{token.symbol}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Offer Amount */}
          <div className="space-y-3">
            <Label htmlFor="offer-amount" className="text-sm font-medium">
              Offer Amount
            </Label>
            <Input
              id="offer-amount"
              type="text"
              placeholder="0.00"
              value={offerAmount}
              onChange={(e) => {
                const value = e.target.value;
                // Allow numbers and decimal point
                if (/^[0-9]*\.?[0-9]*$/.test(value) || value === '') {
                  setOfferAmount(value);
                }
              }}
              className="h-12 text-base"
            />
            {selectedTokenInfo && offerAmount && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ≈ ${(parseFloat(offerAmount || '0') * (selectedTokenInfo.usdPrice || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </p>
            )}
          </div>

          {/* Optional Note */}
          <div className="space-y-3">
            <Label htmlFor="offer-note" className="text-sm font-medium">
              Message (Optional)
            </Label>
            <Textarea
              id="offer-note"
              placeholder="Add a message with your offer..."
              value={offerNote}
              onChange={(e) => setOfferNote(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
              <p className="text-sm text-green-800 dark:text-green-200">
                Offer submitted successfully!
              </p>
            </div>
          )}

          {/* Note */}
          <p className="text-xs text-gray-600 dark:text-gray-400">Offers are off-chain drafts for now; contract integration coming soon.</p>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 border-black/10 dark:border-white/10 h-12 text-base"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Offer
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !selectedToken || !offerAmount}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-12 text-base border border-blue-700 dark:border-blue-500"
            >
              <Send className="w-4 h-4 mr-2" />
              {isSubmitting ? 'Submitting...' : 'Submit Offer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default MakeOfferModal;

