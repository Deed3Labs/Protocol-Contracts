import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MoreHorizontal, ChevronRight, ArrowUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolio } from "@/context/PortfolioContext";

type TradeType = "buy" | "sell" | "swap";
type TradeStep = "input" | "review" | "success";
type TradeScreen = "trade" | "selectAsset" | "selectWallet";
type AssetPickTarget = "buyTo" | "sellFrom" | "swapFrom" | "swapTo";
type WalletPickTarget = "pay" | "receive";

interface Asset {
  symbol: string;
  name: string;
  color: string;
  balance?: number;
  balanceUSD?: number;
  type?: 'token' | 'nft' | 'rwa';
  chainId?: number;
  chainName?: string;
}

interface TradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTradeType?: "buy" | "sell";
  initialAsset?: Asset | null;
}

const paymentMethods = [
  { id: "wallet", name: "USD Wallet", value: null as number | null, icon: "💵" },
  { id: "debit", name: "Debit Card", value: null as number | null, icon: "💳" },
  { id: "bank", name: "Bank Account", value: null as number | null, icon: "🏦" },
];

// Generate color for asset based on symbol
const getAssetColor = (symbol: string): string => {
  const colors: Record<string, string> = {
    BTC: "bg-orange-500",
    ETH: "bg-blue-500",
    SOL: "bg-gradient-to-r from-purple-500 to-cyan-400",
    USDC: "bg-blue-600",
    USDT: "bg-green-600",
    DAI: "bg-yellow-500",
  };
  return colors[symbol.toUpperCase()] || "bg-zinc-500";
};

