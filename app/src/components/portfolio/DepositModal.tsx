import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Building2, Wallet, CreditCard, ArrowDownLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import { createStripeOnrampSession } from '@/utils/apiClient';

// Type declarations for Stripe Onramp (loaded via script tags)
declare global {
  interface Window {
    StripeOnramp?: (publishableKey: string) => any;
  }
}

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DepositModal = ({ isOpen, onClose }: DepositModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const onrampElementRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onrampSession, setOnrampSession] = useState<any>(null);
  const { address } = useAppKitAccount();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
      // Reset state when modal closes
      setSelectedOption(null);
      setError(null);
      setOnrampSession(null);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

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
      title: 'Wire Transfer',
      description: 'Domestic & international wire instructions',
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
            {/* Header */}
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

            {/* Content - flex-1 to take remaining space, overflow-auto for scrolling */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedOption === 'card' ? (
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
                    <div className="flex flex-col h-full overflow-hidden">
                      {/* Header with title and back button - fixed at top */}
                      <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0 border-b border-zinc-100 dark:border-zinc-800">
                        <h3 className="text-lg font-medium text-zinc-900 dark:text-white">
                          Buy Crypto with Debit Card
                        </h3>
                        <button
                          onClick={() => setSelectedOption(null)}
                          className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                        >
                          ← Back
                        </button>
                      </div>
                      {/* Stripe embed container - scrollable, constrained height */}
                      <div className="flex-1 overflow-auto px-6 py-4 relative">
                        {/* Mount container must always be in DOM when card is selected and we have address */}
                        <div 
                          ref={onrampElementRef} 
                          className="stripe-onramp-container"
                          style={{ 
                            minHeight: '400px',
                            maxHeight: '100%',
                            overflow: 'auto'
                          }}
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
                      } else {
                        // Handle other options (bank, wire, crypto) here
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

            {/* Footer */}
            <div className="p-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/30 text-center">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 max-w-xs mx-auto leading-relaxed">
                By making a deposit, you agree to our Terms of Service. 
                Transfers typically settle within 1-3 business days.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DepositModal;
