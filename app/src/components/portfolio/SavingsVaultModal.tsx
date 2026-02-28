import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, ArrowLeftRight, ChevronRight, Loader2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

type VaultMode = 'deposit' | 'redeem';

interface SavingsVaultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: VaultMode;
  onModeChange: (mode: VaultMode) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  onSubmit: () => void;
  pending: boolean;
  error: string | null;
  status: string | null;
  isConnected: boolean;
  isOnHomeChain: boolean;
  homeChainName?: string;
  savingsBalance: number;
  totalClrUsdBalance: number;
  remoteClrUsdBalance: number;
}

const formatBalance = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function SavingsVaultModal({
  open,
  onOpenChange,
  mode,
  onModeChange,
  amount,
  onAmountChange,
  onSubmit,
  pending,
  error,
  status,
  isConnected,
  isOnHomeChain,
  homeChainName,
  savingsBalance,
  totalClrUsdBalance: _totalClrUsdBalance,
  remoteClrUsdBalance,
}: SavingsVaultModalProps) {
  const displayAmount = amount || '0';
  const parsedAmount = Number(displayAmount);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const submitDisabled = pending || !isConnected || !isAmountValid;
  const resolvedHomeChainName = homeChainName || 'Home chain';
  const fromSymbol = mode === 'deposit' ? 'USDC' : 'CLRUSD';
  const toSymbol = mode === 'deposit' ? 'CLRUSD' : 'USDC';
  const amountUnit = mode === 'redeem' ? 'CLRUSD' : 'USD';
  const modeHint = `${fromSymbol} -> ${toSymbol} (1:1)`;
  const fromTitle = mode === 'deposit' ? 'Pay with' : 'Redeem';
  const toTitle = 'Receive';
  const fromSubtext = mode === 'deposit' ? resolvedHomeChainName : `${formatBalance(savingsBalance)} available`;
  const toSubtext = mode === 'deposit' ? 'Mint 1:1' : `${resolvedHomeChainName} USDC`;

  const banner = error
    ? { tone: 'error' as const, text: error }
    : !isConnected
      ? { tone: 'warning' as const, text: 'Connect wallet to continue.' }
      : mode === 'redeem' && remoteClrUsdBalance > 0
          ? {
              tone: 'warning' as const,
              text: `Bridge ${formatBalance(remoteClrUsdBalance)} CLRUSD home before redeeming.`,
            }
          : status
            ? { tone: 'success' as const, text: status }
            : null;
  const toggleDirection = useCallback(() => {
    onModeChange(mode === 'deposit' ? 'redeem' : 'deposit');
  }, [mode, onModeChange]);

  const handleNumberPress = useCallback(
    (value: string) => {
      const normalized = amount || '0';
      if (value === '.' && normalized.includes('.')) return;
      if (normalized === '0' && value !== '.') {
        onAmountChange(value);
        return;
      }
      if (normalized === '0' && value === '.') {
        onAmountChange('0.');
        return;
      }
      onAmountChange(normalized + value);
    },
    [amount, onAmountChange]
  );

  const handleBackspace = useCallback(() => {
    const normalized = amount || '0';
    if (normalized.length <= 1) {
      onAmountChange('0');
      return;
    }
    const next = normalized.slice(0, -1);
    onAmountChange(next === '' || next === '-' ? '0' : next);
  }, [amount, onAmountChange]);

  useEffect(() => {
    if (!open) return;

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
        if (!submitDisabled) onSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange, onSubmit, handleBackspace, handleNumberPress, submitDisabled]);

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
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="p-2 -ml-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 text-zinc-900 dark:text-white" />
                  </button>
                  <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-full text-sm text-zinc-600 dark:text-zinc-400">
                    ESA Vault
                    <ChevronRight className="w-4 h-4" />
                  </div>
                  <button
                    type="button"
                    className="p-2 -mr-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-colors"
                  >
                    <MoreHorizontal className="w-5 h-5 text-zinc-900 dark:text-white" />
                  </button>
                </div>

                {/* Mode Tabs */}
                <div className="px-4 pt-4">
                  <div className="inline-flex bg-zinc-100 dark:bg-zinc-900 rounded-full p-1">
                    {(['deposit', 'redeem'] as VaultMode[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onModeChange(value)}
                        className={cn(
                          'px-5 py-2 rounded-full text-sm font-medium transition-all capitalize',
                          mode === value
                            ? 'bg-black dark:bg-white text-white dark:text-black'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  {/* Amount Display */}
                  <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-6xl font-light tracking-tight text-black dark:text-white">
                        {displayAmount}
                      </span>
                      <span className="text-4xl font-light text-zinc-500 dark:text-zinc-400">
                        {amountUnit}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{modeHint}</p>
                  </div>

                  {/* From / To Selectors */}
                  <div className="px-4 mb-3">
                    <div className="relative">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="w-full flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-white/10 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                              {mode === 'deposit' ? 'U' : 'C'}
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">{fromTitle}</p>
                              <p className="font-medium text-black dark:text-white truncate">{fromSymbol}</p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{fromSubtext}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600 shrink-0 ml-2" />
                        </div>

                        <div className="w-full flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-white/10 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                              {mode === 'deposit' ? 'C' : 'U'}
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">{toTitle}</p>
                              <p className="font-medium text-black dark:text-white truncate">{toSymbol}</p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{toSubtext}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-zinc-400 dark:text-zinc-600 shrink-0 ml-2" />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={toggleDirection}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white dark:bg-[#0e0e0e] border border-zinc-200 dark:border-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                      >
                        <ArrowLeftRight className="w-4 h-4 text-zinc-900 dark:text-white" />
                      </button>
                    </div>

                    {banner && (
                      <div
                        className={cn(
                          'mt-2 flex items-start gap-2 rounded-xl border p-3 text-sm',
                          banner.tone === 'warning' &&
                            'border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
                          banner.tone === 'error' &&
                            'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
                          banner.tone === 'success' &&
                            'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                        )}
                      >
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span className="truncate">{banner.text}</span>
                      </div>
                    )}
                  </div>

                  {/* Submit Button */}
                  <div className="px-4 pb-2">
                    <button
                      type="button"
                      onClick={onSubmit}
                      disabled={submitDisabled}
                      className="w-full h-14 rounded-full text-base font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                      {pending
                        ? 'Submitting...'
                        : mode === 'deposit'
                          ? 'Deposit to ESA Vault'
                          : 'Redeem from ESA Vault'}
                    </button>
                  </div>

                  {/* Number Pad */}
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
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default SavingsVaultModal;
