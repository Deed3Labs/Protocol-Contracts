import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
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
  totalClrUsdBalance,
  remoteClrUsdBalance,
}: SavingsVaultModalProps) {
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
        onSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange, onSubmit, handleBackspace, handleNumberPress]);

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
                </div>
                <div className="w-9" />
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-900/50 p-4 space-y-2.5">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {(homeChainName || 'Home chain')} · USDC ↔ CLRUSD (1:1)
                  </p>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                    <p>Home-chain CLRUSD: {formatBalance(savingsBalance)}</p>
                    <p>Total CLRUSD: {formatBalance(totalClrUsdBalance)}</p>
                    {remoteClrUsdBalance > 0 && (
                      <p>Remote CLRUSD: {formatBalance(remoteClrUsdBalance)} (bridge home to redeem)</p>
                    )}
                  </div>
                  <div className="inline-flex bg-zinc-100 dark:bg-zinc-800 rounded-full p-1">
                    {(['deposit', 'redeem'] as VaultMode[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onModeChange(value)}
                        className={cn(
                          'px-4 py-1.5 rounded-full text-xs font-medium capitalize transition-colors',
                          mode === value
                            ? 'bg-black dark:bg-white text-white dark:text-black'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        )}
                      >
                        {value === 'deposit' ? 'Deposit USDC' : 'Redeem CLRUSD'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-900/50 p-4 space-y-3">
                  <label className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Amount
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => onAmountChange(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0f0f0f] px-4 py-3 text-black dark:text-white placeholder:text-zinc-500 outline-none"
                  />

                  <div className="grid grid-cols-3 gap-1 pt-1">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => (key === 'back' ? handleBackspace() : handleNumberPress(key))}
                        className="h-12 rounded-lg text-xl font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center text-black dark:text-white"
                      >
                        {key === 'back' ? <ArrowLeft className="w-5 h-5" /> : key}
                      </button>
                    ))}
                  </div>

                  {!isConnected && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Connect your wallet to continue.</span>
                    </div>
                  )}

                  {!isOnHomeChain && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Switch to {(homeChainName || 'home chain')} before submitting.</span>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {status && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                      {status}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0e0e0e] p-4">
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={pending || !isConnected}
                  className="w-full h-12 rounded-full font-semibold bg-black dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pending
                    ? 'Submitting...'
                    : mode === 'deposit'
                      ? 'Deposit to ESA Vault'
                      : 'Redeem from ESA Vault'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default SavingsVaultModal;
