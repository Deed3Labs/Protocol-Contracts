import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, Copy, Loader2, Wallet } from 'lucide-react';
import { ethers } from 'ethers';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  confirmSendTransferLock,
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

type SendStep = 'input' | 'review' | 'pending' | 'success' | 'failed';

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

export function SendFundsModal({ open, onOpenChange }: SendFundsModalProps) {
  const { open: openAppKit } = useAppKit();
  const { address: appKitAddress, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');

  const [step, setStep] = useState<SendStep>('input');
  const [pendingPhase, setPendingPhase] = useState<PendingPhase>('Preparing transfer...');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [fundingSource, setFundingSource] = useState<SendFundingSource>('WALLET_USDC');
  const [error, setError] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [preparedTransfer, setPreparedTransfer] = useState<SendTransferSummary | null>(null);
  const [copied, setCopied] = useState(false);

  const normalizedRecipient = useMemo(() => normalizeRecipient(recipient), [recipient]);

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
      setPendingPhase('Preparing transfer...');
      setRecipient('');
      setAmount('');
      setMemo('');
      setFundingSource('WALLET_USDC');
      setError(null);
      setClaimUrl(null);
      setPreparedTransfer(null);
      setCopied(false);
    }
  }, [open]);

  const handleInputContinue = () => {
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
  };

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

  const handleConfirmLock = async () => {
    setStep('pending');
    setError(null);

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

      const escrowTxHash = await submitEscrowLock(prepared.transfer);

      setPendingPhase('Finalizing claim link...');
      const lock = await confirmSendTransferLock(prepared.transfer.id, {
        transferId: prepared.transfer.transferId,
        escrowTxHash,
      });

      if (!lock) {
        throw new Error('Escrow lock succeeded, but backend confirmation failed.');
      }

      setClaimUrl(lock.claimUrl);
      setPreparedTransfer(lock.transfer);
      setStep('success');
    } catch (err) {
      setError(formatWalletError(err));
      setStep('failed');
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

                  <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-6">
                    {!isConnected && (
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3">
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                          Connect a wallet to sign escrow lock transactions.
                        </p>
                        <Button
                          type="button"
                          onClick={() => openAppKit({ view: 'Connect' })}
                          className="mt-3 h-10 rounded-full px-4 bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                        >
                          <Wallet className="mr-2 h-4 w-4" />
                          Connect Wallet
                        </Button>
                      </div>
                    )}

                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Recipient</span>
                      <input
                        value={recipient}
                        onChange={(event) => setRecipient(event.target.value)}
                        placeholder="email@example.com or +15551234567"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Funding source</span>
                      <div className="space-y-2">
                        {fundingOptions.map((option) => {
                          const isSelected = fundingSource === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setFundingSource(option.id)}
                              className={cn(
                                'w-full flex items-center justify-between p-4 rounded-xl border text-left transition-colors',
                                isSelected
                                  ? 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/70'
                                  : 'border-zinc-200/70 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                              )}
                            >
                              <div>
                                <p className="font-medium text-black dark:text-white">{option.label}</p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">{option.subtitle}</p>
                              </div>
                              {isSelected ? (
                                <div className="w-6 h-6 rounded-full bg-black dark:bg-white flex items-center justify-center">
                                  <Check className="w-4 h-4 text-white dark:text-black" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-full border border-zinc-300 dark:border-zinc-700" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Amount (USD)</span>
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Memo (optional)</span>
                      <input
                        value={memo}
                        onChange={(event) => setMemo(event.target.value)}
                        placeholder="Add a note"
                        maxLength={256}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                      />
                    </label>

                    {error && (
                      <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={handleInputContinue}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              )}

              {step === 'review' && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setStep('input')}
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

                    {fundingSource !== 'WALLET_USDC' && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                        Card and bank selections are recorded as funding intent. Current lock step still signs wallet USDC escrow lock.
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
                        className="flex-1 h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                      >
                        Confirm &amp; Lock
                      </Button>
                    </div>
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
