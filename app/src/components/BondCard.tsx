import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, 
  DollarSign, 
  Clock,
  User,
  CheckCircle2,
  HandCoins
} from 'lucide-react';

export interface Bond {
  id: string;
  faceValue: string;
  discountPercentage: number;
  maturityDate: number;
  isRedeemed: boolean;
  creator: string;
  createdAt: number;
  tokenSymbol: string;
  tokenAddress: string;
  requiredDeposit: string;
  discountAmount: string;
  currentValue?: string;
  status?: 'active' | 'matured' | 'redeemed';
}

interface BondCardProps {
  bond: Bond | any; // Accept any bond type that extends Bond
  onViewDetails: (bond: any) => void;
  onRedeem?: (bond: any) => void;
  onMakeOffer?: (bond: any) => void; // Handler for make offer action
  showRedeemButton?: boolean;
  canRedeem?: boolean;
  isMyBonds?: boolean; // New prop to determine if this is from My Bonds tab
  isSelected?: boolean; // Whether this bond is selected
  onToggleSelect?: (bond: any) => void; // Toggle selection handler
  canSelect?: boolean; // Whether this bond can be selected
}

const BondCard: React.FC<BondCardProps> = ({ 
  bond, 
  onViewDetails, 
  onRedeem,
  onMakeOffer,
  showRedeemButton = false,
  canRedeem = false,
  isMyBonds = false,
  isSelected = false,
  onToggleSelect,
  canSelect = false
}) => {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [lastClickTime, setLastClickTime] = useState(0);
  const clickTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Handle double click/tap for selection
  const handleCardClick = (e: React.MouseEvent) => {
    if (!canSelect || !onToggleSelect) {
      return;
    }

    // Clear any pending single click
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - lastClickTime;

    // Double click detection (within 300ms)
    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(bond);
      setLastClickTime(0); // Reset to prevent triple-click issues
    } else {
      // Set a timeout for single click - if no double click happens, do nothing
      setLastClickTime(currentTime);
      clickTimeoutRef.current = setTimeout(() => {
        setLastClickTime(0);
      }, 300);
    }
  };

  // Handle double tap for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canSelect || !onToggleSelect) {
      return;
    }

    // Clear any pending single tap
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - lastClickTime;

    // Double tap detection (within 300ms)
    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(bond);
      setLastClickTime(0); // Reset to prevent triple-tap issues
    } else {
      // Set a timeout for single tap - if no double tap happens, do nothing
      setLastClickTime(currentTime);
      clickTimeoutRef.current = setTimeout(() => {
        setLastClickTime(0);
      }, 300);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  // Update current time every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Format countdown timer - show 3-4 key times based on timeframe
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

  return (
    <div 
      className={`relative ${canSelect ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
    >
      <Card className={`group hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 ${
        isSelected ? 'border-blue-400/50 dark:border-blue-400/30' : 'border-black/10 dark:border-white/10'
      } bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm ${!isSelected ? 'hover:scale-[1.02]' : ''}`}>
      <CardHeader className="pb-0">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-0">
              <h3 className="font-semibold text-lg text-gray-900 dark:text-white">
                {bond.tokenSymbol} Bond
              </h3>
              <Badge variant={status.variant} className={`text-xs ${status.className || ''}`}>
                {status.label}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              #{bond.id} · {bond.bondType || 'standard'} · {bond.tokenSymbol}-BB
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-4 mb-9">
          <div className="space-y-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Face Value</div>
            <div className="text-gray-900 dark:text-white font-medium text-sm">{bond.faceValue} {bond.tokenSymbol}</div>
          </div>
          <div className="space-y-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Discount</div>
            <div className="text-green-600 font-medium text-sm">{bond.discountPercentage.toFixed(2)}%</div>
          </div>
          <div className="space-y-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Maturity</div>
            <div className="text-gray-900 dark:text-white font-medium text-sm">{new Date(bond.maturityDate * 1000).toLocaleDateString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-gray-500 dark:text-gray-400 text-xs">Purchase Price</div>
            <div className="text-blue-600 font-medium text-sm">{bond.requiredDeposit} {bond.tokenSymbol}</div>
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-1 mb-4 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>Created by {bond.creator.slice(0, 6)}...{bond.creator.slice(-4)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{new Date(bond.createdAt * 1000).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] dark:bg-[#141414] h-11 w-11 md:w-auto md:px-4 flex-shrink-0" 
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(bond);
            }}
          >
            <Eye className="w-4 h-4 md:mr-1" />
            <span className="hidden md:inline">View Details</span>
          </Button>
          {isMyBonds && showRedeemButton && canRedeem && (
            <Button 
              className="flex-1 h-11 bg-green-600 hover:bg-green-700 text-white font-medium opacity-100 border border-green-500 dark:border-green-500"
              onClick={(e) => {
                e.stopPropagation();
                onRedeem?.(bond);
              }}
            >
              <DollarSign className="w-4 h-4 mr-1" />
              Redeem Bond
            </Button>
          )}
          {!isMyBonds && onMakeOffer && (
            <Button 
              className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium opacity-100 border border-blue-700 dark:border-blue-500"
              onClick={(e) => {
                e.stopPropagation();
                onMakeOffer(bond);
              }}
            >
              <HandCoins className="w-4 h-4 mr-1" />
              Make Offer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
    {/* Selection Overlay */}
    {isSelected && (
      <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg backdrop-blur-[2px] bg-gradient-to-br from-blue-500/20 via-blue-400/15 to-blue-600/20 dark:from-blue-400/25 dark:via-blue-500/20 dark:to-blue-600/25">
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 className="w-12 h-12 text-gray-900 dark:text-white" strokeWidth={2.5} />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Selected</span>
        </div>
      </div>
    )}
    </div>
  );
};

export default BondCard;
