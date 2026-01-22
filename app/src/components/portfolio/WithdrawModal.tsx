import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Building2, Wallet, CreditCard, ArrowUpRight, ChevronRight } from 'lucide-react';
import { usePortfolio } from '@/context/PortfolioContext';
import { calculateCashBalance } from '@/utils/tokenUtils';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WithdrawModal = ({ isOpen, onClose }: WithdrawModalProps) => {
  const { holdings } = usePortfolio();
  
  // Calculate cash balance (stablecoins only)
  const { totalCash } = calculateCashBalance(holdings);
  const modalRef = useRef<HTMLDivElement>(null);

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
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const withdrawOptions = [
    {
      id: 'bank',
      title: 'Bank Transfer',
      description: 'Standard ACH transfer to linked bank account',
      icon: Building2,
      delay: 0.1,
    },
    {
      id: 'wire',
      title: 'Wire Transfer',
      description: 'Same-day domestic or international wire',
      icon: ArrowUpRight,
      delay: 0.15,
    },
    {
      id: 'crypto',
      title: 'Withdraw Crypto',
      description: 'Send to an external wallet address',
      icon: Wallet,
      delay: 0.2,
    },
    {
      id: 'card',
      title: 'Instant Transfer',
      description: 'Instant withdrawal to debit card (1.5% fee)',
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
            className="relative w-full max-w-lg bg-white dark:bg-[#0e0e0e] rounded shadow-2xl border-[0.5px] border-zinc-200 dark:border-zinc-800 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-2">
              <div>
                <h2 className="text-2xl font-light text-zinc-900 dark:text-white tracking-tight">Withdraw</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Select a destination for your funds</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 -mr-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-2">
              {/* Balance Display */}
              <div className="mb-2 px-4 py-3 rounded-sm bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800/50 flex justify-between items-center">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">Withdrawable cash</span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  ${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-xs text-zinc-500 font-normal">USD</span>
                </span>
              </div>

              {withdrawOptions.map((option) => (
                <motion.button
                  key={option.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: option.delay, duration: 0.3 }}
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

            {/* Footer */}
            <div className="p-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/30 text-center">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 max-w-xs mx-auto leading-relaxed">
                Standard withdrawals settle within 1-3 business days. 
                Instant transfers are subject to fees.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default WithdrawModal;

