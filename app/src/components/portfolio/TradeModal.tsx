import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MoreHorizontal, ChevronRight, ArrowUpDown, Check, Loader2, AlertCircle, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolio } from "@/context/PortfolioContext";
import { useAccount } from "wagmi";
import { useLifiTrade } from "@/hooks/useLifiTrade";
import { SUPPORTED_NETWORKS } from "@/config/networks";
import { createStripeOnrampSession, getBridgeFundingUrl } from "@/utils/apiClient";
import { isAddress } from "ethers";

declare global {
  interface Window {
    StripeOnramp?: (publishableKey: string) => any;
  }
}

type TradeType = "buy" | "sell" | "swap";
type TradeStep = "input" | "review" | "pending" | "success" | "failed" | "funding" | "bank_pending" | "funding_complete";
type TradeScreen = "trade" | "selectAsset" | "selectWallet" | "selectCardProvider" | "externalWalletAddress";
type AssetPickTarget = "buyTo" | "buyFrom" | "sellFrom" | "swapFrom" | "swapTo";
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
  initialTradeType?: "buy" | "sell" | "swap";
  initialAsset?: Asset | null;
}

const paymentMethods = [
  { id: "wallet", name: "Pay with crypto", value: null as number | null, icon: "💵", subtitle: "Select token and chain" },
  { id: "debit", name: "Fund with Debit/Card", value: null as number | null, icon: "💳", subtitle: "Debit, credit, Apple Pay" },
  { id: "bank", name: "Fund with Bank", value: null as number | null, icon: "🏦", subtitle: "Connected bank account" },
];

const cardFundingProviders = [
  { id: "stripe", name: "Stripe", subtitle: "Debit, credit, Apple Pay", enabled: true },
  { id: "transak", name: "Transak", subtitle: "Coming soon", enabled: false },
  { id: "onramper", name: "Onramper", subtitle: "Coming soon", enabled: false },
  { id: "moonpay", name: "MoonPay", subtitle: "Coming soon", enabled: false },
];

function chainIdToStripeNetwork(chainId: number | undefined): string {
  const map: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    137: "polygon",
    42161: "arbitrum",
    10: "optimism",
  };
  return chainId ? map[chainId] ?? "ethereum" : "ethereum";
}

const TESTNET_CHAIN_IDS = new Set<number>([
  11155111,   // Sepolia
  84532,      // Base Sepolia
  421614,     // Arbitrum Sepolia
  11155420,   // OP Sepolia
  80002,      // Polygon Amoy
  43113,      // Avalanche Fuji
  97,         // BSC Testnet
]);

