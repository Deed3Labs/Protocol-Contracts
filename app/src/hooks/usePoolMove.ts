import { useCallback, useState } from 'react';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { scPoolDeposit, scPoolWithdraw } from '@/lib/sendCalls';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { readContract } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { parseUnits } from 'viem';

/**
 * Moving money in and out of the yield pool.
 *
 * The deposit half mirrors savings exactly: approve and deposit in one sponsored batch. The
 * withdraw half does not, because the pool can be fully lent — so the amount is split into what
 * the pool can pay now and what has to queue, and both go in the same batch.
 *
 * The split is computed here rather than in the component, because it is arithmetic about shares
 * and the screen deals in dollars. `maxRedeem` is the contract's own answer to "how much can
 * actually leave right now", and using it means the app never asks for a redemption the pool will
 * refuse.
 */
const POOL_READ_ABI = [
  { type: 'function', name: 'maxRedeem', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'convertToShares', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

export type MoveDirection = 'deposit' | 'withdraw';

export interface PoolMoveState {
  busy: boolean;
  error: string | null;
  txHash: string | null;
  /** `freeNow` is what the pool can pay; anything above it is queued rather than refused. */
  move: (direction: MoveDirection, amount: number, freeNow: number) => Promise<void>;
  reset: () => void;
}

export function usePoolMove(onMoved?: (direction: MoveDirection, amount: number) => void): PoolMoveState {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const move = useCallback(
    async (direction: MoveDirection, amount: number, freeNow: number) => {
      if (!address) {
        setError('Connect a wallet first.');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Enter an amount to move.');
        return;
      }

      const chainId = ACTIVE_CHAIN_ID;
      const pool = clearContracts(chainId)?.lendingPool;
      if (!pool) {
        setError('The yield pool is not available on this network.');
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const chainClient = getClientForChain
          ? await getClientForChain({ id: chainId }).catch(() => undefined)
          : undefined;
        // Six decimals, as a string: the amount becomes token micros, and float arithmetic has no
        // business near somebody's position.
        const amountStr = amount.toFixed(2);

        let hash: string;
        if (direction === 'deposit') {
          hash = await scPoolDeposit({ smartWalletClient: chainClient, ownerWallet: address, amount: amountStr, chainId });
        } else {
          // Split in shares, using the contract's own cap. `maxRedeem` already accounts for the
          // pool's available cash, so what it will not pay now is exactly what must queue.
          const wanted = await readContract(wagmiAdapter.wagmiConfig, {
            address: pool, abi: POOL_READ_ABI, functionName: 'convertToShares',
            args: [parseUnits(amountStr, 6)], chainId,
          }) as bigint;
          const payable = await readContract(wagmiAdapter.wagmiConfig, {
            address: pool, abi: POOL_READ_ABI, functionName: 'maxRedeem',
            args: [address as `0x${string}`], chainId,
          }) as bigint;

          const sharesNow = wanted < payable ? wanted : payable;
          const sharesQueued = wanted - sharesNow;
          hash = await scPoolWithdraw({ smartWalletClient: chainClient, ownerWallet: address, sharesNow, sharesQueued, chainId });
        }

        setTxHash(hash);
        onMoved?.(direction, Math.min(amount, direction === 'withdraw' ? freeNow || amount : amount));
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
