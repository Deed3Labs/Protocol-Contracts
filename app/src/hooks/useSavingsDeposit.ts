import { useCallback, useState } from 'react';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { useAppKitAccount } from '@/lib/walletCompat';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { scDeposit } from '@/lib/sendCalls';
import { gaslessDeposit } from '@/lib/gaslessMoney';

/**
 * Adding to savings — Cash (USDC) into the ESA vault, which mints CLRUSD and matches equity credits.
 *
 * There are two ways this lands and which one applies is a property of the member's wallet, not of
 * the screen they started from. A smart account sends a sponsored UserOp; an EOA signs an EIP-3009
 * authorization the relayer submits. Either way the member pays no gas and signs once, which is
 * why the distinction never reaches the UI — it has no bearing on anything they decide.
 *
 * The fallback is not belt-and-braces. A smart account whose client has not finished setting up
 * looks exactly like an EOA from here, and that state is common on a first session — so a failed
 * sponsored send drops to the relayer rather than telling somebody their deposit failed when the
 * money could have moved perfectly well.
 *
 * Extracted from TransferModal rather than copied out of it. This is the second surface that
 * deposits and there will be more, and two implementations of "how money reaches savings" is how
 * they end up disagreeing about which paths a member has.
 */
export interface SavingsDepositState {
  busy: boolean;
  error: string | null;
  /** Set once the deposit has landed — the dialog becomes a receipt rather than closing. */
  txHash: string | null;
  deposit: (amount: number) => Promise<void>;
  reset: () => void;
}

/*
 * Both wallet hooks below are provider-optional, because the design preview harness renders these
 * same pages with no wallet providers at all — no Privy, no wagmi. That is the harness's whole
 * point: it shows the screens without an account behind them.
 *
 * This follows what `useClearBalances` already does, which resolves its context to a zeroed
 * fallback rather than requiring a provider. Reached differently here only because these two throw
 * instead of returning null. The call still happens unconditionally, so hook order stays stable,
 * and the failure mode is honest: no wallet means the deposit cannot run, which is exactly what
 * `deposit` already reports when there is no address.
 *
 * The alternative was to keep every wallet hook out of anything a page renders, which is how this
 * file broke the harness in the first place — a component reached for one two levels below a page
 * that the harness mounts.
 */
function useOptionalSmartWalletClient(): ((opts: { id: number }) => Promise<unknown>) | null {
  try {
    return useSmartWallets().getClientForChain as (opts: { id: number }) => Promise<unknown>;
  } catch {
    return null;
  }
}

function useOptionalAddress(): string | undefined {
  try {
    return useAppKitAccount().address;
  } catch {
    return undefined;
  }
}

export function useSavingsDeposit(onDeposited?: (amount: number) => void): SavingsDepositState {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const deposit = useCallback(
    async (amount: number) => {
      if (!address) {
        setError('Connect a wallet first.');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Enter an amount to add.');
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const chainId = ACTIVE_CHAIN_ID;
        // Six decimals, and a string rather than a float: the amount becomes token micros, and
        // 0.1 + 0.2 has no business anywhere near somebody's savings balance.
        const amountStr = amount.toFixed(2);

        let hash: string;
        try {
          // Bind the client to this chain — the default one sits on Privy's defaultChain, which is
          // not necessarily the chain we transact on.
          const chainClient = getClientForChain
            ? await getClientForChain({ id: chainId }).catch(() => undefined)
            : undefined;
          hash = await scDeposit({ smartWalletClient: chainClient, ownerWallet: address, amount: amountStr, chainId });
        } catch {
          hash = await gaslessDeposit({ ownerWallet: address, amount: amountStr, chainId });
        }

        setTxHash(hash);
        onDeposited?.(amount);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't go through.");
      } finally {
        setBusy(false);
      }
    },
    [address, getClientForChain, onDeposited],
  );

  const reset = useCallback(() => {
    setError(null);
    setTxHash(null);
  }, []);

  return { busy, error, txHash, deposit, reset };
}