function isTestnetChainId(chainId: number | undefined): boolean {
  return chainId != null && TESTNET_CHAIN_IDS.has(chainId);
}

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
  const bankLinked = cashBalance.bankLinked ?? false;
  const { address, chainId } = useAccount();
  const { quote, execution, fetchQuote, executeTrade, resetExecution, clearQuote } = useLifiTrade();
  
  const [tradeType, setTradeType] = useState<TradeType>(initialTradeType);
  const [step, setStep] = useState<TradeStep>("input");
  const [screen, setScreen] = useState<TradeScreen>("trade");
  const [assetPickTarget, setAssetPickTarget] = useState<AssetPickTarget>("buyTo");
  const [walletPickTarget, setWalletPickTarget] = useState<WalletPickTarget>("pay");
  const [searchQuery, setSearchQuery] = useState("");
  const [amount, setAmount] = useState("0");
  const [fromAsset, setFromAsset] = useState<Asset | null>(null);
  const [toAsset, setToAsset] = useState<Asset | null>(null);
  const [fromChainId, setFromChainId] = useState<number | null>(null);
  const [toChainId, setToChainId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [receiveAccount, setReceiveAccount] = useState<{ id: string; name: string; subtitle?: string } | null>(null);
  const [quoteExpiryTime, setQuoteExpiryTime] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [selectedCardProvider, setSelectedCardProvider] = useState<string>("stripe");
  const [fundingCompleteMessage, setFundingCompleteMessage] = useState<string>("");
  const [stripeOnrampLoading, setStripeOnrampLoading] = useState(false);
  const [externalPayoutAddress, setExternalPayoutAddress] = useState("");
  const [externalPayoutAddressError, setExternalPayoutAddressError] = useState<string | null>(null);
  const stripeOnrampRef = useRef<HTMLDivElement>(null);
  const stripeSessionRef = useRef<any>(null);
  const lastAutoRefreshExpiryRef = useRef<number | null>(null);

  const loadStripeScripts = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.StripeOnramp) {
        resolve();
        return;
      }
      if (document.querySelector('script[src*="stripe.js"]')) {
        const checkInterval = setInterval(() => {
          if (window.StripeOnramp) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!window.StripeOnramp) reject(new Error('Stripe scripts failed to load'));
        }, 10000);
        return;
      }
      const stripeScript = document.createElement('script');
      stripeScript.src = 'https://js.stripe.com/clover/stripe.js';
      stripeScript.async = true;
      stripeScript.onload = () => {
        const cryptoScript = document.createElement('script');
        cryptoScript.src = 'https://crypto-js.stripe.com/crypto-onramp-outer.js';
        cryptoScript.async = true;
        cryptoScript.onload = () => {
          const checkInterval = setInterval(() => {
            if (window.StripeOnramp) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.StripeOnramp) reject(new Error('StripeOnramp not available after loading scripts'));
          }, 10000);
        };
        cryptoScript.onerror = () => reject(new Error('Failed to load Stripe crypto onramp script'));
        document.head.appendChild(cryptoScript);
      };
      stripeScript.onerror = () => reject(new Error('Failed to load Stripe script'));
      document.head.appendChild(stripeScript);
    });
  }, []);

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

  // Convert holdings to assets for selection (exclude testnet tokens)
  const availableAssets = useMemo<Asset[]>(() => {
    return holdings
      .filter(h => h.type === 'token' && parseFloat(h.balance || '0') > 0 && !isTestnetChainId(h.chainId))
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
      clearQuote();
      resetExecution();

      // Update payment method with cash balance
      setPaymentMethod({
        ...paymentMethods[0],
        value: cashBalance.totalCash,
      });

      // Set default chain IDs from current wallet chain or first available asset
      const defaultChainId = chainId || availableAssets[0]?.chainId || 1;
      setFromChainId(defaultChainId);
      setToChainId(defaultChainId);

      if (initialAsset && !isTestnetChainId(initialAsset.chainId)) {
        // If initial asset provided (mainnet only), set it as the target
        if (initialTradeType === "buy") {
          setToAsset(initialAsset);
          setToChainId(initialAsset.chainId || defaultChainId);
          // Set USDC as from asset if available, otherwise first stablecoin
          const usdc = availableAssets.find(a => a.symbol.toUpperCase() === "USDC");
          const fromAsset = usdc || availableAssets[0] || null;
          setFromAsset(fromAsset);
          setFromChainId(fromAsset?.chainId || defaultChainId);
        } else if (initialTradeType === "sell") {
          setFromAsset(initialAsset);
          setFromChainId(initialAsset.chainId || defaultChainId);
          // Receive Cash (USD)
          setToAsset(cashUsdAsset);
          setToChainId(defaultChainId);
          setReceiveAccount({ id: "connected-wallet", name: "Connected wallet", subtitle: "Your wallet" });
        }
        setTradeType(initialTradeType);
      } else if (initialTradeType === "swap") {
        // Swap mode: default to USDC from any chain (with balance, excluding Ethereum) -> USDC on Ethereum
        // If no USDC exists, use highest USD balance holding (excluding Ethereum) -> USDC on Ethereum
        const ethereumChainId = 1;
        
        // Find all USDC assets with balance, excluding Ethereum
        const usdcAssets = availableAssets.filter(
          a => a.symbol.toUpperCase() === "USDC" && 
               a.chainId !== ethereumChainId && 
               (a.balance || 0) > 0
        );
        
        // Find USDC on Ethereum (for destination)
        const ethereumUsdc = availableAssets.find(
          a => a.symbol.toUpperCase() === "USDC" && a.chainId === ethereumChainId
        ) || {
          symbol: "USDC",
          name: "USD Coin",
          color: getAssetColor("USDC"),
          balance: 0,
          balanceUSD: 0,
          type: "token" as const,
          chainId: ethereumChainId,
          chainName: "Ethereum",
        };
        
        // Determine from asset: prefer USDC, fallback to highest USD balance holding (excluding Ethereum)
        let fromAsset: Asset | null = null;
        
        if (usdcAssets.length > 0) {
          // Use USDC with highest balance
          fromAsset = usdcAssets.reduce((prev, current) => 
            (prev.balance || 0) > (current.balance || 0) ? prev : current
          );
        } else {
          // Fallback: find highest USD balance holding excluding Ethereum
          const nonEthereumAssets = availableAssets.filter(
            a => a.chainId !== ethereumChainId && (a.balanceUSD || 0) > 0
          );
          
          if (nonEthereumAssets.length > 0) {
            // Sort by balanceUSD descending and pick the first (highest)
            fromAsset = nonEthereumAssets.sort((a, b) => 
              (b.balanceUSD || 0) - (a.balanceUSD || 0)
            )[0];
          }
        }
        
        setFromAsset(fromAsset);
        setToAsset(ethereumUsdc);
        setFromChainId(fromAsset?.chainId || defaultChainId);
        setToChainId(ethereumChainId);
        setTradeType("swap");
      } else {
        // Default: Buy mode with USDC -> first available asset
        const usdc = availableAssets.find(a => a.symbol.toUpperCase() === "USDC");
        const fromAsset = usdc || availableAssets[0] || null;
        const toAsset = availableAssets.find(a => a.symbol.toUpperCase() !== "USDC") || availableAssets[1] || null;
        setFromAsset(fromAsset);
        setToAsset(toAsset);
        setFromChainId(fromAsset?.chainId || defaultChainId);
        setToChainId(toAsset?.chainId || defaultChainId);
        setTradeType("buy");
      }
      setStep("input");
      setAmount("0");
    }
  }, [open, initialAsset, initialTradeType, availableAssets, cashBalance, cashUsdAsset, chainId, clearQuote, resetExecution]);

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

  const handleReview = useCallback(async () => {
    if (tradeType === "buy") {
      if (paymentMethod.id === "wallet") {
        setStep("review");
        return;
      }
      if (paymentMethod.id === "bank" && address && toAsset && amount && parseFloat(amount) > 0) {
        const destCurrency = toAsset.symbol.toUpperCase() === "USD" ? "USDC" : toAsset.symbol;
        const destNetwork = chainIdToStripeNetwork(toChainId ?? toAsset.chainId);
        const url = await getBridgeFundingUrl(address, amount, destCurrency, destNetwork);
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        setFundingCompleteMessage("Funding initiated. Funds should appear in your wallet within 1-3 business days.");
        setStep("bank_pending");
        return;
      }
      if (paymentMethod.id === "debit" && selectedCardProvider === "stripe") {
        setStep("funding");
        return;
      }
    }
    setStep("review");
  }, [tradeType, paymentMethod.id, selectedCardProvider, address, toAsset, amount, toChainId]);

  // Keyboard event handlers
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape closes from anywhere (or goes back from bank_pending)
      if (event.key === "Escape") {
        event.preventDefault();
        if (step === "bank_pending") {
          setStep("input");
          return;
        }
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
        setToChainId(asset.chainId || chainId || 1);
      } else if (assetPickTarget === "buyFrom") {
        setFromAsset(asset);
        setFromChainId(asset.chainId || chainId || 1);
      } else if (assetPickTarget === "sellFrom") {
        setFromAsset(asset);
        setFromChainId(asset.chainId || chainId || 1);
        setToAsset(cashUsdAsset);
        setToChainId(chainId || 1);
      } else if (assetPickTarget === "swapFrom") {
        setFromAsset(asset);
        setFromChainId(asset.chainId || chainId || 1);
      } else if (assetPickTarget === "swapTo") {
        setToAsset(asset);
        setToChainId(asset.chainId || chainId || 1);
      }
      setScreen("trade");
      setSearchQuery("");
    },
    [assetPickTarget, cashUsdAsset, chainId]
  );

  const handlePickWallet = useCallback(
    (id: string) => {
      if (walletPickTarget === "pay") {
        const found = paymentMethods.find((m) => m.id === id) || paymentMethods[0];
        setPaymentMethod({
          ...found,
          value: id === "wallet" ? cashBalance.totalCash : null,
        });
        if (id === "debit") {
          setScreen("selectCardProvider");
        } else if (id === "wallet") {
          setAssetPickTarget("buyFrom");
          setScreen("selectAsset");
        } else {
          setScreen("trade");
        }
      } else {
        // Receive to (sell flow)
        if (tradeType === "sell") {
          if (id === "connected-wallet") {
            setReceiveAccount({ id: "connected-wallet", name: "Connected wallet", subtitle: "Your wallet" });
            setScreen("trade");
          } else if (id === "external-wallet") {
            setReceiveAccount({ id: "external-wallet", name: "External wallet", subtitle: externalPayoutAddress ? `${externalPayoutAddress.slice(0, 6)}...${externalPayoutAddress.slice(-4)}` : "Enter address" });
            setScreen("externalWalletAddress");
          } else if (id === "connected-bank") {
            setReceiveAccount({ id: "connected-bank", name: "Connected bank", subtitle: "Cash out to bank" });
            setScreen("trade");
          } else if (id === "connected-bank-setup") {
            // Open Bridge or Deposit for bank setup; stay on picker or show message
            window.open("/#/portfolio", "_blank");
            setScreen("trade");
          }
        } else {
          if (id === "cash-usd") {
            setReceiveAccount({ id: "cash-usd", name: "Cash (USD)", subtitle: "Balance" });
            setToAsset(cashUsdAsset);
          }
          setScreen("trade");
        }
      }
      setSearchQuery("");
    },
    [walletPickTarget, cashBalance.totalCash, cashUsdAsset, tradeType, externalPayoutAddress]
  );

  const handleConfirm = async () => {
    if (!quote.route) {
      // If no route, just show success (for USD trades)
      setStep("success");
      return;
    }

    // Immediately show pending screen so when user returns from wallet (e.g. MetaMask) they see clear state
    setStep("pending");

    try {
      await executeTrade(quote.route);
      // Step is synced to success/failed via useEffect below (execution.status)
    } catch (error) {
      console.error('Failed to execute trade:', error);
      setStep("failed");
    }
  };

  // Sync modal step with execution status (handles async state updates from useLifiTrade)
  useEffect(() => {
    if (step !== "pending") return;
    if (execution.status === "success") setStep("success");
    if (execution.status === "failed") setStep("failed");
  }, [step, execution.status]);

  // Recipient address for sell: connected wallet, external wallet, or connected bank (same as wallet for now)
  const sellRecipientAddress = useMemo(() => {
    if (tradeType !== "sell" || !address) return address ?? undefined;
    const id = receiveAccount?.id;
    if (id === "connected-wallet" || id === "connected-bank") return address;
    if (id === "external-wallet" && externalPayoutAddress && isAddress(externalPayoutAddress)) return externalPayoutAddress;
    return address;
  }, [tradeType, address, receiveAccount?.id, externalPayoutAddress]);

  // Fetch quote when amount or assets change (only on input step)
  useEffect(() => {
    const isBuyWithFiat = tradeType === "buy" && (paymentMethod.id === "debit" || paymentMethod.id === "bank");

    if (!open) {
      // Only clear quote when modal is closed, not when transitioning to review step
      clearQuote();
      setQuoteExpiryTime(null);
      setTimeRemaining(null);
      return;
    }

    // Buy with bank or debit: no Li.Fi swap, so don't fetch quote and clear any existing one
    if (isBuyWithFiat) {
      clearQuote();
      setQuoteExpiryTime(null);
      setTimeRemaining(null);
      return;
    }

    if (
      step === "input" &&
      fromAsset &&
      toAsset &&
      fromChainId &&
      toChainId &&
      amount &&
      parseFloat(amount) > 0 &&
      address
    ) {
      // Skip if USD is involved (not a blockchain trade)
      if (fromAsset.symbol === "USD" || toAsset.symbol === "USD") {
        return;
      }
      // For sell with external wallet, require valid address before fetching quote
      if (tradeType === "sell" && receiveAccount?.id === "external-wallet" && (!externalPayoutAddress || !isAddress(externalPayoutAddress))) {
        return;
      }

      const toAddress = tradeType === "sell" ? (sellRecipientAddress ?? address) : address;
      const timeoutId = setTimeout(() => {
        fetchQuote(
          fromChainId,
          fromAsset.symbol,
          amount,
          toChainId,
          toAsset.symbol,
          toAddress
        );
      }, 500); // Debounce quote fetching

      return () => clearTimeout(timeoutId);
    }
  }, [open, step, fromAsset, toAsset, fromChainId, toChainId, amount, address, tradeType, paymentMethod.id, receiveAccount?.id, externalPayoutAddress, sellRecipientAddress, fetchQuote, clearQuote]);

  // Set quote expiry time when quote is received
  useEffect(() => {
    if (quote.quote && !quote.error) {
      const quoteResult = quote.quote as any;
      const validUntil = quoteResult.validUntil;
      const expiryTime = validUntil 
        ? validUntil * 1000 
        : Date.now() + 60000; // Default to 60 seconds from now
      setQuoteExpiryTime(expiryTime);
    } else {
      setQuoteExpiryTime(null);
      setTimeRemaining(null);
    }
  }, [quote.quote, quote.error]);

  // Update quote expiry timer
  useEffect(() => {
    if (!quoteExpiryTime) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((quoteExpiryTime - Date.now()) / 1000));
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [quoteExpiryTime]);

  // Auto-refresh quote on review when it expires (stay on review page)
  useEffect(() => {
    if (!open || step !== "review") return;
    if (!quoteExpiryTime) return;
    if (timeRemaining === null || timeRemaining > 0) return;
    if (quote.isLoading) return;

    if (!fromAsset || !toAsset || !fromChainId || !toChainId || !address) return;
    if (!amount || parseFloat(amount) <= 0) return;
    // Skip if USD is involved (not a blockchain trade)
    if (fromAsset.symbol === "USD" || toAsset.symbol === "USD") return;

    // Prevent repeated auto-refresh for the same expired quote
    if (lastAutoRefreshExpiryRef.current === quoteExpiryTime) return;
    lastAutoRefreshExpiryRef.current = quoteExpiryTime;

    const toAddress = tradeType === "sell" ? (sellRecipientAddress ?? address) : address;
    fetchQuote(fromChainId, fromAsset.symbol, amount, toChainId, toAsset.symbol, toAddress);
  }, [
    open,
    step,
    quoteExpiryTime,
    timeRemaining,
    quote.isLoading,
    fromAsset,
    toAsset,
    fromChainId,
    toChainId,
    amount,
    address,
    tradeType,
    sellRecipientAddress,
    fetchQuote,
  ]);

  // Stripe Onramp: when step is "funding" and payment is debit/card, create session with toAsset + amount and mount
  useEffect(() => {
    if (
      !open ||
      step !== "funding" ||
      paymentMethod.id !== "debit" ||
      selectedCardProvider !== "stripe" ||
      !address ||
      !toAsset ||
      !amount ||
      parseFloat(amount) <= 0 ||
      !stripeOnrampRef.current
    ) {
      return;
    }

    let mounted = true;
    const network = chainIdToStripeNetwork(toChainId ?? toAsset.chainId);
    const destCurrency = (toAsset.symbol === "USD" ? "usdc" : toAsset.symbol).toLowerCase();

    const initStripeOnramp = async () => {
      setStripeOnrampLoading(true);
      try {
        await loadStripeScripts();
        if (!mounted || !stripeOnrampRef.current) return;
        if (!window.StripeOnramp) throw new Error("Stripe Onramp is not available");

        const sessionData = await createStripeOnrampSession({
          wallet_addresses: { [network]: address },
          destination_currency: destCurrency,
          destination_network: network,
          destination_amount: amount,
        });
        if (!sessionData || !mounted || !stripeOnrampRef.current) return;

        const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (!stripePublishableKey) throw new Error("Stripe publishable key is not configured");

        const stripeOnramp = window.StripeOnramp(stripePublishableKey);
        const session = stripeOnramp.createSession({
          clientSecret: sessionData.client_secret,
          appearance: { theme: document.documentElement.classList.contains("dark") ? "dark" : "light" },
        });

        session.addEventListener("onramp_session_updated", (event: any) => {
          const status = event?.payload?.session?.status;
          if (status === "fulfillment_complete" || status === "rejected") {
            setFundingCompleteMessage(
              status === "fulfillment_complete"
                ? "Order placed. Funds are on the way to your wallet."
                : "Order was not completed."
            );
            setStep("funding_complete");
          }
        });

        if (stripeOnrampRef.current) {
          stripeOnrampRef.current.innerHTML = "";
          session.mount(stripeOnrampRef.current);
          stripeSessionRef.current = session;
        }
      } catch (err) {
        console.error("Stripe Onramp init error:", err);
        setFundingCompleteMessage("Failed to load payment form. Please try again.");
        setStep("funding_complete");
      } finally {
        if (mounted) setStripeOnrampLoading(false);
      }
    };

    initStripeOnramp();
    return () => {
      mounted = false;
      if (stripeOnrampRef.current) stripeOnrampRef.current.innerHTML = "";
      stripeSessionRef.current = null;
    };
  }, [
    open,
    step,
    paymentMethod.id,
    selectedCardProvider,
    address,
    toAsset,
    toChainId,
    amount,
    loadStripeScripts,
  ]);

  const getConversionAmount = () => {
    // Only use Li.Fi quote if available and valid (no fallback to mock rates)
    if (quote.estimatedOutput && parseFloat(quote.estimatedOutput) > 0 && !quote.error && !quote.isLoading) {
      const output = parseFloat(quote.estimatedOutput);
      // Format based on size - show more decimals for small amounts
      if (output < 0.0001) {
        return output.toFixed(8);
      } else if (output < 1) {
        return output.toFixed(6);
      } else if (output < 1000) {
        return output.toFixed(4);
      } else {
        return output.toFixed(2);
      }
    }

    // Return "0" if no valid quote (don't show mock rates)
    return "0";
  };

  const swapAssets = () => {
    if (!fromAsset || !toAsset) return;
    const tempAsset = fromAsset;
    const tempChainId = fromChainId;
    setFromAsset(toAsset);
    setToAsset(tempAsset);
    setFromChainId(toChainId);
    setToChainId(tempChainId);
  };

  // When in sell mode, default receive-to to connected wallet if currently cash-usd (from buy/swap)
  useEffect(() => {
    if (!open || tradeType !== "sell") return;
    if (receiveAccount?.id === "cash-usd" || !receiveAccount) {
      setReceiveAccount({ id: "connected-wallet", name: "Connected wallet", subtitle: "Your wallet" });
    }
  }, [open, tradeType, receiveAccount?.id]);

  // Preserve assets when switching between buy/sell/swap tabs
  const prevTradeTypeRef = useRef<TradeType | null>(null);
  
  useEffect(() => {
    if (!open || step !== "input") {
      prevTradeTypeRef.current = tradeType;
      return;
    }
    
    // Only adjust if tradeType actually changed
    if (prevTradeTypeRef.current === tradeType) {
      return;
    }
    
    // Only adjust if we have assets selected
    if (!fromAsset || !toAsset) {
      prevTradeTypeRef.current = tradeType;
      return;
    }

    prevTradeTypeRef.current = tradeType;
    
    if (tradeType === "buy") {
      // Buy mode: fromAsset should be payment (USDC/USDT/USD), toAsset is what we're buying
      // If toAsset is USD, that's wrong for buy mode - swap them
      if (toAsset.symbol === "USD" && fromAsset.symbol !== "USD") {
        const tempAsset = fromAsset;
        const tempChainId = fromChainId;
        // Find USDC or first stablecoin for payment
        const usdc = availableAssets.find(a => a.symbol.toUpperCase() === "USDC");
        setFromAsset(usdc || availableAssets[0] || null);
        setFromChainId(usdc?.chainId || fromChainId || 1);
        setToAsset(tempAsset);
        setToChainId(tempChainId);
      }
      // If fromAsset is USD, that's fine for buy mode
    } else if (tradeType === "sell") {
      // Sell mode: fromAsset is what we're selling, toAsset should be USD
      // If fromAsset is USD, that's wrong - find a token to sell
      if (fromAsset.symbol === "USD") {
        // Try to use toAsset if it's a token, otherwise find another token
        if (toAsset.symbol !== "USD") {
          setFromAsset(toAsset);
          setFromChainId(toChainId);
          setToAsset(cashUsdAsset);
          setToChainId(chainId || 1);
        } else {
          const tokenToSell = availableAssets.find(a => a.symbol !== "USD");
          if (tokenToSell) {
            setFromAsset(tokenToSell);
            setFromChainId(tokenToSell.chainId || chainId || 1);
            setToAsset(cashUsdAsset);
            setToChainId(chainId || 1);
          }
        }
      }
      // If toAsset is not USD, set it to USD
      else if (toAsset.symbol !== "USD") {
        setToAsset(cashUsdAsset);
        setToChainId(chainId || 1);
      }
    } else if (tradeType === "swap") {
      // Swap mode: both should be tokens (not USD)
      // If fromAsset is USD, swap them if toAsset is a token
      if (fromAsset.symbol === "USD" && toAsset.symbol !== "USD") {
        setFromAsset(toAsset);
        setFromChainId(toChainId);
        // Find another token for toAsset
        const tokenToReceive = availableAssets.find(a => a.symbol !== "USD" && a.symbol !== toAsset.symbol);
        if (tokenToReceive) {
          setToAsset(tokenToReceive);
          setToChainId(tokenToReceive.chainId || chainId || 1);
        } else {
          setToAsset(cashUsdAsset);
          setToChainId(chainId || 1);
        }
      }
      // If toAsset is USD, find a token to receive
      else if (toAsset.symbol === "USD" && fromAsset.symbol !== "USD") {
        const tokenToReceive = availableAssets.find(a => a.symbol !== "USD" && a.symbol !== fromAsset.symbol);
        if (tokenToReceive) {
          setToAsset(tokenToReceive);
          setToChainId(tokenToReceive.chainId || chainId || 1);
        }
      }
      // If both are USD, find tokens for both
      else if (fromAsset.symbol === "USD" && toAsset.symbol === "USD") {
        const tokens = availableAssets.filter(a => a.symbol !== "USD");
        if (tokens.length >= 2) {
          setFromAsset(tokens[0]);
          setFromChainId(tokens[0].chainId || chainId || 1);
          setToAsset(tokens[1]);
          setToChainId(tokens[1].chainId || chainId || 1);
        } else if (tokens.length === 1) {
          setFromAsset(tokens[0]);
          setFromChainId(tokens[0].chainId || chainId || 1);
        }
      }
    }
  }, [tradeType, open, step, fromAsset, toAsset, availableAssets, cashUsdAsset, chainId, fromChainId, toChainId]);

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
                        : assetPickTarget === "buyFrom"
                        ? "Select asset to pay with"
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
                          (assetPickTarget === "buyFrom" && fromAsset?.symbol === a.symbol && fromAsset?.chainId === a.chainId) ||
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
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{a.symbol}</span>
                                  {a.chainName && (
                                    <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                      {a.chainName}
                                    </span>
                                  )}
                                </div>
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
                              ? (m as { subtitle?: string }).subtitle ?? "Select token and chain"
                              : m.id === "debit"
                              ? "Debit, credit, Apple Pay"
                              : "Connected bank account";
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
                    ) : tradeType === "sell" ? (
                      <>
                        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 px-2 py-2">
                          Receive to
                        </div>
                        <button
                          onClick={() => handlePickWallet("connected-wallet")}
                          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                              <Wallet className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                            </div>
                            <div>
                              <div className="text-black dark:text-white font-medium">Connected wallet</div>
                              <div className="text-sm text-zinc-500 dark:text-zinc-400">Proceeds to your wallet</div>
                            </div>
                          </div>
                          {receiveAccount?.id === "connected-wallet" && (
                            <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                              <Check className="w-4 h-4 text-white dark:text-black" />
                            </div>
                          )}
                        </button>
                        <button
                          onClick={() => handlePickWallet("external-wallet")}
                          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                              📤
                            </div>
                            <div>
                              <div className="text-black dark:text-white font-medium">External wallet</div>
                              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                {externalPayoutAddress && isAddress(externalPayoutAddress)
                                  ? `${externalPayoutAddress.slice(0, 8)}...${externalPayoutAddress.slice(-6)}`
                                  : "Enter address"}
                              </div>
                            </div>
                          </div>
                          {receiveAccount?.id === "external-wallet" && (
                            <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                              <Check className="w-4 h-4 text-white dark:text-black" />
                            </div>
                          )}
                        </button>
                        {bankLinked ? (
                          <button
                            onClick={() => handlePickWallet("connected-bank")}
                            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                🏦
                              </div>
                              <div>
                                <div className="text-black dark:text-white font-medium">Connected bank</div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400">Cash out to bank</div>
                              </div>
                            </div>
                            {receiveAccount?.id === "connected-bank" && (
                              <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                <Check className="w-4 h-4 text-white dark:text-black" />
                              </div>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePickWallet("connected-bank-setup")}
                            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left opacity-90"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                🏦
                              </div>
                              <div>
                                <div className="text-black dark:text-white font-medium">Set up bank payout</div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400">Connect bank in Deposit to enable</div>
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                          </button>
                        )}
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

              {screen === "selectCardProvider" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => setScreen("selectWallet")}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Fund with Debit/Card</h2>
                    <div className="w-9" />
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 px-2 py-2">
                      Choose provider
                    </div>
                    {cardFundingProviders.map((provider) => {
                      const isSelected = selectedCardProvider === provider.id;
                      const isDisabled = !provider.enabled;
                      return (
                        <button
                          key={provider.id}
                          onClick={() => {
                            if (provider.enabled) {
                              setSelectedCardProvider(provider.id);
                              setScreen("trade");
                            }
                          }}
                          disabled={isDisabled}
                          className={cn(
                            "w-full flex items-center justify-between p-4 rounded-xl border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left transition-colors",
                            isDisabled
                              ? "opacity-50 cursor-not-allowed pointer-events-none"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
                            isSelected && !isDisabled && "border-zinc-200 dark:border-zinc-800"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                              💳
                            </div>
                            <div>
                              <div className="text-black dark:text-white font-medium">{provider.name}</div>
                              <div className="text-sm text-zinc-500 dark:text-zinc-400">{provider.subtitle}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {isSelected && provider.enabled ? (
                              <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                <Check className="w-4 h-4 text-white dark:text-black" />
                              </div>
                            ) : (
                              !isDisabled && <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {screen === "externalWalletAddress" && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => setScreen("selectWallet")}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Receive to external wallet</h2>
                    <div className="w-9" />
                  </div>
                  <div className="flex-1 p-4 space-y-4">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Enter a valid EVM address for the receive chain ({toAsset?.chainName ?? "same chain"}). Proceeds will be sent to this address.
                    </p>
                    <input
                      type="text"
                      value={externalPayoutAddress}
                      onChange={(e) => {
                        setExternalPayoutAddress(e.target.value);
                        setExternalPayoutAddressError(null);
                      }}
                      onBlur={() => {
                        if (externalPayoutAddress.trim() && !isAddress(externalPayoutAddress.trim())) {
                          setExternalPayoutAddressError("Invalid wallet address");
                        } else {
                          setExternalPayoutAddressError(null);
                        }
                      }}
                      placeholder="0x..."
                      className={cn(
                        "w-full rounded-xl border bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-black dark:text-white placeholder:text-zinc-500",
                        externalPayoutAddressError ? "border-red-500 dark:border-red-500" : "border-zinc-200 dark:border-zinc-800"
                      )}
                    />
                    {externalPayoutAddressError && (
                      <p className="text-sm text-red-500 dark:text-red-400">{externalPayoutAddressError}</p>
                    )}
                    <Button
                      onClick={() => {
                        const trimmed = externalPayoutAddress.trim();
                        if (!trimmed) {
                          setExternalPayoutAddressError("Enter an address");
                          return;
                        }
                        if (!isAddress(trimmed)) {
                          setExternalPayoutAddressError("Invalid wallet address");
                          return;
                        }
                        setExternalPayoutAddressError(null);
                        setReceiveAccount({ id: "external-wallet", name: "External wallet", subtitle: `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` });
                        setScreen("trade");
                      }}
                      className="w-full h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black"
                    >
                      Done
                    </Button>
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
                        {tradeType === "swap" || tradeType === "sell"
                          ? (fromAsset ? fromAsset.symbol : "USD")
                          : "USD"}
                      </span>
                    </div>
                    {toAsset && parseFloat(amount) > 0 && (() => {
                      const isBuyWithFiat = tradeType === "buy" && (paymentMethod.id === "debit" || paymentMethod.id === "bank");
                      return (
                      <div className="flex flex-col items-center gap-1 mt-2">
                        {!isBuyWithFiat && quote.isLoading && fromAsset?.symbol !== "USD" && toAsset.symbol !== "USD" && (
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Fetching quote...</span>
                          </div>
                        )}
                        {!isBuyWithFiat && quote.error && fromAsset?.symbol !== "USD" && toAsset.symbol !== "USD" && (
                          <div className="flex items-center gap-1 text-xs text-red-500 max-w-[200px] text-center">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{quote.error}</span>
                          </div>
                        )}
                        {/* Only show conversion amount when quote is loaded and valid (not for buy with bank/debit) */}
                        {!isBuyWithFiat && quote.estimatedOutput && parseFloat(quote.estimatedOutput) > 0 && !quote.error && !quote.isLoading && (
                          <>
                            <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                              <ArrowUpDown className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                {getConversionAmount()} {toAsset.symbol}
                              </span>
                            </div>
                            {quote.estimatedOutputUSD > 0 && (
                              <div className="text-xs text-zinc-500">
                                ≈ ${quote.estimatedOutputUSD.toFixed(2)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      );
                    })()}
                  </div>

                  {/* Asset Selectors */}
                  <div className="px-4 space-y-1 mb-4">
                    {tradeType === "swap" ? (
                      <>
                        {/* Swap From/To */}
                        <div className="relative">
                          <button
                            onClick={() => openAssetPicker("swapFrom")}
                            className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                          >
                            <div className="flex items-center gap-3">
                              {fromAsset && (
                                <>
                                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", fromAsset.color)}>
                                    {fromAsset.symbol.charAt(0)}
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">You pay</p>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-black dark:text-white">{fromAsset.name}</p>
                                      {fromAsset.chainName && (
                                        <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                          {fromAsset.chainName}
                                        </span>
                                      )}
                                    </div>
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
                          
                          <button 
                            onClick={swapAssets}
                            className="absolute left-1/2 -translate-x-1/2 -bottom-4 z-10 w-8 h-8 bg-white dark:bg-[#0e0e0e] border border-zinc-200 dark:border-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                          >
                            <ArrowUpDown className="w-4 h-4 text-zinc-900 dark:text-white" />
                          </button>
                        </div>

                        <button
                          onClick={() => openAssetPicker("swapTo")}
                          className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10 mt-2"
                        >
                          <div className="flex items-center gap-3">
                            {toAsset && (
                              <>
                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", toAsset.color)}>
                                  {toAsset.symbol.charAt(0)}
                                </div>
                                <div className="text-left">
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">You receive</p>
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-black dark:text-white">{toAsset.name}</p>
                                    {toAsset.chainName && (
                                      <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                        {toAsset.chainName}
                                      </span>
                                    )}
                                  </div>
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
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                            >
                              <div className="flex items-center gap-3">
                                {paymentMethod.id === "wallet" && fromAsset ? (
                                  <>
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", fromAsset.color)}>
                                      {fromAsset.symbol.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Pay with</p>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium text-black dark:text-white">{fromAsset.name}</p>
                                        {fromAsset.chainName && (
                                          <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                            {fromAsset.chainName}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                      {paymentMethod.icon}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-black dark:text-white">Pay with</p>
                                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {paymentMethod.id === "wallet"
                                          ? "Select token and chain"
                                          : paymentMethod.id === "debit"
                                            ? (cardFundingProviders.find((p) => p.id === selectedCardProvider)?.name ?? paymentMethod.name)
                                            : paymentMethod.name}
                                      </p>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {paymentMethod.id === "wallet" && fromAsset?.balance !== undefined && (
                                  <div className="text-right">
                                    <p className="text-sm font-medium text-black dark:text-white">
                                      {formatBalance(fromAsset.balance)} {fromAsset.symbol}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Available</p>
                                  </div>
                                )}
                                {paymentMethod.id !== "wallet" && paymentMethod.value !== null && (
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
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                            >
                              <div className="flex items-center gap-3">
                                {toAsset && (
                                  <>
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", toAsset.color)}>
                                      {toAsset.symbol.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-black dark:text-white">Buy</p>
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{toAsset.name}</p>
                                        {toAsset.chainName && (
                                          <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                            {toAsset.chainName}
                                          </span>
                                        )}
                                      </div>
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
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                            >
                              <div className="flex items-center gap-3">
                                {fromAsset && (
                                  <>
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold", fromAsset.color)}>
                                      {fromAsset.symbol.charAt(0)}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-black dark:text-white">Sell</p>
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{fromAsset.name}</p>
                                        {fromAsset.chainName && (
                                          <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                            {fromAsset.chainName}
                                          </span>
                                        )}
                                      </div>
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
                              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                  {receiveAccount?.id === "connected-wallet" ? (
                                    <Wallet className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                                  ) : receiveAccount?.id === "external-wallet" ? (
                                    "📤"
                                  ) : receiveAccount?.id === "connected-bank" ? (
                                    "🏦"
                                  ) : (
                                    paymentMethod.icon
                                  )}
                                </div>
                                <div className="text-left">
                                  <p className="font-medium text-black dark:text-white">Receive to</p>
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{receiveAccount?.name || cashUsdAsset.name}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <p className="text-sm font-medium text-black dark:text-white">
                                    {receiveAccount?.id === "external-wallet" && externalPayoutAddress
                                      ? `${externalPayoutAddress.slice(0, 6)}...${externalPayoutAddress.slice(-4)}`
                                      : receiveAccount?.subtitle ?? `$${cashBalance.totalCash.toFixed(2)}`}
                                  </p>
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {receiveAccount?.id === "connected-wallet" ? "Your wallet" : receiveAccount?.id === "connected-bank" ? "Cash out" : "Balance"}
                                  </p>
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
                    {(() => {
                      const isBuyWithFiat = tradeType === "buy" && (paymentMethod.id === "debit" || paymentMethod.id === "bank");
                      const disabled =
                        amount === "0" ||
                        parseFloat(amount) <= 0 ||
                        !toAsset ||
                        (!isBuyWithFiat && !fromAsset) ||
                        (tradeType === "sell" && receiveAccount?.id === "external-wallet" && (!externalPayoutAddress || !isAddress(externalPayoutAddress.trim()))) ||
                        (!isBuyWithFiat && fromAsset && toAsset && fromAsset.symbol !== "USD" && toAsset.symbol !== "USD" && !quote.route) ||
                        (!isBuyWithFiat && quote.isLoading) ||
                        execution.isExecuting;
                      const showQuoteLoading = quote.isLoading && !isBuyWithFiat;
                      return (
                        <Button
                          onClick={handleReview}
                          disabled={disabled}
                          className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
                        >
                          {execution.isExecuting ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Executing...
                            </>
                          ) : showQuoteLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Loading quote...
                            </>
                          ) : (
                            "Review order"
                          )}
                        </Button>
                      );
                    })()}
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

              {step === "bank_pending" && paymentMethod.id === "bank" && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center mb-4">
                    <Loader2 className="w-8 h-8 text-zinc-500 dark:text-zinc-400 animate-spin" />
                  </div>
                  <h2 className="text-xl font-semibold text-black dark:text-white mb-2">
                    Complete in Bridge
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[280px]">
                    Complete your transfer in the Bridge tab. When you&apos;re done, return here and tap the button below.
                  </p>
                  <div className="w-full max-w-[280px] space-y-3">
                    <Button
                      onClick={() => setStep("funding_complete")}
                      className="w-full h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black"
                    >
                      I&apos;ve completed funding
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setStep("input")}
                      className="w-full h-12 rounded-full font-semibold border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Go back
                    </Button>
                  </div>
                </div>
              )}

              {step === "funding_complete" && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-black dark:bg-white flex items-center justify-center mb-4">
                    <Check className="w-8 h-8 text-white dark:text-black" />
                  </div>
                  <h2 className="text-xl font-semibold text-black dark:text-white mb-2">
                    {paymentMethod.id === "bank" ? "Funding initiated" : "Order placed"}
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[280px]">
                    {fundingCompleteMessage}
                  </p>
                  <Button
                    onClick={handleClose}
                    className="w-full max-w-[280px] h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black"
                  >
                    Done
                  </Button>
                </div>
              )}

              {step === "funding" && paymentMethod.id === "debit" && address && toAsset && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => setStep("input")}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Fund with card</h2>
                    <div className="w-9" />
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    {stripeOnrampLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900/50">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                      </div>
                    )}
                    <div
                      ref={stripeOnrampRef}
                      className="w-full h-full min-h-[400px]"
                    />
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

                  <div className="flex-1 p-4 space-y-4 overflow-y-auto pb-24">
                    {/* Order Summary */}
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4 space-y-4 border border-zinc-200 dark:border-white/10">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">
                          You're {tradeType === "swap" ? "swapping" : tradeType === "buy" ? "buying" : "selling"}
                        </span>
                        {toAsset && quote.estimatedOutput && parseFloat(quote.estimatedOutput) > 0 && !quote.error && !quote.isLoading && (
                          <div className="flex items-center gap-2">
                            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold", toAsset.color)}>
                              {toAsset.symbol.charAt(0)}
                            </div>
                            <div className="text-right">
                              <span className="font-semibold text-black dark:text-white block">
                                {getConversionAmount()} {toAsset.symbol}
                              </span>
                              {quote.estimatedOutputUSD > 0 && (
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                  ≈ ${quote.estimatedOutputUSD.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {toAsset && (quote.isLoading || (!quote.estimatedOutput && !quote.error)) && fromAsset?.symbol !== "USD" && toAsset.symbol !== "USD" && (
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Loading quote...</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">For</span>
                        <div className="text-right">
                          <span className="font-semibold text-black dark:text-white block">
                            {amount} {fromAsset?.symbol || "USD"}
                          </span>
                          {fromAsset?.symbol !== "USD" && quote.quote && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              ≈ ${(parseFloat((quote.quote as any).action?.fromToken?.priceUSD || "0") * parseFloat(amount || "0")).toFixed(2)} USD
                            </span>
                          )}
                          {fromAsset?.symbol === "USD" && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              ≈ ${parseFloat(amount || "0").toFixed(2)} USD
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quote Expiry Timer */}
                    {quote.quote && !quote.error && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full",
                            timeRemaining !== null && timeRemaining < 10 ? "bg-red-500 animate-pulse" : "bg-blue-500"
                          )} />
                          <span className="text-sm text-blue-600 dark:text-blue-400">
                            {timeRemaining !== null && timeRemaining > 0 
                              ? `Quote expires in ${timeRemaining}s`
                              : "Quote valid"
                            }
                          </span>
                        </div>
                        {(timeRemaining === null || timeRemaining < 10) && (
                          <button
                            onClick={() => {
                              if (fromAsset && toAsset && fromChainId && toChainId && amount && parseFloat(amount) > 0 && address) {
                                fetchQuote(
                                  fromChainId,
                                  fromAsset.symbol,
                                  amount,
                                  toChainId,
                                  toAsset.symbol,
                                  address
                                );
                              }
                            }}
                            className="text-xs text-blue-600 dark:text-blue-400 underline"
                          >
                            Refresh
                          </button>
                        )}
                      </div>
                    )}

                    {/* Details */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-zinc-500 dark:text-zinc-400">Payment method</span>
                        <span className="text-black dark:text-white">{paymentMethod.name}</span>
                      </div>
                      
                      {/* From/To Assets with Chains */}
                      {fromAsset && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">From</span>
                          <div className="text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-black dark:text-white font-medium">{fromAsset.symbol}</span>
                              {fromAsset.chainName && (
                                <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                  {fromAsset.chainName}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{fromAsset.name}</span>
                          </div>
                        </div>
                      )}
                      
                      {toAsset && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">To</span>
                          <div className="text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-black dark:text-white font-medium">{toAsset.symbol}</span>
                              {toAsset.chainName && (
                                <span className="text-xs text-zinc-400 dark:text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                  {toAsset.chainName}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{toAsset.name}</span>
                          </div>
                        </div>
                      )}

                      {fromChainId && toChainId && fromChainId !== toChainId && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Bridge</span>
                          <span className="text-black dark:text-white text-sm">
                            {SUPPORTED_NETWORKS.find(n => n.chainId === fromChainId)?.name || `Chain ${fromChainId}`} → {SUPPORTED_NETWORKS.find(n => n.chainId === toChainId)?.name || `Chain ${toChainId}`}
                          </span>
                        </div>
                      )}
                      
                      {/* Exchange Rate - Only show when quote is loaded and valid */}
                      {toAsset && quote.estimatedOutput && parseFloat(quote.estimatedOutput) > 0 && !quote.error && !quote.isLoading && parseFloat(amount || "0") > 0 && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Exchange rate</span>
                          <div className="text-right">
                            <span className="text-black dark:text-white text-sm">
                              1 {fromAsset?.symbol || "USD"} = {(parseFloat(getConversionAmount()) / parseFloat(amount || "1")).toFixed(8)} {toAsset.symbol}
                            </span>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                              1 {toAsset.symbol} ≈ ${quote.estimatedOutputUSD > 0 ? (quote.estimatedOutputUSD / parseFloat(getConversionAmount())).toFixed(4) : (parseFloat(amount || "0") / parseFloat(getConversionAmount())).toFixed(4)} USD
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Slippage */}
                      {quote.quote && (quote.quote as any).slippage !== undefined && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Slippage tolerance</span>
                          <span className="text-black dark:text-white">
                            {((quote.quote as any).slippage * 100).toFixed(2)}%
                          </span>
                        </div>
                      )}

                      {/* Gas Costs */}
                      {quote.quote && (quote.quote as any).estimate?.gasCosts && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Network fees</span>
                          <div className="text-right">
                            {(quote.quote as any).estimate.gasCosts.map((cost: any, idx: number) => (
                              <div key={idx} className="text-black dark:text-white text-sm">
                                {cost.amount} {cost.token.symbol}
                                {cost.amountUSD && (
                                  <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-1">
                                    (${parseFloat(cost.amountUSD).toFixed(2)})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {quote.executionTime > 0 && (
                        <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                          <span className="text-zinc-500 dark:text-zinc-400">Estimated time</span>
                          <span className="text-black dark:text-white">
                            {quote.executionTime < 60 
                              ? `${quote.executionTime}s` 
                              : `${Math.floor(quote.executionTime / 60)}m ${quote.executionTime % 60}s`
                            }
                          </span>
                        </div>
                      )}

                      {/* Total Output - Only show when quote is loaded and valid */}
                      {quote.estimatedOutput && parseFloat(quote.estimatedOutput) > 0 && !quote.error && !quote.isLoading && (
                        <div className="flex items-center justify-between py-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                          <span className="font-semibold text-black dark:text-white">You will receive</span>
                          <div className="text-right">
                            <span className="font-semibold text-black dark:text-white block">
                              {getConversionAmount()} {toAsset?.symbol || ""}
                            </span>
                            {quote.estimatedOutputUSD > 0 && (
                              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                ≈ ${quote.estimatedOutputUSD.toFixed(2)} USD
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Show loading state when quote is being fetched */}
                      {quote.isLoading && fromAsset?.symbol !== "USD" && toAsset?.symbol !== "USD" && (
                        <div className="flex items-center justify-between py-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                          <span className="font-semibold text-black dark:text-white">You will receive</span>
                          <div className="flex items-center gap-2 text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Loading quote...</span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Execution Status */}
                    {execution.isExecuting && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            Executing trade...
                          </span>
                        </div>
                        {execution.transactionHashes.length > 0 && (
                          <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                            {execution.transactionHashes.map((txHash, idx) => (
                              <div key={idx} className="truncate">
                                Step {idx + 1}: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {execution.error && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                          <AlertCircle className="w-4 h-4" />
                          <span className="text-sm">{execution.error}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Fixed button at bottom for mobile */}
                  <div className="fixed bottom-0 left-0 right-0 sm:relative sm:bottom-auto bg-white dark:bg-[#0e0e0e] border-t border-zinc-200 dark:border-zinc-800 sm:border-t-0 p-4 pt-3 pb-safe sm:p-4">
                    <Button 
                      onClick={handleConfirm}
                      disabled={
                        execution.isExecuting || 
                        (!quote.route && fromAsset?.symbol !== "USD" && toAsset?.symbol !== "USD") ||
                        (fromAsset?.symbol !== "USD" && toAsset?.symbol !== "USD" && quote.isLoading)
                      }
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 mb-2"
                    >
                      {execution.isExecuting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Executing...
                        </>
                      ) : (fromAsset?.symbol !== "USD" && toAsset?.symbol !== "USD" && quote.isLoading) ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Refreshing quote...
                        </>
                      ) : (
                        `Confirm ${tradeType}`
                      )}
                    </Button>
                    <p className="text-xs text-center text-zinc-500 dark:text-zinc-400 px-4 leading-relaxed">
                      By confirming, you agree to our{" "}
                      <a 
                        href="/terms" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        Terms & Conditions
                      </a>
                      {" "}and acknowledge that cryptocurrency transactions are irreversible.
                    </p>
                  </div>
                </div>
              )}

              {step === "pending" && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-6">
                    {execution.transactionHashes.length === 0 ? (
                      <Wallet className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
                    )}
                  </div>
                  <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
                    {execution.transactionHashes.length === 0
                      ? "Confirm in your wallet"
                      : "Processing your trade"}
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[280px]">
                    {execution.transactionHashes.length === 0 ? (
                      <>
                        You may have been switched to MetaMask or your wallet app. Approve the transaction there, then return here.
                      </>
                    ) : (
                      <>
                        Waiting for confirmations… Step {execution.transactionHashes.length} submitted.
                      </>
                    )}
                  </p>
                  {execution.transactionHashes.length > 0 && (
                    <div className="w-full space-y-2 mb-6">
                      {execution.transactionHashes.map((txHash, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
                        >
                          <span>Step {idx + 1}:</span>
                          <code className="truncate max-w-[180px] font-mono">
                            {txHash.slice(0, 10)}…{txHash.slice(-8)}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[260px]">
                    You can reject the transaction in your wallet to cancel.
                  </p>
                </div>
              )}

              {step === "failed" && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-6">
                    <X className="w-10 h-10 text-red-600 dark:text-red-400" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
                    {execution.error && /reject|denied|cancel|user/i.test(execution.error)
                      ? "Transaction canceled"
                      : "Transaction failed"}
                  </h2>
                  {execution.error && (
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[280px]">
                      {execution.error}
                    </p>
                  )}
                  <div className="flex flex-col gap-3 w-full max-w-[280px]">
                    <Button
                      onClick={() => {
                        resetExecution();
                        setStep("review");
                      }}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      Try again
                    </Button>
                    <Button
                      onClick={handleClose}
                      variant="secondary"
                      className="w-full h-14 rounded-full text-base font-semibold bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Close
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