export function TradeModal({ open, onOpenChange, initialTradeType = "buy", initialAsset = null }: TradeModalProps) {
  const { holdings, cashBalance } = usePortfolio();
  
  const [tradeType, setTradeType] = useState<TradeType>(initialTradeType);
  const [step, setStep] = useState<TradeStep>("input");
  const [screen, setScreen] = useState<TradeScreen>("trade");
  const [assetPickTarget, setAssetPickTarget] = useState<AssetPickTarget>("buyTo");
  const [walletPickTarget, setWalletPickTarget] = useState<WalletPickTarget>("pay");
  const [searchQuery, setSearchQuery] = useState("");
  const [amount, setAmount] = useState("0");
  const [fromAsset, setFromAsset] = useState<Asset | null>(null);
  const [toAsset, setToAsset] = useState<Asset | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [receiveAccount, setReceiveAccount] = useState<{ id: string; name: string; subtitle?: string } | null>(null);

  const cashUsdAsset = useMemo<Asset>(
    () => ({
      symbol: "USD",
      name: "Cash (USD)",
      color: "bg-zinc-700",
      balance: cashBalance.totalCash,
      balanceUSD: cashBalance.totalCash,
      type: "token",
    }),
    [cashBalance.totalCash]
  );

  // Convert holdings to assets for selection
  const availableAssets = useMemo<Asset[]>(() => {
    return holdings
      .filter(h => h.type === 'token' && parseFloat(h.balance || '0') > 0)
      .map(h => ({
        symbol: h.asset_symbol,
        name: h.asset_name,
        color: getAssetColor(h.asset_symbol),
        balance: parseFloat(h.balance || '0'),
        balanceUSD: h.balanceUSD,
        type: h.type,
        chainId: h.chainId,
        chainName: h.chainName,
      }));
  }, [holdings]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableAssets;
    return availableAssets.filter((a) => {
      return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [availableAssets, searchQuery]);

  // Initialize assets when modal opens or initialAsset changes
  useEffect(() => {
    if (open) {
      setScreen("trade");
      setSearchQuery("");
      setReceiveAccount({ id: "cash-usd", name: "Cash (USD)", subtitle: "Balance" });

      // Update payment method with cash balance
      setPaymentMethod({
        ...paymentMethods[0],
        value: cashBalance.totalCash,
      });

      if (initialAsset) {
        // If initial asset provided, set it as the target
        if (initialTradeType === "buy") {
          setToAsset(initialAsset);
          // Set USDC as from asset if available, otherwise first stablecoin
          const usdc = availableAssets.find(a => a.symbol.toUpperCase() === "USDC");
          setFromAsset(usdc || availableAssets[0] || null);
        } else if (initialTradeType === "sell") {
          setFromAsset(initialAsset);
          // Receive Cash (USD)
          setToAsset(cashUsdAsset);
        }
        setTradeType(initialTradeType);
      } else {
        // Default: Buy mode with USDC -> first available asset
        const usdc = availableAssets.find(a => a.symbol.toUpperCase() === "USDC");
        setFromAsset(usdc || availableAssets[0] || null);
        setToAsset(availableAssets.find(a => a.symbol.toUpperCase() !== "USDC") || availableAssets[1] || null);
        setTradeType("buy");
      }
      setStep("input");
      setAmount("0");
    }
  }, [open, initialAsset, initialTradeType, availableAssets, cashBalance, cashUsdAsset]);

  const handleNumberPress = useCallback((num: string) => {
    setAmount((currentAmount) => {
      if (num === "." && currentAmount.includes(".")) return currentAmount;
      if (currentAmount === "0" && num !== ".") {
        return num;
      }
      return currentAmount + num;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setAmount((currentAmount) => {
      if (currentAmount.length === 1) {
        return "0";
      }
      return currentAmount.slice(0, -1);
    });
  }, []);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(() => {
      setScreen("trade");
      setStep("input");
      setAmount("0");
    }, 300);
  }, [onOpenChange]);

  const handleReview = useCallback(() => {
    setStep("review");
  }, []);

  // Keyboard event handlers
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape closes from anywhere
      if (event.key === "Escape") {
        event.preventDefault();
        if (screen !== "trade") {
          setScreen("trade");
          setSearchQuery("");
          return;
        }
        handleClose();
        return;
      }

      // Only handle number input on main input screen
      if (screen !== "trade" || step !== "input") {
        // Escape key works on all steps
        return;
      }

      // Prevent default for number keys and special keys when typing
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        handleNumberPress(event.key);
      } else if (event.key === "." || event.key === ",") {
        // Support both . and , for decimal point
        event.preventDefault();
        handleNumberPress(".");
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === "Enter" && amount !== "0" && parseFloat(amount) > 0) {
        // Allow Enter to proceed to review step
        event.preventDefault();
        handleReview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, screen, step, amount, handleNumberPress, handleBackspace, handleClose, handleReview]);

  const openAssetPicker = useCallback((target: AssetPickTarget) => {
    setAssetPickTarget(target);
    setWalletPickTarget("pay");
    setSearchQuery("");
    setScreen("selectAsset");
  }, []);

  const openWalletPicker = useCallback((target: WalletPickTarget) => {
    setWalletPickTarget(target);
    setSearchQuery("");
    setScreen("selectWallet");
  }, []);

  const handlePickAsset = useCallback(
    (asset: Asset) => {
      if (assetPickTarget === "buyTo") {
        setToAsset(asset);
      } else if (assetPickTarget === "sellFrom") {
        setFromAsset(asset);
        setToAsset(cashUsdAsset);
      } else if (assetPickTarget === "swapFrom") {
        setFromAsset(asset);
      } else if (assetPickTarget === "swapTo") {
        setToAsset(asset);
      }
      setScreen("trade");
      setSearchQuery("");
    },
    [assetPickTarget, cashUsdAsset]
  );

  const handlePickWallet = useCallback(
    (id: string) => {
      if (walletPickTarget === "pay") {
        const found = paymentMethods.find((m) => m.id === id) || paymentMethods[0];
        setPaymentMethod({
          ...found,
          value: id === "wallet" ? cashBalance.totalCash : null,
        });
      } else {
        // Receive wallet/account (for now we only support Cash USD)
        if (id === "cash-usd") {
          setReceiveAccount({ id: "cash-usd", name: "Cash (USD)", subtitle: "Balance" });
          setToAsset(cashUsdAsset);
        }
      }
      setScreen("trade");
      setSearchQuery("");
    },
    [walletPickTarget, cashBalance.totalCash, cashUsdAsset]
  );

  const handleConfirm = () => {
    setStep("success");
    // TODO: Implement actual trade logic
  };

  const getConversionAmount = () => {
    const numAmount = parseFloat(amount) || 0;
    if (!fromAsset || !toAsset) return "0";
    
    // Mock conversion rates (in production, fetch from price oracle)
    const rates: Record<string, number> = {
      BTC: 0.00001,
      ETH: 0.00036,
      SOL: 0.007,
      USDC: 1,
      USDT: 1,
      DAI: 1,
      USD: 1,
    };
    
    const fromRate = rates[fromAsset.symbol.toUpperCase()] || 0.001;
    const toRate = rates[toAsset.symbol.toUpperCase()] || 0.001;
    
    if (tradeType === "swap") {
      return ((numAmount * fromRate) / toRate).toFixed(8);
    } else if (tradeType === "buy") {
      // Buying toAsset with USD (fromAsset should be USDC)
      return ((numAmount * fromRate) / toRate).toFixed(8);
    } else {
      // Selling fromAsset for USD (toAsset should be USDC)
      return ((numAmount * fromRate) / toRate).toFixed(8);
    }
  };

  const swapAssets = () => {
    if (!fromAsset || !toAsset) return;
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
  };

  const formatBalance = (balance: number | undefined): string => {
    if (!balance) return "0";
    if (balance < 0.0001) return balance.toFixed(8);
    if (balance < 1) return balance.toFixed(4);
    return balance.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-0 sm:p-4"
            onClick={handleClose}
          >
            <div 
              className="h-[100dvh] max-h-[100dvh] w-full max-w-full sm:max-w-md sm:h-[90vh] sm:max-h-[800px] bg-white dark:bg-[#0e0e0e] border-0 sm:border sm:border-zinc-200 dark:border-zinc-800 sm:rounded-2xl rounded-none overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {screen === "selectAsset" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => {
                        setScreen("trade");
                        setSearchQuery("");
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">
                      {assetPickTarget === "buyTo"
                        ? "Select asset to buy"
                        : assetPickTarget === "sellFrom"
                        ? "Select asset to sell"
                        : assetPickTarget === "swapFrom"
                        ? "Select asset to swap from"
                        : "Select asset to receive"}
                    </h2>
                    <div className="w-9" />
                  </div>

                  <div className="p-4 pb-2">
                    <div className="flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 rounded-full px-4 py-3">
                      <div className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search"
                        className="w-full bg-transparent outline-none text-sm text-black dark:text-white placeholder:text-zinc-500"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="px-4">
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                      {availableAssets.slice(0, 4).map((a) => (
                        <button
                          key={`chip-${a.symbol}`}
                          onClick={() => handlePickAsset(a)}
                          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/0 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                        >
                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold", a.color)}>
                            {a.symbol.charAt(0)}
                          </div>
                          <span className="text-sm text-black dark:text-white">{a.symbol}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2 pb-2">
                    <div className="px-2 py-2 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                      Assets
                    </div>
                    <div className="space-y-1">
                      {filteredAssets.map((a) => {
                        const isSelected =
                          (assetPickTarget === "buyTo" && toAsset?.symbol === a.symbol) ||
                          (assetPickTarget === "sellFrom" && fromAsset?.symbol === a.symbol) ||
                          (assetPickTarget === "swapFrom" && fromAsset?.symbol === a.symbol) ||
                          (assetPickTarget === "swapTo" && toAsset?.symbol === a.symbol);
                        return (
                          <button
                            key={`asset-${a.symbol}`}
                            onClick={() => handlePickAsset(a)}
                            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", a.color)}>
                                {a.symbol.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-black dark:text-white font-medium truncate">{a.name}</div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{a.symbol}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="text-black dark:text-white text-sm font-medium">
                                  {a.balanceUSD !== undefined ? `$${a.balanceUSD.toFixed(2)}` : ""}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {a.balance !== undefined ? `${formatBalance(a.balance)} ${a.symbol}` : ""}
                                </div>
                              </div>
                              {isSelected ? (
                                <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                  <Check className="w-4 h-4 text-white dark:text-black" />
                                </div>
                              ) : (
                                <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {filteredAssets.length === 0 && (
                        <div className="py-10 text-center text-sm text-zinc-500">No assets found</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {screen === "selectWallet" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => {
                        setScreen("trade");
                        setSearchQuery("");
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">
                      {walletPickTarget === "pay" ? "Pay with" : "Receive to"}
                    </h2>
                    <div className="w-9" />
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {walletPickTarget === "pay" ? (
                      <>
                        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 px-2 py-2">
                          Wallets
                        </div>
                        {paymentMethods.map((m) => {
                          const isSelected = paymentMethod.id === m.id;
                          const displayValue =
                            m.id === "wallet" ? `$${cashBalance.totalCash.toFixed(2)}` : m.value ? `$${m.value.toFixed(2)}` : "";
                          const subtitle =
                            m.id === "wallet"
                              ? "Available balance"
                              : m.id === "debit"
                              ? "Debit card"
                              : "Bank account";
                          return (
                            <button
                              key={`pay-${m.id}`}
                              onClick={() => handlePickWallet(m.id)}
                              className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                  {m.icon}
                                </div>
                                <div>
                                  <div className="text-black dark:text-white font-medium">{m.name}</div>
                                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {displayValue && (
                                  <div className="text-right">
                                    <div className="text-black dark:text-white text-sm font-medium">{displayValue}</div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Available</div>
                                  </div>
                                )}
                                {isSelected ? (
                                  <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                    <Check className="w-4 h-4 text-white dark:text-black" />
                                  </div>
                                ) : (
                                  <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 px-2 py-2">
                          Accounts
                        </div>
                        <button
                          onClick={() => handlePickWallet("cash-usd")}
                          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                              💵
                            </div>
                            <div>
                              <div className="text-black dark:text-white font-medium">{receiveAccount?.name || "Cash (USD)"}</div>
                              <div className="text-sm text-zinc-500 dark:text-zinc-400">Balance</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-black dark:text-white text-sm font-medium">${cashBalance.totalCash.toFixed(2)}</div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">Available</div>
                            </div>
                            <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                              <Check className="w-4 h-4 text-white dark:text-black" />
                            </div>
                          </div>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {screen === "trade" && step === "input" && (
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button 
                      onClick={handleClose} 
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-full text-sm text-zinc-600 dark:text-zinc-400">
                      One-time order
                      <ChevronRight className="w-4 h-4" />
                    </div>
                    <button className="p-2 -mr-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors">
                      <MoreHorizontal className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                  </div>

                  {/* Trade Type Tabs */}
                  <div className="px-4 pt-4">
                    <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 rounded-full p-1">
                      {(["buy", "sell", "swap"] as TradeType[]).map((type) => (
                        <button
                          key={type}
                          onClick={() => setTradeType(type)}
                          className={cn(
                            "px-5 py-2 rounded-full text-sm font-medium transition-all capitalize",
                            tradeType === type
                              ? "bg-black dark:bg-white text-white dark:text-black"
                              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Display */}
                  <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-6xl font-light tracking-tight text-black dark:text-white">
                        {amount}
                      </span>
                      <span className="text-4xl font-light text-zinc-500 dark:text-zinc-400">
                        {tradeType === "swap" && fromAsset ? fromAsset.symbol : "USD"}
                      </span>
                    </div>
                    {toAsset && (
                      <div className="flex items-center gap-1 mt-2 text-blue-600 dark:text-blue-400">
                        <ArrowUpDown className="w-4 h-4" />
                        <span className="text-sm font-medium">
                          {getConversionAmount()} {toAsset.symbol}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Asset Selectors */}
                  <div className="px-4 space-y-1 mb-4">
                    {tradeType === "swap" ? (
                      <>
                        {/* Swap From/To */}
                        <div className="relative">
                          <button
                            onClick={() => openAssetPicker("swapFrom")}
                            className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {fromAsset && (
                                <>
                                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", fromAsset.color)}>
                                    {fromAsset.symbol.charAt(0)}
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">You pay</p>
                                    <p className="font-medium text-black dark:text-white">{fromAsset.name}</p>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {fromAsset && (
                                <>
                                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                    {formatBalance(fromAsset.balance)} available
                                  </span>
                                  <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                                </>
                              )}
                            </div>
                          </button>
                          
                          <button 
                            onClick={swapAssets}
                            className="absolute left-1/2 -translate-x-1/2 -bottom-4 z-10 w-8 h-8 bg-white dark:bg-[#0e0e0e] border border-zinc-200 dark:border-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                          >
                            <ArrowUpDown className="w-4 h-4 text-zinc-900 dark:text-white" />
                          </button>
                        </div>

                        <button
                          onClick={() => openAssetPicker("swapTo")}
                          className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors mt-2"
                        >
                          <div className="flex items-center gap-3">
                            {toAsset && (
                              <>
                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", toAsset.color)}>
                                  {toAsset.symbol.charAt(0)}
                                </div>
                                <div className="text-left">
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">You receive</p>
                                  <p className="font-medium text-black dark:text-white">{toAsset.name}</p>
                                </div>
                              </>
                            )}
                          </div>
                          <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Buy/Sell - UX differs by direction */}
                        {tradeType === "buy" ? (
                          <>
                            <button
                              onClick={() => openWalletPicker("pay")}
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xl">
                                  {paymentMethod.icon}
                                </div>
                                <div className="text-left">
                                  <p className="font-medium text-black dark:text-white">Pay with</p>
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{paymentMethod.name}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {paymentMethod.value !== null && (
                                  <div className="text-right">
                                    <p className="text-sm font-medium text-black dark:text-white">
                                      ${paymentMethod.value.toFixed(2)}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Available</p>
                                  </div>
                                )}
                                <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                              </div>
                            </button>

                            <div className="flex items-center justify-center py-1">
                              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800" />
                            </div>

                            <button
                              onClick={() => openAssetPicker("buyTo")}
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                {toAsset && (
                                  <>
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", toAsset.color)}>
                                      {toAsset.symbol.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-black dark:text-white">Buy</p>
                                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{toAsset.name}</p>
                                    </div>
                                  </>
                                )}
                              </div>
                              <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => openAssetPicker("sellFrom")}
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                {fromAsset && (
                                  <>
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", fromAsset.color)}>
                                      {fromAsset.symbol.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-black dark:text-white">Sell</p>
                                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{fromAsset.name}</p>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {fromAsset?.balance !== undefined && (
                                  <div className="text-right">
                                    <p className="text-sm font-medium text-black dark:text-white">
                                      {formatBalance(fromAsset.balance)} {fromAsset.symbol}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Available</p>
                                  </div>
                                )}
                                <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                              </div>
                            </button>

                            <div className="flex items-center justify-center py-1">
                              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800" />
                            </div>

                            <button
                              onClick={() => openWalletPicker("receive")}
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                  {paymentMethod.icon}
                                </div>
                                <div className="text-left">
                                  <p className="font-medium text-black dark:text-white">Receive</p>
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{receiveAccount?.name || cashUsdAsset.name}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <p className="text-sm font-medium text-black dark:text-white">
                                    ${cashBalance.totalCash.toFixed(2)}
                                  </p>
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Balance</p>
                                </div>
                                <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                              </div>
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* Review Button */}
                  <div className="px-4 pb-2">
                    <Button 
                      onClick={handleReview}
                      disabled={amount === "0" || parseFloat(amount) <= 0}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      Review order
                    </Button>
                  </div>

                  {/* Number Pad */}
                  <div className="grid grid-cols-3 gap-1 p-4 pt-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((key) => (
                      <button
                        key={key}
                        onClick={() => key === "back" ? handleBackspace() : handleNumberPress(key)}
                        className="h-14 rounded-lg text-2xl font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center text-black dark:text-white"
                      >
                        {key === "back" ? (
                          <ArrowLeft className="w-6 h-6" />
                        ) : (
                          key
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "review" && (
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button 
                      onClick={() => setStep("input")} 
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Review order</h2>
                    <div className="w-9" />
                  </div>

                  <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                    {/* Order Summary */}
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">
                          You're {tradeType === "swap" ? "swapping" : tradeType === "buy" ? "buying" : "selling"}
                        </span>
                        {toAsset && (
                          <div className="flex items-center gap-2">
                            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold", toAsset.color)}>
                              {toAsset.symbol.charAt(0)}
                            </div>
                            <span className="font-semibold text-black dark:text-white">
                              {getConversionAmount()} {toAsset.symbol}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">For</span>
                        <span className="font-semibold text-black dark:text-white">${amount} USD</span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-500 dark:text-zinc-400">Payment method</span>
                        <span className="text-black dark:text-white">{paymentMethod.name}</span>
                      </div>
                      {toAsset && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Price</span>
                          <span className="text-black dark:text-white">
                            1 {toAsset.symbol} ≈ ${(parseFloat(amount) / parseFloat(getConversionAmount())).toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-500 dark:text-zinc-400">Network fee</span>
                        <span className="text-black dark:text-white">$0.00</span>
                      </div>
                      <div className="flex items-center justify-between py-3">
                        <span className="font-semibold text-black dark:text-white">Total</span>
                        <span className="font-semibold text-black dark:text-white">${amount} USD</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <Button 
                      onClick={handleConfirm}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      Confirm {tradeType}
                    </Button>
                  </div>
                </div>
              )}

              {step === "success" && (
                <div className="flex flex-col h-full items-center justify-center p-4">
                  <div className="w-24 h-24 rounded-full bg-black dark:bg-white flex items-center justify-center mb-6">
                    <Check className="w-12 h-12 text-white dark:text-black" />
                  </div>
                  <h2 className="text-2xl font-semibold mb-2 text-black dark:text-white">Order submitted</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-center mb-8">
                    We'll email you once this order changes status
                  </p>

                  {availableAssets.length > 0 && (
                    <div className="w-full space-y-4">
                      <p className="text-center text-zinc-500 dark:text-zinc-400 text-sm">You might also like</p>
                      <div className="flex justify-center gap-4">
                        {availableAssets.slice(0, 3).map((asset) => (
                          <div key={asset.symbol} className="flex flex-col items-center p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl min-w-[100px]">
                            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold mb-2", asset.color)}>
                              {asset.symbol.charAt(0)}
                            </div>
                            <span className="font-medium text-black dark:text-white">{asset.symbol}</span>
                            <span className="text-xs text-green-600 dark:text-green-400">↗ 0.15%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto w-full pt-8">
                    <Button 
                      onClick={handleClose}
                      variant="secondary"
                      className="w-full h-14 rounded-full text-base font-semibold bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
