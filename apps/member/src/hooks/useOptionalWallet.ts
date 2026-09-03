import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { useAppKitAccount } from '@/lib/walletCompat';

/*
 * Wallet hooks that survive having no wallet providers.
 *
 * The design preview harness renders the app's real pages with no Privy and no wagmi — that is its
 * whole point, showing the screens without an account behind them. Both hooks below throw in that
 * situation, so anything a page renders that reaches for one blanks the harness.
 *
 * Their own module rather than a comment inside one consumer, because a comment did not stop the
 * second consumer calling `useAppKitAccount` directly and blanking the preview again ten minutes
 * later. If you need an address or a smart-wallet client below page level, take it from here.
 *
 * Caught rather than avoided: the calls still happen unconditionally, so hook order stays stable.
 * The failure mode is honest — no wallet means no address, which every caller already handles
 * because it is the same state as being signed out.
 */

export function useOptionalAddress(): string | undefined {
  try {
    return useAppKitAccount().address;
  } catch {
    return undefined;
  }
}

export function useOptionalSmartWalletClient(): ((opts: { id: number }) => Promise<unknown>) | null {
  try {
    return useSmartWallets().getClientForChain as (opts: { id: number }) => Promise<unknown>;
  } catch {
    return null;
  }
}
