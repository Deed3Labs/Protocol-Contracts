import { useCallback, useState } from 'react';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { scDeposit, scRedeem } from '@/lib/sendCalls';
import { gaslessDeposit, gaslessRedeem } from '@/lib/gaslessMoney';

/**
 * Moving money between the cash account and savings, in either direction.
 *
 * Cash into the ESA vault mints CLRUSD and matches equity credits; savings out of it redeems.
 * One hook for both because they are the same decision with the sign flipped, and because the
 * wallet-shaped question underneath — sponsored op or relayer — has the same answer either way.
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
export type MoveDirection = 'deposit' | 'withdraw';

export interface SavingsMoveState {
  busy: boolean;
  error: string | null;
  /** Set once it has landed — the dialog becomes a receipt rather than closing. */
  txHash: string | null;
  move: (direction: MoveDirection, amount: number) => Promise<void>;
  reset: () => void;
}

export function useSavingsMove(
  onMoved?: (direction: MoveDirection, amount: number) => void,
): SavingsMoveState {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const move = useCallback(
    async (direction: MoveDirection, amount: number) => {
      if (!address) {
        setError('Connect a wallet first.');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Enter an amount to move.');
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const chainId = ACTIVE_CHAIN_ID;
        // Six decimals, and a string rather than a float: the amount becomes token micros, and
        // 0.1 + 0.2 has no business anywhere near somebody's savings balance.
        const amountStr = amount.toFixed(2);

        const sponsored = direction === 'deposit' ? scDeposit : scRedeem;
        const relayed = direction === 'deposit' ? gaslessDeposit : gaslessRedeem;

        let hash: string;
        try {
          // Bind the client to this chain — the default one sits on Privy's defaultChain, which is
          // not necessarily the chain we transact on.
          const chainClient = getClientForChain
            ? await getClientForChain({ id: chainId }).catch(() => undefined)
            : undefined;
          hash = await sponsored({ smartWalletClient: chainClient, ownerWallet: address, amount: amountStr, chainId });
        } catch {
          hash = await relayed({ ownerWallet: address, amount: amountStr, chainId });
        }

        setTxHash(hash);
        onMoved?.(direction, amount);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't go through.");
      } finally {
        setBusy(false);
      }
    },
    [address, getClientForChain, onMoved],
  );

  const reset = useCallback(() => {
    setError(null);
    setTxHash(null);
  }, []);

  return { busy, error, txHash, move, reset };
}
