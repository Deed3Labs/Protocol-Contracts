import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Copy, Loader2, Wallet } from 'lucide-react';
import { ethers } from 'ethers';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  confirmSendTransferLock,
  createStripeOnrampSessionDetailed,
  prepareSendTransfer,
} from '@/utils/apiClient';
import type { SendFundingSource, SendTransferSummary } from '@/types/send';
import {
  CLAIM_ESCROW_ABI,
  getSendClaimEscrowAddress,
  getSendSupportedChainIds,
  getSendUsdcAddress,
  SEND_USDC_ABI,
} from '@/config/send';
import type { Eip1193Provider } from 'ethers';

type StripeOnrampSessionUpdatedEvent = {
  payload?: {
    session?: {
      status?: string;
    };
  };
};

type StripeOnrampSession = {
  mount: (element: HTMLElement) => void;
  addEventListener: (
    eventName: string,
    callback: (event: StripeOnrampSessionUpdatedEvent) => void
  ) => void;
};

type SendStep = 'input' | 'review' | 'funding' | 'pending' | 'success' | 'failed';
type InputScreen = 'main' | 'fundingSource' | 'recipient';

type PendingPhase =
  | 'Preparing transfer...'
  | 'Checking wallet approval...'
  | 'Waiting for approval confirmation...'
  | 'Submitting escrow lock transaction...'
  | 'Waiting for on-chain confirmation...'
  | 'Finalizing claim link...';

interface SendFundsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FundingOption = {
  id: SendFundingSource;
  label: string;
  subtitle: string;
};

const fundingOptions: FundingOption[] = [
  {
    id: 'WALLET_USDC',
    label: 'Wallet USDC',
    subtitle: 'Fund directly from connected wallet',
  },
  {
    id: 'CARD_ONRAMP',
    label: 'Debit / Card',
    subtitle: 'Card funding converts to USDC before lock',
  },
  {
    id: 'BANK_ONRAMP',
    label: 'Bank Account',
    subtitle: 'Bank funding converts to USDC before lock',
  },
];

const fundingOptionIcons: Record<SendFundingSource, string> = {
  WALLET_USDC: '💵',
  CARD_ONRAMP: '💳',
  BANK_ONRAMP: '🏦',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function normalizeRecipient(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return EMAIL_REGEX.test(email) ? email : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  let normalized = trimmed;
  if (!trimmed.startsWith('+')) {
    normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  } else {
    normalized = `+${digits}`;
  }

  return E164_REGEX.test(normalized) ? normalized : null;
}

function toChainHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

async function switchNetworkIfRequired(provider: Eip1193Provider, targetChainId: number): Promise<void> {
  const browserProvider = new ethers.BrowserProvider(provider);
  const network = await browserProvider.getNetwork();
  if (Number(network.chainId) === targetChainId) {
    return;
  }

  const requestProvider = provider as Eip1193Provider & {
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };

  if (!requestProvider.request) {
    throw new Error(`Please switch your wallet to chain ${targetChainId}.`);
  }

  await requestProvider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: toChainHex(targetChainId) }],
  });
}

function getWalletProvider(candidate: unknown): Eip1193Provider | null {
  if (candidate && typeof candidate === 'object') {
    return candidate as Eip1193Provider;
  }

  if (typeof window !== 'undefined' && (window as { ethereum?: Eip1193Provider }).ethereum) {
    return (window as { ethereum?: Eip1193Provider }).ethereum || null;
  }

  return null;
}

function formatWalletError(error: unknown): string {
  const err = error as { code?: number; message?: string };
  if (err?.code === 4001) {
    return 'Transaction rejected in wallet.';
  }
  if (err?.code === 4902) {
    return 'Target network is not added in wallet.';
  }
  return err?.message || 'Wallet transaction failed.';
}

function chainIdToStripeNetwork(chainId: number): string {
  const networkMap: Record<number, string> = {
    1: 'ethereum',
    10: 'optimism',
    137: 'polygon',
    8453: 'base',
    42161: 'arbitrum',
  };

  return networkMap[chainId] || 'base';
}

