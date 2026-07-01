import { useEffect, useRef, useState } from 'react';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { hexToBytes } from 'viem';
import { useAppKitAccount } from '@/lib/walletCompat';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { useXMTP } from '@/context/XMTPContext';
import type { Signer } from '@xmtp/browser-sdk';

/**
 * Builds an XMTP signer from the Privy SMART WALLET and connects. Identity = the Clear smart-wallet
 * address (the app's canonical address), so peers reach you at the same address the app shows. The
 * smart wallet signs via the Privy smart-wallet client, producing an EIP-1271 signature XMTP validates
 * on-chain — hence a `type: 'SCW'` signer with `getChainId`.
 *
 * NOTE: XMTP validates the SCW signature on-chain, so the smart wallet must be DEPLOYED on
 * ACTIVE_CHAIN_ID. Privy deploys it on the first sponsored tx (deposit/transfer), so a brand-new
 * account that hasn't transacted yet can't register until it does. See [[clearpath-privy-migration]].
 */
export const useXMTPConnection = () => {
  const { connect, isConnected, disconnect } = useXMTP();
  const { address, isConnected: isWalletConnected, embeddedWalletInfo } = useAppKitAccount();
  const { getClientForChain } = useSmartWallets();
  const [isConnecting, setIsConnecting] = useState(false);
  const prevAddressRef = useRef<string | undefined>(address);

  // Reset the XMTP session if the wallet changes (different user) or disconnects.
  useEffect(() => {
    const prev = prevAddressRef.current;
    if (isConnected && ((prev && address && prev !== address) || !isWalletConnected)) {
      disconnect().catch(console.error);
    }
    prevAddressRef.current = address;
  }, [address, isWalletConnected, isConnected, disconnect]);

  const handleConnect = async () => {
    if (!address || !isWalletConnected || isConnected || isConnecting) return;
    setIsConnecting(true);
    try {
      const smartWalletAddress = (address as string).toLowerCase();
      const signer: Signer = {
        type: 'SCW',
        getIdentifier: () => ({ identifier: smartWalletAddress, identifierKind: 'Ethereum' }),
        signMessage: async (message: string): Promise<Uint8Array> => {
          const client = await getClientForChain({ id: ACTIVE_CHAIN_ID });
          if (!client) throw new Error('Your Clear wallet is still setting up — try again in a moment.');
          const signature = await client.signMessage({ message });
          return hexToBytes(signature as `0x${string}`);
        },
        getChainId: () => BigInt(ACTIVE_CHAIN_ID),
      };
      await connect(signer);
    } catch (err) {
      console.error('XMTP: failed to connect', err);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  return {
    handleConnect,
    isConnecting,
    isConnected,
    isWalletConnected,
    address,
    isEmbeddedWallet: !!embeddedWalletInfo,
  };
};
