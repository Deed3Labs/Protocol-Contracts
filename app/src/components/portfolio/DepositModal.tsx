import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Building2, Wallet, CreditCard, ArrowDownLeft, ChevronRight, Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import { createStripeOnrampSession, getPlaidLinkToken, exchangePlaidToken, getBridgeOnboardingUrl } from '@/utils/apiClient';
import { usePortfolio } from '@/context/PortfolioContext';

// Type declarations for Stripe Onramp (loaded via script tags)
declare global {
  interface Window {
    StripeOnramp?: (publishableKey: string) => any;
    Plaid?: {
      create: (config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (public_token: string, metadata?: unknown) => void;
        onExit?: (err: unknown, metadata: unknown) => void;
      }) => { open: () => void };
    };
  }
}

const PLAID_OAUTH_STATE_PARAM = 'oauth_state_id';
const PLAID_OAUTH_LINK_TOKEN_KEY = 'plaid_oauth_link_token';
const PLAID_OAUTH_WALLET_KEY = 'plaid_oauth_wallet';

type LiabilityLikeAccount = {
  type?: string;
  subtype?: string;
  available: number | null;
  current: number | null;
  limit?: number | null;
};

function isLiabilityLikeAccount(account: LiabilityLikeAccount): boolean {
  const type = (account.type ?? '').toLowerCase();
  const subtype = (account.subtype ?? '').toLowerCase();
  return (
    type === 'credit' ||
    type === 'loan' ||
    subtype.includes('credit') ||
    subtype.includes('loan') ||
    subtype.includes('mortgage') ||
    subtype.includes('student')
  );
}

function isCreditLikeAccount(account: LiabilityLikeAccount): boolean {
  const type = (account.type ?? '').toLowerCase();
  const subtype = (account.subtype ?? '').toLowerCase();
  return type === 'credit' || subtype.includes('credit');
}

function getAvailableLikeBalance(account: LiabilityLikeAccount): number {
  if (typeof account.available === 'number' && !Number.isNaN(account.available)) {
    return account.available;
  }
  if (isLiabilityLikeAccount(account)) {
    const limit = account.limit;
    const current = account.current;
    if (
      typeof limit === 'number' &&
      !Number.isNaN(limit) &&
      typeof current === 'number' &&
      !Number.isNaN(current)
    ) {
      return Math.max(limit - current, 0);
    }
  }
  return account.current ?? 0;
}