export function SendFundsModal({ open, onOpenChange }: SendFundsModalProps) {
  const { open: openAppKit } = useAppKit();
  const { address: appKitAddress, isConnected } = useAppKitAccount();
  const { address: wagmiAddress } = useAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const onrampWalletAddress = wagmiAddress || appKitAddress;

  const [step, setStep] = useState<SendStep>('input');
  const [inputScreen, setInputScreen] = useState<InputScreen>('main');
  const [pendingPhase, setPendingPhase] = useState<PendingPhase>('Preparing transfer...');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0');
  const [memo, setMemo] = useState('');
  const [fundingSource, setFundingSource] = useState<SendFundingSource>('WALLET_USDC');
  const [error, setError] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [preparedTransfer, setPreparedTransfer] = useState<SendTransferSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [stripeOnrampLoading, setStripeOnrampLoading] = useState(false);
  const [fundingStatusMessage, setFundingStatusMessage] = useState<string | null>(null);
  const [lockingFromFunding, setLockingFromFunding] = useState(false);

  const stripeOnrampRef = useRef<HTMLDivElement>(null);
  const stripeSessionRef = useRef<StripeOnrampSession | null>(null);

  const normalizedRecipient = useMemo(() => normalizeRecipient(recipient), [recipient]);
  const selectedFundingOption = useMemo(
    () => fundingOptions.find((option) => option.id === fundingSource) ?? fundingOptions[0],
    [fundingSource]
  );
  const recipientDisplay = useMemo(() => {
    const value = normalizedRecipient ?? recipient.trim();
    if (!value) return 'Enter email or phone';
    return value.length > 26 ? `${value.slice(0, 18)}...${value.slice(-6)}` : value;
  }, [normalizedRecipient, recipient]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setStep('input');
      setInputScreen('main');
      setPendingPhase('Preparing transfer...');
      setRecipient('');
      setAmount('0');
      setMemo('');
      setFundingSource('WALLET_USDC');
      setError(null);
      setClaimUrl(null);
      setPreparedTransfer(null);
      setCopied(false);
      setReviewSubmitting(false);
      setStripeOnrampLoading(false);
      setFundingStatusMessage(null);
      setLockingFromFunding(false);
    }
  }, [open]);

  const handleInputContinue = useCallback(() => {
    setError(null);

    if (!normalizedRecipient) {
      setError('Enter a valid recipient email or phone number.');
      return;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid USD amount.');
      return;
    }

    setStep('review');
  }, [amount, normalizedRecipient]);

  const handleNumberPress = useCallback((value: string) => {
    setError(null);
    setAmount((current) => {
      const normalizedAmount = current || '0';
      if (value === '.' && normalizedAmount.includes('.')) return normalizedAmount;
      if (normalizedAmount === '0' && value !== '.') return value;
      if (normalizedAmount === '0' && value === '.') return '0.';
      return normalizedAmount + value;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setAmount((current) => {
      const normalizedAmount = current || '0';
      if (normalizedAmount.length <= 1) return '0';
      const nextAmount = normalizedAmount.slice(0, -1);
      if (nextAmount === '' || nextAmount === '-') return '0';
      return nextAmount;
    });
  }, []);

  const handleRecipientDone = useCallback(() => {
    setError(null);
    if (!normalizedRecipient) {
      setError('Enter a valid recipient email or phone number.');
      return;
    }
    setInputScreen('main');
  }, [normalizedRecipient]);

  useEffect(() => {
    if (!open || step !== 'input' || inputScreen !== 'main') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        return;
      }

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        handleNumberPress(event.key);
      } else if (event.key === '.' || event.key === ',') {
        event.preventDefault();
        handleNumberPress('.');
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleInputContinue();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, step, inputScreen, onOpenChange, handleBackspace, handleInputContinue, handleNumberPress]);

  const submitEscrowLock = async (transfer: SendTransferSummary): Promise<string> => {
    const supportedChains = getSendSupportedChainIds();
    if (!supportedChains.includes(transfer.chainId)) {
      throw new Error(`Send funds only supports chains: ${supportedChains.join(', ')}`);
    }

    const usdcAddress = getSendUsdcAddress(transfer.chainId);
    const claimEscrowAddress = getSendClaimEscrowAddress(transfer.chainId);

    if (!usdcAddress || !claimEscrowAddress) {
      throw new Error(`Missing send contract configuration for chain ${transfer.chainId}.`);
    }

    const provider = getWalletProvider(walletProvider);
    if (!provider) {
      throw new Error('Connect wallet before confirming transfer lock.');
    }

    await switchNetworkIfRequired(provider, transfer.chainId);

    const browserProvider = new ethers.BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    const senderAddress = await signer.getAddress();

    const usdc = new ethers.Contract(usdcAddress, SEND_USDC_ABI, signer);
    const escrow = new ethers.Contract(claimEscrowAddress, CLAIM_ESCROW_ABI, signer);

    const principalMicros = ethers.parseUnits(transfer.principalUsdc, 6);
    const sponsorMicros = ethers.parseUnits(transfer.sponsorFeeUsdc, 6);
    const totalMicros = ethers.parseUnits(transfer.totalLockedUsdc, 6);
    const expirySeconds = BigInt(Math.floor(new Date(transfer.expiresAt).getTime() / 1000));

    setPendingPhase('Checking wallet approval...');
    const allowance: bigint = await usdc.allowance(senderAddress, claimEscrowAddress);

    if (allowance < totalMicros) {
      setPendingPhase('Waiting for approval confirmation...');
      const approvalTx = await usdc.approve(claimEscrowAddress, totalMicros);
      const approvalReceipt = await approvalTx.wait();
      if (!approvalReceipt || approvalReceipt.status !== 1) {
        throw new Error('USDC approval failed or was reverted.');
      }
    }

    setPendingPhase('Submitting escrow lock transaction...');
    const createTx = await escrow.createTransfer(
      transfer.transferId,
      principalMicros,
      sponsorMicros,
      expirySeconds,
      transfer.recipientHintHash
    );

    setPendingPhase('Waiting for on-chain confirmation...');
    const createReceipt = await createTx.wait();
    if (!createReceipt || createReceipt.status !== 1) {
      throw new Error('Escrow lock transaction failed or reverted.');
    }

    return createTx.hash as string;
  };

  const completeEscrowLock = async (transfer: SendTransferSummary): Promise<void> => {
    setStep('pending');
    const escrowTxHash = await submitEscrowLock(transfer);

    setPendingPhase('Finalizing claim link...');
    const lock = await confirmSendTransferLock(transfer.id, {
      transferId: transfer.transferId,
      escrowTxHash,
    });

    if (!lock) {
      throw new Error('Escrow lock succeeded, but backend confirmation failed.');
    }

    setClaimUrl(lock.claimUrl);
    setPreparedTransfer(lock.transfer);
    setStep('success');
  };

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
          if (!window.StripeOnramp) {
            reject(new Error('Stripe scripts failed to load.'));
          }
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
            if (!window.StripeOnramp) {
              reject(new Error('Stripe Onramp is not available after loading scripts.'));
            }
          }, 10000);
        };

        cryptoScript.onerror = () => reject(new Error('Failed to load Stripe crypto onramp script.'));
        document.head.appendChild(cryptoScript);
      };

      stripeScript.onerror = () => reject(new Error('Failed to load Stripe script.'));
      document.head.appendChild(stripeScript);
    });
  }, []);

  useEffect(() => {
    const mountElement = stripeOnrampRef.current;

    if (
      !open ||
      step !== 'funding' ||
      fundingSource !== 'CARD_ONRAMP' ||
      !onrampWalletAddress ||
      !preparedTransfer ||
      !mountElement
    ) {
      return;
    }

    let mounted = true;

    const initializeStripeOnramp = async () => {
      setStripeOnrampLoading(true);
      setFundingStatusMessage(null);
      setError(null);

      try {
        const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (!stripePublishableKey) {
          throw new Error('Stripe publishable key is not configured.');
        }

        await loadStripeScripts();
        if (!mounted) return;
        if (!window.StripeOnramp) {
          throw new Error('Stripe Onramp is not available.');
        }

        const destinationNetwork = chainIdToStripeNetwork(preparedTransfer.chainId);
        const strictAttempt = await createStripeOnrampSessionDetailed({
          wallet_addresses: { [destinationNetwork]: onrampWalletAddress },
          destination_currency: 'usdc',
          destination_network: destinationNetwork,
          destination_amount: preparedTransfer.totalLockedUsdc,
        });

        let sessionData = strictAttempt.session;
        let sessionError = strictAttempt.error;

        // Mirror TradeModal behavior, then retry once without a fixed amount for Stripe accounts
        // that reject destination_amount constraints.
        if (!sessionData) {
          const relaxedAttempt = await createStripeOnrampSessionDetailed({
            wallet_addresses: { [destinationNetwork]: onrampWalletAddress },
            destination_currency: 'usdc',
            destination_network: destinationNetwork,
          });
          sessionData = relaxedAttempt.session;
          sessionError = relaxedAttempt.error || sessionError;
        }

        if (!sessionData) {
          throw new Error(sessionError || 'Failed to create Stripe onramp session.');
        }

        const stripeOnramp = window.StripeOnramp(stripePublishableKey);
        if (!stripeOnramp) {
          throw new Error('Failed to initialize Stripe Onramp.');
        }

        const session = stripeOnramp.createSession({
          clientSecret: sessionData.client_secret,
          appearance: {
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          },
        }) as StripeOnrampSession;

        session.addEventListener('onramp_session_updated', (event: StripeOnrampSessionUpdatedEvent) => {
          const status = event?.payload?.session?.status;
          if (status === 'fulfillment_complete') {
            setFundingStatusMessage('Order placed. Continue to wallet approval to lock escrow.');
          } else if (status === 'rejected') {
            setFundingStatusMessage('Order was not completed. Retry in Stripe or continue if already funded.');
          }
        });

        mountElement.innerHTML = '';
        session.mount(mountElement);
        stripeSessionRef.current = session;
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load Stripe funding.');
      } finally {
        if (mounted) {
          setStripeOnrampLoading(false);
        }
      }
    };

    initializeStripeOnramp();

    return () => {
      mounted = false;
      mountElement.innerHTML = '';
      stripeSessionRef.current = null;
    };
  }, [fundingSource, loadStripeScripts, onrampWalletAddress, open, preparedTransfer, step]);

  const handleConfirmLock = async () => {
    setError(null);
    setReviewSubmitting(true);

    try {
      if (!normalizedRecipient) {
        throw new Error('Recipient is invalid.');
      }

      if (!isConnected || !appKitAddress) {
        throw new Error('Connect wallet before sending funds.');
      }

      setPendingPhase('Preparing transfer...');
      const prepared = await prepareSendTransfer({
        recipient: normalizedRecipient,
        amount,
        memo: memo.trim() || undefined,
        fundingSource,
      });

      if (!prepared) {
        throw new Error('Failed to prepare transfer.');
      }

      setPreparedTransfer(prepared.transfer);

      if (fundingSource === 'CARD_ONRAMP') {
        setStep('funding');
      } else {
        await completeEscrowLock(prepared.transfer);
      }
    } catch (err) {
      setError(formatWalletError(err));
      setStep('failed');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleContinueFromFunding = async () => {
    if (!preparedTransfer) {
      setError('Transfer session is missing. Please start again.');
      setStep('review');
      return;
    }

    setError(null);
    setLockingFromFunding(true);

    try {
      await completeEscrowLock(preparedTransfer);
    } catch (err) {
      setError(formatWalletError(err));
      setStep('failed');
    } finally {
      setLockingFromFunding(false);
    }
  };

  const copyClaimUrl = async () => {
    if (!claimUrl) return;

    try {
      await navigator.clipboard.writeText(claimUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const sponsorFeePreview = '0.50';
  const totalPreview = (() => {
    const parsed = Number(amount || '0');
    return Number.isFinite(parsed) && parsed > 0 ? (parsed + Number(sponsorFeePreview)).toFixed(2) : '0.00';
  })();


  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-0 sm:p-4"
            onClick={() => onOpenChange(false)}
          >
            <div
              className="h-[100dvh] max-h-[100dvh] w-full max-w-full sm:max-w-md sm:h-[95vh] sm:max-h-[800px] bg-white dark:bg-[#0e0e0e] border-0 sm:border sm:border-zinc-200 dark:border-zinc-800 sm:rounded-lg rounded-none overflow-hidden flex flex-col"
              onClick={(event) => event.stopPropagation()}
            >
              {step === 'input' && (
                <div className="flex flex-col h-full">
                  {inputScreen === 'fundingSource' && (
                    <>
                      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => setInputScreen('main')}
                          className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                        >
                          <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                        </button>
                        <h2 className="text-lg font-semibold text-black dark:text-white">Pay with</h2>
                        <div className="w-9" />
                      </div>

                      <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-500 px-2 py-2">
                          Funding source
                        </div>
                        {fundingOptions.map((option) => {
                          const isSelected = fundingSource === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setFundingSource(option.id);
                                setInputScreen('main');
                                setError(null);
                              }}
                              className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border border-zinc-200/0 hover:border-zinc-200 dark:hover:border-zinc-800 text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                  {fundingOptionIcons[option.id]}
                                </div>
                                <div>
                                  <div className="text-black dark:text-white font-medium">{option.label}</div>
                                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{option.subtitle}</div>
                                </div>
                              </div>
                              {isSelected ? (
                                <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                  <Check className="w-4 h-4 text-white dark:text-black" />
                                </div>
                              ) : (
                                <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {inputScreen === 'recipient' && (
                    <>
                      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => {
                            setInputScreen('main');
                            setError(null);
                          }}
                          className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                        >
                          <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                        </button>
                        <h2 className="text-lg font-semibold text-black dark:text-white">Send to</h2>
                        <div className="w-9" />
                      </div>

                      <div className="flex-1 p-4 space-y-4">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          Enter an email or phone number to create the claim link recipient.
                        </p>
                        <input
                          type="text"
                          value={recipient}
                          onChange={(event) => {
                            setRecipient(event.target.value);
                            setError(null);
                          }}
                          placeholder="email@example.com or +15551234567"
                          className={cn(
                            'w-full rounded-xl border bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-black dark:text-white placeholder:text-zinc-500 outline-none',
                            recipient.trim() && !normalizedRecipient
                              ? 'border-red-500 dark:border-red-500'
                              : 'border-zinc-200 dark:border-zinc-800'
                          )}
                        />
                        {recipient.trim() && !normalizedRecipient && (
                          <p className="text-sm text-red-500 dark:text-red-400">
                            Enter a valid email address or E.164 phone number.
                          </p>
                        )}

                        <input
                          type="text"
                          value={memo}
                          onChange={(event) => setMemo(event.target.value)}
                          placeholder="Memo (optional)"
                          maxLength={256}
                          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 text-black dark:text-white placeholder:text-zinc-500 outline-none"
                        />

                        {error && (
                          <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                          </div>
                        )}

                        <Button
                          type="button"
                          onClick={handleRecipientDone}
                          className="w-full h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black"
                        >
                          Done
                        </Button>
                      </div>
                    </>
                  )}

                  {inputScreen === 'main' && (
                    <>
                      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => onOpenChange(false)}
                          className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                        >
                          <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                        </button>
                        <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-full text-sm text-zinc-600 dark:text-zinc-400">
                          One-time transfer
                        </div>
                        <div className="w-9" />
                      </div>

                      <div className="flex-1 flex flex-col">
                        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
                          <div className="flex items-baseline gap-1">
                            <span className="text-6xl font-light tracking-tight text-black dark:text-white">
                              {amount || '0'}
                            </span>
                            <span className="text-4xl font-light text-zinc-500 dark:text-zinc-400">USD</span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                            Total lock: ${totalPreview}
                          </p>
                          {!isConnected && (
                            <button
                              type="button"
                              onClick={() => openAppKit({ view: 'Connect' })}
                              className="mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Connect wallet
                            </button>
                          )}
                        </div>

                        <div className="px-4 space-y-1 mb-4">
                          <button
                            type="button"
                            onClick={() => {
                              setInputScreen('recipient');
                              setError(null);
                            }}
                            className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                👤
                              </div>
                              <div className="text-left">
                                <p className="font-medium text-black dark:text-white">Send to</p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">{recipientDisplay}</p>
                                {memo && <p className="text-xs text-zinc-500 dark:text-zinc-500">Memo: {memo}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="text-sm font-medium text-black dark:text-white">
                                  {normalizedRecipient ? 'Ready' : 'Required'}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {normalizedRecipient ? 'Validated' : 'Add contact'}
                                </p>
                              </div>
                              <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                            </div>
                          </button>

                          <div className="flex items-center justify-center py-1">
                            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-800" />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setInputScreen('fundingSource');
                              setError(null);
                            }}
                            className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors border border-zinc-200 dark:border-white/10"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xl">
                                {fundingOptionIcons[selectedFundingOption.id]}
                              </div>
                              <div className="text-left">
                                <p className="font-medium text-black dark:text-white">Pay with</p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">{selectedFundingOption.label}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="text-sm font-medium text-black dark:text-white">Funding source</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">{selectedFundingOption.subtitle}</p>
                              </div>
                              <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600" />
                            </div>
                          </button>
                        </div>

                        {error && (
                          <div className="px-4 mb-2">
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <span>{error}</span>
                            </div>
                          </div>
                        )}

                        <div className="px-4 pb-2">
                          <Button
                            type="button"
                            onClick={handleInputContinue}
                            disabled={!Number.isFinite(Number(amount)) || Number(amount) <= 0}
                            className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50"
                          >
                            Continue
                          </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-1 p-4 pt-2">
                          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => (key === 'back' ? handleBackspace() : handleNumberPress(key))}
                              className="h-14 rounded-lg text-2xl font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center text-black dark:text-white"
                            >
                              {key === 'back' ? <ArrowLeft className="w-6 h-6" /> : key}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 'review' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setInputScreen('main');
                        setStep('input');
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Review transfer</h2>
                    <div className="w-9" />
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4 space-y-4 border border-zinc-200 dark:border-white/10">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500 dark:text-zinc-400">Recipient</span>
                        <span className="text-black dark:text-white font-medium break-all text-right">
                          {normalizedRecipient ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500 dark:text-zinc-400">Funding</span>
                        <span className="text-black dark:text-white text-right">
                          {fundingOptions.find((option) => option.id === fundingSource)?.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500 dark:text-zinc-400">Transfer amount</span>
                        <span className="text-black dark:text-white text-right">${amount || '0.00'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500 dark:text-zinc-400">Sponsor fee</span>
                        <span className="text-black dark:text-white text-right">${sponsorFeePreview}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                        <span className="font-semibold text-black dark:text-white">Total lock</span>
                        <span className="font-semibold text-black dark:text-white text-right">${totalPreview}</span>
                      </div>
                    </div>

                    {fundingSource === 'CARD_ONRAMP' && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                        Debit/card funding opens Stripe Onramp first so you can buy USDC on Base before wallet approval.
                      </div>
                    )}

                    {fundingSource === 'BANK_ONRAMP' && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                        Bank funding intent is recorded, but this flow still uses wallet USDC for the escrow lock.
                      </div>
                    )}
                  </div>

                  <div className="fixed bottom-0 left-0 right-0 sm:relative sm:bottom-auto bg-white dark:bg-[#0e0e0e] border-t border-zinc-200 dark:border-zinc-800 sm:border-t-0 p-4 pt-3 pb-safe sm:p-4">
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setStep('input')}
                        className="flex-1 h-14 rounded-full text-base font-semibold bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        onClick={handleConfirmLock}
                        disabled={reviewSubmitting}
                        className="flex-1 h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                      >
                        {reviewSubmitting ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Preparing...
                          </span>
                        ) : fundingSource === 'CARD_ONRAMP' ? (
                          'Continue to funding'
                        ) : (
                          'Confirm & Lock'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {step === 'funding' && fundingSource === 'CARD_ONRAMP' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep('review');
                      }}
                      className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                    </button>
                    <h2 className="text-lg font-semibold text-black dark:text-white">Fund with card</h2>
                    <div className="w-9" />
                  </div>

                  <div className="p-4 pb-2">
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3 text-sm text-zinc-700 dark:text-zinc-300">
                      Buy at least ${preparedTransfer?.totalLockedUsdc || totalPreview} USDC on Base, then continue to spend approval.
                    </div>
                  </div>

                  {fundingStatusMessage && (
                    <div className="px-4 pb-2">
                      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                        {fundingStatusMessage}
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="px-4 pb-2">
                      <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                        {error}
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 relative">
                    {stripeOnrampLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/80 dark:bg-zinc-900/60 z-10">
                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                      </div>
                    )}
                    <div ref={stripeOnrampRef} className="w-full h-full min-h-[420px]" />
                  </div>

                  <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
                    <Button
                      type="button"
                      onClick={handleContinueFromFunding}
                      disabled={lockingFromFunding || !preparedTransfer}
                      className="w-full h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      {lockingFromFunding ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Opening wallet approval...
                        </span>
                      ) : (
                        'Continue to spend approval'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {step === 'pending' && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-6">
                    <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">Confirm in your wallet</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-2 max-w-[300px]">{pendingPhase}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[280px]">
                    Signing and confirming on-chain escrow lock.
                  </p>
                </div>
              )}

              {step === 'failed' && (
                <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-6">
                    <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">Transfer failed</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[280px]">
                    {error || 'Please retry the transfer.'}
                  </p>
                  <div className="flex flex-col gap-3 w-full max-w-[280px]">
                    <Button
                      type="button"
                      onClick={() => setStep('review')}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      Try again
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenChange(false)}
                      className="w-full h-14 rounded-full text-base font-semibold bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              )}

              {step === 'success' && (
                <div className="flex flex-col h-full p-4 overflow-y-auto">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-24 h-24 rounded-full bg-black dark:bg-white flex items-center justify-center mb-6">
                      <Check className="w-12 h-12 text-white dark:text-black" />
                    </div>
                    <h2 className="text-2xl font-semibold mb-2 text-black dark:text-white">Transfer locked</h2>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm max-w-[300px]">
                      Recipient can choose Debit, Bank, or Wallet at claim time.
                    </p>
                  </div>

                  <div className="mt-8 space-y-4">
                    {preparedTransfer && (
                      <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-900/50 p-4 text-sm">
                        <p className="text-zinc-500 dark:text-zinc-400">Transfer ID</p>
                        <p className="mt-1 break-all font-mono text-zinc-900 dark:text-zinc-100">
                          {preparedTransfer.transferId}
                        </p>
                        <p className="mt-3 text-zinc-500 dark:text-zinc-400">Locked total</p>
                        <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">
                          ${preparedTransfer.totalLockedUsdc}
                        </p>
                      </div>
                    )}

                    {claimUrl && (
                      <div className="rounded-2xl border border-zinc-200 dark:border-white/10 p-4">
                        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Claim link</p>
                        <div className="mt-2 flex gap-2">
                          <input
                            readOnly
                            value={claimUrl}
                            onFocus={(event) => event.currentTarget.select()}
                            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
                          />
                          <button
                            type="button"
                            onClick={copyClaimUrl}
                            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-auto pt-8">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenChange(false)}
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

export default SendFundsModal;
