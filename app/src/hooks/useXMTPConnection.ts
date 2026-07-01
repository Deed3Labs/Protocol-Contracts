import { useEffect, useRef, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { hexToBytes, toHex } from 'viem';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useXMTP } from '@/context/XMTPContext';
import type { Signer } from '@xmtp/browser-sdk';

/**
 * XMTP signer backed by the Privy EMBEDDED EOA (not the smart wallet). Why: XMTP validates a smart
 * wallet's EIP-1271 signature ON-CHAIN, which fails on Base Sepolia (XMTP's `production` network can't
 * call isValidSignature on a testnet contract) → "Signature validation failed". The embedded EOA signs
 * with standard ECDSA (`type: 'EOA'`), which XMTP verifies by ecrecover with no on-chain call, so it
 * works on any chain.
 *
 * TRADE-OFF: the XMTP inbox is at the EOA address, but the app addresses peers by their (smart) wallet.
 * Peer messaging therefore needs the member directory to resolve the EOA as the messaging address (or,
 * on mainnet, the SCW/smart-wallet identity may validate and we can revisit). See
 * [[clearpath-privy-migration]].
 */
export const useXMTPConnection = () => {
  const { connect, isConnected, disconnect } = useXMTP();
  const { isConnected: isWalletConnected, embeddedWalletInfo } = useAppKitAccount();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === 'privy');
  const eoaAddress = embedded?.address;
  const [isConnecting, setIsConnecting] = useState(false);
  const prevAddressRef = useRef<string | undefined>(eoaAddress);

  // Reset the XMTP session if the wallet changes (different user) or disconnects.
  useEffect(() => {
    const prev = prevAddressRef.current;
    if (isConnected && ((prev && eoaAddress && prev !== eoaAddress) || !isWalletConnected)) {
      disconnect().catch(console.error);
    }
    prevAddressRef.current = eoaAddress;
  }, [eoaAddress, isWalletConnected, isConnected, disconnect]);

  const handleConnect = async () => {
    if (!embedded || !eoaAddress || !isWalletConnected || isConnected || isConnecting) return;
    setIsConnecting(true);
    try {
      const addr = eoaAddress.toLowerCase();
      const provider = (await embedded.getEthereumProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      const signer: Signer = {
        type: 'EOA',
        getIdentifier: () => ({ identifier: addr, identifierKind: 'Ethereum' }),
        signMessage: async (message: string): Promise<Uint8Array> => {
          const signature = (await provider.request({ method: 'personal_sign', params: [toHex(message), addr] })) as string;
          return hexToBytes(signature as `0x${string}`);
        },
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
    address: eoaAddress,
    isEmbeddedWallet: !!embeddedWalletInfo,
  };
};