function getSecondaryBalanceLabel(account: LiabilityLikeAccount): string | null {
  const primary = getAvailableLikeBalance(account);
  const current = account.current;
  if (typeof current !== 'number' || Number.isNaN(current)) return null;
  if (current === primary) return null;
  return isLiabilityLikeAccount(account)
    ? `Used: $${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `Current: $${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCreditLimitLabel(account: LiabilityLikeAccount): string | null {
  if (!isCreditLikeAccount(account)) return null;
  if (typeof account.limit === 'number' && !Number.isNaN(account.limit)) {
    return `Limit: $${account.limit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return 'Limit: unavailable';
}

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, open directly to this tab (e.g. "bank" when coming from Linked Accounts) */
  initialOption?: 'bank' | 'card' | null;
}

type DepositOption = 'bank' | 'wire' | 'crypto' | 'card';

const DepositModal = ({ isOpen, onClose, initialOption = null }: DepositModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const onrampElementRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<DepositOption | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onrampSession, setOnrampSession] = useState<any>(null);
  const [isLoadingLinkToken, setIsLoadingLinkToken] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [isPullingAccounts, setIsPullingAccounts] = useState(false);
  const [isLoadingBridgeOnboarding, setIsLoadingBridgeOnboarding] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeOnboardingOpened, setBridgeOnboardingOpened] = useState(false);
  const [bridgeFullName, setBridgeFullName] = useState('');
  const [bridgeEmail, setBridgeEmail] = useState('');
  const [bridgeCustomerType, setBridgeCustomerType] = useState<'individual' | 'business'>('individual');
  const plaidSuccessFiredRef = useRef(false);
  const plaidOAuthResumeAttemptedRef = useRef(false);
  const { address } = useAppKitAccount();
  const { bankAccounts, bankAccountsLoading, cashBalance, refreshBankBalance } = usePortfolio();
  const bankLinked = cashBalance.bankLinked ?? false;

  const hasPlaidOAuthReturnParams = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has(PLAID_OAUTH_STATE_PARAM);
  }, []);

  const clearPlaidOAuthSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(PLAID_OAUTH_LINK_TOKEN_KEY);
      window.sessionStorage.removeItem(PLAID_OAUTH_WALLET_KEY);
    } catch {
      // No-op if sessionStorage is unavailable.
    }

    const url = new URL(window.location.href);
    let mutated = false;
    for (const key of ['oauth_state_id', 'error', 'error_code', 'error_message']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        mutated = true;
      }
    }

    if (mutated) {
      const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
      if (initialOption) setSelectedOption(initialOption);
    } else {
      document.body.style.overflow = 'unset';
      // Reset state when modal closes
      setSelectedOption(null);
      setError(null);
      setOnrampSession(null);
      setBankError(null);
      setIsPullingAccounts(false);
      setBridgeError(null);
      setBridgeOnboardingOpened(false);
      setIsLoadingBridgeOnboarding(false);
      setBridgeFullName('');
      setBridgeEmail('');
      setBridgeCustomerType('individual');
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, initialOption]);

  // Load Stripe scripts dynamically
  const loadStripeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Check if scripts are already loaded
      if (window.StripeOnramp) {
        resolve();
        return;
      }

      // Check if scripts are already being loaded
      if (document.querySelector('script[src*="stripe.js"]')) {
        // Wait for StripeOnramp to be available
        const checkInterval = setInterval(() => {
          if (window.StripeOnramp) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!window.StripeOnramp) {
            reject(new Error('Stripe scripts failed to load'));
          }
        }, 10000);
        return;
      }

      // Load Stripe.js first
      const stripeScript = document.createElement('script');
      stripeScript.src = 'https://js.stripe.com/clover/stripe.js';
      stripeScript.async = true;
      
      stripeScript.onload = () => {
        // Then load crypto onramp script
        const cryptoScript = document.createElement('script');
        cryptoScript.src = 'https://crypto-js.stripe.com/crypto-onramp-outer.js';
        cryptoScript.async = true;
        
        cryptoScript.onload = () => {
          // Wait a bit for StripeOnramp to be available
          const checkInterval = setInterval(() => {
            if (window.StripeOnramp) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          
          // Timeout after 10 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.StripeOnramp) {
              reject(new Error('StripeOnramp not available after loading scripts'));
            }
          }, 10000);
        };
        
        cryptoScript.onerror = () => {
          reject(new Error('Failed to load Stripe crypto onramp script'));
        };
        
        document.head.appendChild(cryptoScript);
      };
      
      stripeScript.onerror = () => {
        reject(new Error('Failed to load Stripe script'));
      };
      
      document.head.appendChild(stripeScript);
    });
  };

  // Initialize Stripe Onramp when debit card is selected
  useEffect(() => {
    if (selectedOption === 'card' && address && onrampElementRef.current) {
      const initializeOnramp = async () => {
        try {
          setIsLoadingSession(true);
          setError(null);

          // Get Stripe publishable key from environment
          const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
          if (!stripePublishableKey) {
            throw new Error('Stripe publishable key is not configured');
          }

          // Load Stripe scripts
          await loadStripeScripts();

          if (!window.StripeOnramp) {
            throw new Error('Stripe Onramp is not available');
          }

          // Create onramp session
          const sessionData = await createStripeOnrampSession({
            wallet_addresses: {
              ethereum: address,
            },
            destination_networks: ['ethereum', 'solana', 'polygon'],
            destination_currencies: ['eth', 'usdc', 'sol'],
          });

          if (!sessionData) {
            throw new Error('Failed to create onramp session');
          }

          // Initialize Stripe Onramp
          const stripeOnramp = window.StripeOnramp(stripePublishableKey);
          if (!stripeOnramp) {
            throw new Error('Failed to initialize Stripe Onramp');
          }

          // Clear the container
          if (onrampElementRef.current) {
            onrampElementRef.current.innerHTML = '';
          }

          // Get current theme from app (dark/light)
          const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

          // Create and mount the onramp session
          const session = stripeOnramp.createSession({
            clientSecret: sessionData.client_secret,
            appearance: {
              theme: currentTheme,
            },
          });

          // Listen for theme changes and update Stripe appearance
          const handleThemeChange = () => {
            const newTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            try {
              session.setAppearance({ theme: newTheme });
            } catch (err) {
              console.warn('Failed to update Stripe theme:', err);
            }
          };

          window.addEventListener('themechange', handleThemeChange);
          window.addEventListener('storage', (e) => {
            if (e.key === 'theme') {
              handleThemeChange();
            }
          });

          // Listen to session updates
          session.addEventListener('onramp_session_updated', (event: any) => {
            const sessionStatus = event.payload.session.status;
            console.log('Onramp session updated:', sessionStatus);
            
            if (sessionStatus === 'fulfillment_complete' || sessionStatus === 'rejected') {
              // Close modal after completion or rejection
              setTimeout(() => {
                onClose();
              }, 2000);
            }
          });

          // Mount the onramp (element must exist - we keep it in DOM with loading overlay)
          const mountEl = onrampElementRef.current;
          if (!mountEl) {
            throw new Error('Payment form container is not available');
          }
          session.mount(mountEl);
          setOnrampSession(session);
        } catch (err) {
          console.error('Error initializing Stripe Onramp:', err);
          setError(err instanceof Error ? err.message : 'Failed to initialize payment');
        } finally {
          setIsLoadingSession(false);
        }
      };

      initializeOnramp();
    }

    // Cleanup onramp session when component unmounts or option changes
    return () => {
      // Remove theme change listeners
      window.removeEventListener('themechange', () => {});
      window.removeEventListener('storage', () => {});
      
      if (onrampSession) {
        try {
          // Stripe onramp sessions don't have a cleanup method, but unmounting is handled by clearing the container
          if (onrampElementRef.current) {
            onrampElementRef.current.innerHTML = '';
          }
        } catch (err) {
          console.error('Error cleaning up onramp session:', err);
        }
      }
    };
  }, [selectedOption, address, onClose]);

  const loadPlaidScript = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.Plaid) {
        resolve();
        return;
      }
      if (document.querySelector('script[src*="plaid.com/link"]')) {
        const check = setInterval(() => {
          if (window.Plaid) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          if (!window.Plaid) reject(new Error('Plaid script failed to load'));
        }, 10000);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.async = true;
      script.onload = () => {
        const check = setInterval(() => {
          if (window.Plaid) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          if (!window.Plaid) reject(new Error('Plaid not available'));
        }, 5000);
      };
      script.onerror = () => reject(new Error('Failed to load Plaid script'));
      document.head.appendChild(script);
    });
  };

  const openPlaidLink = useCallback(async () => {
    if (!address) {
      setBankError('Please connect your wallet first');
      return;
    }
    plaidSuccessFiredRef.current = false;
    setIsLoadingLinkToken(true);
    setBankError(null);
    try {
      const isOAuthResume = hasPlaidOAuthReturnParams();
      let linkToken: string | null = null;
      let useReceivedRedirectUri = false;

      if (isOAuthResume) {
        try {
          const storedWallet = window.sessionStorage.getItem(PLAID_OAUTH_WALLET_KEY);
          const storedLinkToken = window.sessionStorage.getItem(PLAID_OAUTH_LINK_TOKEN_KEY);
          if (
            storedWallet &&
            storedLinkToken &&
            storedWallet.toLowerCase() === address.toLowerCase()
          ) {
            linkToken = storedLinkToken;
            useReceivedRedirectUri = true;
          }
        } catch {
          // Ignore storage read errors and fall back to fetching a fresh link token.
        }

        // If we returned from OAuth but lost the prior Link token, fall back to a fresh non-resume Link session.
        if (!linkToken) {
          clearPlaidOAuthSession();
        }
      }

      if (!linkToken) {
        const linkTokenRes = await getPlaidLinkToken(address);
        if (!linkTokenRes?.link_token) {
          throw new Error('Could not get link token. Plaid may not be configured.');
        }
        linkToken = linkTokenRes.link_token;
        try {
          window.sessionStorage.setItem(PLAID_OAUTH_WALLET_KEY, address.toLowerCase());
          window.sessionStorage.setItem(PLAID_OAUTH_LINK_TOKEN_KEY, linkToken);
        } catch {
          // Ignore storage write errors; non-OAuth institutions can still complete.
        }
      }

      await loadPlaidScript();
      if (!window.Plaid) throw new Error('Plaid Link is not available');
      const handler = window.Plaid.create({
        token: linkToken,
        ...(useReceivedRedirectUri ? { receivedRedirectUri: window.location.href } : {}),
        onSuccess: async (public_token: string) => {
          plaidSuccessFiredRef.current = true;
          clearPlaidOAuthSession();
          const exchanged = await exchangePlaidToken(address, public_token);
          if (exchanged?.success) {
            setBankError(null);
            setIsPullingAccounts(true);
            try {
              // Give the server a moment to persist the new item before refetching
              await new Promise((r) => setTimeout(r, 800));
              await refreshBankBalance();
            } finally {
              setIsPullingAccounts(false);
            }
          } else {
            setBankError('Failed to save connection');
          }
        },
        onExit: (err) => {
          if (plaidSuccessFiredRef.current) return;
          if (useReceivedRedirectUri) {
            clearPlaidOAuthSession();
          }
          if (err) {
            if (typeof err === 'object' && err !== null) {
              const maybePlaidErr = err as {
                error_message?: string;
                display_message?: string | null;
                error_code?: string;
                error_type?: string;
              };
              const msg = maybePlaidErr.display_message || maybePlaidErr.error_message;
              if (msg && maybePlaidErr.error_code) {
                setBankError(`${msg} (${maybePlaidErr.error_code})`);
              } else if (msg) {
                setBankError(msg);
              } else if (maybePlaidErr.error_code) {
                setBankError(`Plaid Link exited with ${maybePlaidErr.error_code}`);
              } else {
                setBankError(err instanceof Error ? err.message : 'Link closed');
              }
              console.error('Plaid Link onExit error:', maybePlaidErr);
            } else {
              setBankError(err instanceof Error ? err.message : 'Link closed');
            }
          } else {
            setBankError('cancelled');
          }
        },
      });
      handler.open();
    } catch (e) {
      setBankError(e instanceof Error ? e.message : 'Failed to open Plaid Link');
    } finally {
      setIsLoadingLinkToken(false);
    }
  }, [address, clearPlaidOAuthSession, hasPlaidOAuthReturnParams, refreshBankBalance]);
  // Reset ref when modal closes so next open doesn't skip onExit
  useEffect(() => {
    if (!isOpen) {
      plaidSuccessFiredRef.current = false;
      plaidOAuthResumeAttemptedRef.current = false;
    }
  }, [isOpen]);

  // If user returns from an OAuth institution (e.g. Chase), resume Link automatically.
  useEffect(() => {
    if (!isOpen || selectedOption !== 'bank') {
      plaidOAuthResumeAttemptedRef.current = false;
      return;
    }
    if (plaidOAuthResumeAttemptedRef.current) return;
    if (!hasPlaidOAuthReturnParams()) return;
    plaidOAuthResumeAttemptedRef.current = true;
    void openPlaidLink();
  }, [hasPlaidOAuthReturnParams, isOpen, openPlaidLink, selectedOption]);

  const openBridgeOnboarding = useCallback(async () => {
    if (!address) {
      setBridgeError('Please connect your wallet first');
      return;
    }

    const normalizedFullName = bridgeFullName.trim();
    const normalizedEmail = bridgeEmail.trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalizedEmail);
    if (normalizedFullName.length < 2) {
      setBridgeError('Please enter your legal full name');
      return;
    }
    if (!emailValid) {
      setBridgeError('Please enter a valid email address');
      return;
    }

    setIsLoadingBridgeOnboarding(true);
    setBridgeError(null);
    setBridgeOnboardingOpened(false);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    let pendingWindow: Window | null = null;
    if (!isStandalone) {
      // Open synchronously to avoid popup blocking on iOS Safari after async awaits.
      pendingWindow = window.open('', '_blank', 'noopener,noreferrer');
    }

    try {
      const onboarding = await getBridgeOnboardingUrl(address, {
        hasPlaidAccount: bankLinked && bankAccounts.length > 0,
        fullName: normalizedFullName,
        email: normalizedEmail,
        customerType: bridgeCustomerType,
      });
      if (!onboarding?.url) {
        throw new Error('Bridge onboarding is unavailable right now');
      }

      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.location.href = onboarding.url;
        setBridgeOnboardingOpened(true);
      } else {
        window.location.assign(onboarding.url);
      }
    } catch (e) {
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.close();
      }
      setBridgeError(e instanceof Error ? e.message : 'Failed to open Bridge onboarding');
    } finally {
      setIsLoadingBridgeOnboarding(false);
    }
  }, [address, bankLinked, bankAccounts.length, bridgeCustomerType, bridgeEmail, bridgeFullName]);

  const bridgeEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(bridgeEmail.trim());
  const canStartBridgeOnboarding = bridgeFullName.trim().length >= 2 && bridgeEmailValid;

  const depositOptions = [
    {
      id: 'bank',
      title: 'Link Bank Account',
      description: 'Connect via Plaid for instant ACH transfers',
      icon: Building2,
      delay: 0.1,
    },
    {
      id: 'wire',
      title: 'Direct Deposit (Bridge)',
      description: 'Onboard in Bridge for payroll and bank deposit rails',
      icon: ArrowDownLeft,
      delay: 0.15,
    },
    {
      id: 'crypto',
      title: 'Deposit Crypto',
      description: 'Transfer from an external wallet or exchange',
      icon: Wallet,
      delay: 0.2,
    },
    {
      id: 'card',
      title: 'Debit Card',
      description: 'Instant deposit with a linked debit card',
      icon: CreditCard,
      delay: 0.25,
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg bg-white dark:bg-[#0e0e0e] rounded shadow-2xl border-[0.5px] border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Main Header - only show when not on card or bank screen */}
            {selectedOption !== 'card' && selectedOption !== 'bank' && selectedOption !== 'wire' && (
              <div className="flex items-center justify-between p-6 pb-2">
                <div>
                  <h2 className="text-2xl font-light text-zinc-900 dark:text-white tracking-tight">Deposit</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Select a method to fund your account</p>
                </div>
                <button 
                  onClick={onClose}
                  className="p-2 -mr-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Content - flex-1 to take remaining space, overflow-auto for scrolling */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedOption === 'bank' ? (
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
                    <button
                      onClick={() => {
                        setSelectedOption(null);
                        setBankError(null);
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Link Bank Account</h2>
                    <div className="w-9" />
                  </div>
                  <div className="flex-1 overflow-auto p-6">
                    {!address ? (
                      <div className="text-center py-6">
                        <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                          Please connect your wallet to link a bank account
                        </p>
                        <button
                          onClick={() => setSelectedOption(null)}
                          className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                        >
                          ← Back
                        </button>
                      </div>
                    ) : bankError ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                          <AlertCircle className="w-7 h-7 text-red-600 dark:text-red-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">
                          {bankError === 'cancelled' ? 'Connection cancelled' : 'Something went wrong'}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-[260px]">
                          {bankError === 'cancelled'
                            ? "You closed the Plaid window. No account was linked. You can try again or go back."
                            : typeof bankError === 'string' && bankError !== 'Link closed'
                              ? bankError
                              : 'The connection didn\'t complete. You can try again or go back.'}
                        </p>
                        <div className="flex flex-col gap-3 w-full max-w-[240px]">
                          <button
                            onClick={() => {
                              setBankError(null);
                              openPlaidLink();
                            }}
                            disabled={isLoadingLinkToken}
                            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-black dark:bg-white text-white dark:text-black font-medium hover:opacity-90 disabled:opacity-50"
                          >
                            {isLoadingLinkToken ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              'Try again'
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setBankError(null);
                              setSelectedOption(null);
                            }}
                            className="w-full py-3 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                          >
                            Go back
                          </button>
                        </div>
                      </div>
                    ) : isPullingAccounts ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-10 h-10 animate-spin text-zinc-400 dark:text-zinc-500 mb-5" />
                        <p className="text-base font-medium text-zinc-900 dark:text-white mb-1">
                          Pulling in your accounts
                        </p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-[240px] text-center">
                          We&apos;re fetching your account details. This usually takes a few seconds.
                        </p>
                      </div>
                    ) : bankAccountsLoading && bankAccounts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-400 mb-4" />
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading accounts...</p>
                      </div>
                    ) : bankLinked && bankAccounts.length > 0 ? (
                      <div className="space-y-4">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Your connected accounts. Balances are shown in the app&apos;s cash balance.
                        </p>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                            Connected accounts
                          </p>
                          {bankAccounts.map((account) => {
                            const balance = getAvailableLikeBalance(account);
                            const secondaryBalanceLabel = getSecondaryBalanceLabel(account);
                            const creditLimitLabel = getCreditLimitLabel(account);
                            return (
                              <div
                                key={account.account_id}
                                className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-zinc-800/50"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                                    <Building2 className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-zinc-900 dark:text-white truncate">{account.name}</p>
                                    {account.mask != null && (
                                      <p className="text-xs text-zinc-500 dark:text-zinc-400">•••• {account.mask}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  {(account.current != null || account.available != null || account.limit != null) && (
                                    <>
                                      <p className="text-sm font-medium text-zinc-900 dark:text-white">
                                        ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </p>
                                      {secondaryBalanceLabel ? (
                                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          {secondaryBalanceLabel}
                                        </p>
                                      ) : null}
                                      {creditLimitLabel ? (
                                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          {creditLimitLabel}
                                        </p>
                                      ) : null}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          onClick={openPlaidLink}
                          disabled={isLoadingLinkToken}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 font-medium transition-colors disabled:opacity-50 mt-4"
                        >
                          {isLoadingLinkToken ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            'Connect more accounts'
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setBridgeError(null);
                            setBridgeOnboardingOpened(false);
                            setSelectedOption('wire');
                          }}
                          className="w-full py-3 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                        >
                          Set up direct deposit in Bridge
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Connect your bank via Plaid to see your balance alongside your crypto in the app.
                        </p>
                        <button
                          onClick={openPlaidLink}
                          disabled={isLoadingLinkToken}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-black dark:bg-white text-white dark:text-black font-medium hover:opacity-90 disabled:opacity-50"
                        >
                          {isLoadingLinkToken ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            'Connect with Plaid'
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedOption === 'wire' ? (
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
                    <button
                      onClick={() => {
                        setSelectedOption(null);
                        setBridgeError(null);
                        setBridgeOnboardingOpened(false);
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Direct Deposit Setup</h2>
                    <div className="w-9" />
                  </div>
                  <div className="flex-1 overflow-auto p-6">
                    {!address ? (
                      <div className="text-center py-6">
                        <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                          Please connect your wallet to continue
                        </p>
                        <button
                          onClick={() => setSelectedOption(null)}
                          className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                        >
                          ← Back
                        </button>
                      </div>
                    ) : !bankLinked || bankAccounts.length === 0 ? (
                      <div className="space-y-4">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Link a bank account with Plaid first, then continue in Bridge to set up direct deposit onboarding.
                        </p>
                        <button
                          onClick={() => {
                            setBridgeError(null);
                            setSelectedOption('bank');
                          }}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-black dark:bg-white text-white dark:text-black font-medium hover:opacity-90"
                        >
                          Link bank with Plaid
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Your bank is linked. Continue in Bridge to complete onboarding and direct deposit setup.
                        </p>
                        <div className="space-y-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            Bridge onboarding details
                          </p>
                          <input
                            type="text"
                            value={bridgeFullName}
                            onChange={(e) => {
                              setBridgeFullName(e.target.value);
                              if (bridgeError) setBridgeError(null);
                            }}
                            placeholder="Legal full name"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#0e0e0e] px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                          />
                          <input
                            type="email"
                            value={bridgeEmail}
                            onChange={(e) => {
                              setBridgeEmail(e.target.value);
                              if (bridgeError) setBridgeError(null);
                            }}
                            placeholder="Email address"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#0e0e0e] px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setBridgeCustomerType('individual')}
                              className={`py-2 px-3 rounded-lg border text-sm transition-colors ${
                                bridgeCustomerType === 'individual'
                                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-black'
                                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 bg-transparent'
                              }`}
                            >
                              Individual
                            </button>
                            <button
                              type="button"
                              onClick={() => setBridgeCustomerType('business')}
                              className={`py-2 px-3 rounded-lg border text-sm transition-colors ${
                                bridgeCustomerType === 'business'
                                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-black'
                                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 bg-transparent'
                              }`}
                            >
                              Business
                            </button>
                          </div>
                          {!bridgeEmailValid && bridgeEmail.trim().length > 0 && (
                            <p className="text-xs text-red-600 dark:text-red-400">
                              Enter a valid email address to continue.
                            </p>
                          )}
                        </div>
                        {bridgeError && (
                          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                            {bridgeError}
                          </div>
                        )}
                        {bridgeOnboardingOpened && (
                          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300">
                            Bridge opened in a new tab. Complete onboarding there, then come back here.
                          </div>
                        )}
                        <button
                          onClick={openBridgeOnboarding}
                          disabled={isLoadingBridgeOnboarding || !canStartBridgeOnboarding}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-black dark:bg-white text-white dark:text-black font-medium hover:opacity-90 disabled:opacity-50"
                        >
                          {isLoadingBridgeOnboarding ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Opening Bridge...
                            </>
                          ) : (
                            'Continue onboarding in Bridge'
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedOption('bank')}
                          className="w-full py-3 px-4 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                        >
                          Manage linked bank accounts
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedOption === 'card' ? (
                <div className="flex flex-col h-full">
                  {!address ? (
                    <div className="text-center py-8 px-6">
                      <p className="text-zinc-500 dark:text-zinc-400 mb-4">
                        Please connect your wallet to use debit card deposits
                      </p>
                      <button
                        onClick={() => setSelectedOption(null)}
                        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      >
                        ← Back
                      </button>
                    </div>
                  ) : error ? (
                    <div className="text-center py-8 px-6">
                      <p className="text-red-500 dark:text-red-400 mb-4">{error}</p>
                      <button
                        onClick={() => {
                          setSelectedOption(null);
                          setError(null);
                        }}
                        className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                      >
                        ← Back
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full min-h-0 overflow-hidden">
                      {/* Header with title and back button - fixed at top, replaces main header */}
                      <div className="flex items-center justify-between p-4 flex-shrink-0">
                        <button
                          onClick={() => setSelectedOption(null)}
                          className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                        >
                          <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                        </button>
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                          Buy Crypto with Debit Card
                        </h2>
                        <button
                          onClick={onClose}
                          className="p-2 -mr-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      {/* Stripe embed container - full width, no padding, scrollable so Continue button is visible */}
                      <div className="flex-1 min-h-0 overflow-auto relative w-full">
                        {/* Mount container must always be in DOM when card is selected and we have address */}
                        <div 
                          ref={onrampElementRef} 
                          className="stripe-onramp-container w-full h-full min-h-[480px] rounded-none overflow-hidden"
                        />
                        {/* Loading overlay on top so container stays mounted for Stripe */}
                        {isLoadingSession && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-[#0e0e0e] rounded">
                            <div className="text-center">
                              <Loader2 className="w-8 h-8 animate-spin text-zinc-400 mx-auto mb-4" />
                              <p className="text-zinc-500 dark:text-zinc-400">Loading payment form...</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
              <div className="p-4 space-y-2">
                {depositOptions.map((option) => (
                  <motion.button
                    key={option.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: option.delay, duration: 0.3 }}
                    onClick={() => {
                      if (option.id === 'card') {
                        setSelectedOption('card');
                      } else if (option.id === 'bank') {
                        setSelectedOption('bank');
                      } else if (option.id === 'wire') {
                        setBridgeError(null);
                        setBridgeOnboardingOpened(false);
                        setSelectedOption('wire');
                      } else {
                        console.log('Selected option:', option.id);
                      }
                    }}
                    className="w-full flex items-center gap-4 p-4 rounded-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-all group text-left border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800"
                  >
                    <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0 group-hover:bg-white dark:group-hover:bg-black group-hover:shadow-sm transition-all border border-transparent group-hover:border-zinc-200 dark:group-hover:border-zinc-800">
                      <option.icon className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-zinc-900 dark:text-zinc-100 text-base">
                        {option.title}
                      </h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">
                        {option.description}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors" />
                  </motion.button>
                ))}
              </div>
              )}
            </div>

            {/* Footer - hide when on card or bank screen */}
            {selectedOption !== 'card' && selectedOption !== 'bank' && selectedOption !== 'wire' && (
              <div className="p-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/30 text-center">
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 max-w-xs mx-auto leading-relaxed">
                  By making a deposit, you agree to our Terms of Service. 
                  Transfers typically settle within 1-3 business days.
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DepositModal;
