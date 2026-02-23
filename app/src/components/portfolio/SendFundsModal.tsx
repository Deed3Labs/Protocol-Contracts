import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, CheckCircle2, Copy, Loader2, X } from 'lucide-react';
import {
  confirmSendTransferLock,
  prepareSendTransfer,
} from '@/utils/apiClient';
import type { SendFundingSource, SendTransferSummary } from '@/types/send';

type SendStep = 'input' | 'review' | 'pending' | 'success' | 'failed';

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
    subtitle: 'Convert card funding into USDC first',
  },
  {
    id: 'BANK_ONRAMP',
    label: 'Bank Account',
    subtitle: 'Convert bank funding into USDC first',
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

function randomTxHash(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
}

export function SendFundsModal({ open, onOpenChange }: SendFundsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<SendStep>('input');
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
    const handleOutsideClick = (event: MouseEvent) => {
      if (open && modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.body.style.overflow = 'unset';
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setStep('input');
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

  const handleConfirmLock = async () => {
    setStep('pending');
    setError(null);

    try {
      if (!normalizedRecipient) {
        throw new Error('Recipient is invalid.');
      }

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

      const lock = await confirmSendTransferLock(prepared.transfer.id, {
        transferId: prepared.transfer.transferId,
        escrowTxHash: randomTxHash(),
      });

      if (!lock) {
        throw new Error('Failed to confirm transfer lock.');
      }

      setClaimUrl(lock.claimUrl);
      setPreparedTransfer(lock.transfer);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send funds.');
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-xl rounded-sm border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0e0e0e]"
          >
            <div className="flex items-center justify-between border-b border-zinc-100 p-5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                {step !== 'input' && step !== 'success' && step !== 'pending' && (
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-light tracking-tight text-zinc-900 dark:text-white">Send Funds</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Base USDC escrow with recipient payout choice</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              {step === 'input' && (
                <div className="space-y-4">
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Recipient</span>
                    <input
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="email@example.com or +15551234567"
                      className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Funding Source</span>
                    <div className="space-y-2">
                      {fundingOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setFundingSource(option.id)}
                          className={`w-full rounded-sm border px-3 py-2 text-left transition ${
                            fundingSource === option.id
                              ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-800/40'
                              : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
                          }`}
                        >
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{option.label}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{option.subtitle}</p>
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Amount (USD)</span>
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Memo (optional)</span>
                    <input
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                      placeholder="Add a note"
                      maxLength={256}
                      className="w-full rounded-sm border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </label>

                  {error && (
                    <div className="flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleInputContinue}
                    className="w-full rounded-sm bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Continue
                  </button>
                </div>
              )}

              {step === 'review' && (
                <div className="space-y-4">
                  <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Recipient</p>
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{normalizedRecipient}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">Funding</p>
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                      {fundingOptions.find((option) => option.id === fundingSource)?.label}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">Transfer Amount</p>
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">${amount || '0.00'}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">Sponsor Fee</p>
                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">${sponsorFeePreview}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">Total Lock</p>
                    <p className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">${totalPreview}</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep('input')}
                      className="flex-1 rounded-sm border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmLock}
                      className="flex-1 rounded-sm bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Confirm & Lock
                    </button>
                  </div>
                </div>
              )}

              {step === 'pending' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
                  <p className="mt-4 text-sm text-zinc-900 dark:text-zinc-100">Locking transfer and creating claim link...</p>
                  <p className="mt-1 text-xs text-zinc-500">Preparing escrow + notification record</p>
                </div>
              )}

              {step === 'failed' && (
                <div className="space-y-4 text-center">
                  <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
                  <p className="text-sm text-zinc-900 dark:text-zinc-100">The send flow failed.</p>
                  <p className="text-xs text-zinc-500">{error || 'Please retry the transfer.'}</p>
                  <button
                    type="button"
                    onClick={() => setStep('review')}
                    className="w-full rounded-sm bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {step === 'success' && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center text-center">
                    <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                    <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">Transfer locked successfully</p>
                    <p className="mt-1 text-xs text-zinc-500">Recipient can choose Debit, Bank, or Wallet at claim time.</p>
                  </div>

                  {preparedTransfer && (
                    <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                      <p className="text-zinc-500">Transfer ID</p>
                      <p className="mt-1 break-all font-mono text-zinc-800 dark:text-zinc-200">{preparedTransfer.transferId}</p>
                      <p className="mt-3 text-zinc-500">Locked Total</p>
                      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">${preparedTransfer.totalLockedUsdc}</p>
                    </div>
                  )}

                  {claimUrl && (
                    <div className="rounded-sm border border-zinc-200 p-3 dark:border-zinc-800">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Claim Link</p>
                      <p className="mt-1 break-all text-xs text-zinc-800 dark:text-zinc-200">{claimUrl}</p>
                      <button
                        type="button"
                        onClick={copyClaimUrl}
                        className="mt-2 inline-flex items-center gap-1 rounded-sm border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="w-full rounded-sm bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default SendFundsModal;
