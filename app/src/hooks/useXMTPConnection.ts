import { useEffect, useRef, useState } from 'react';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { createPublicClient, http, hexToBytes } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { useAppKitAccount } from '@/lib/walletCompat';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { useXMTP } from '@/context/XMTPContext';
import type { Signer } from '@xmtp/browser-sdk';

/**
 * Builds an XMTP signer from the Privy SMART WALLET and connects. Identity = the Clear smart-wallet
 * address (the app's canonical address), so peers reach you at the same address the app shows. The
 * smart wallet signs via the Privy smart-wallet client, producing an EIP-1271 signature XMTP validates
 * ON-CHAIN — hence `type: 'SCW'` + getChainId.
 *
 * Because that validation is on-chain, the smart wallet must be DEPLOYED. Privy accounts are
 * counterfactual (deploy on first tx), so before connecting we check the bytecode and, if it's not
 * deployed, fire a tiny sponsored no-op UserOp to deploy it (gasless + silent). See
 * [[clearpath-privy-migration]].
 */
const chainFor = (id: number) => (id === baseSepolia.id ? baseSepolia : base);

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
      const smartWalletAddress = (address as string).toLowerCase() as `0x${string}`;
      const client = await getClientForChain({ id: ACTIVE_CHAIN_ID });
      if (!client) throw new Error('Your Clear wallet is still setting up — try again in a moment.');

      // Ensure the smart wallet is DEPLOYED so XMTP's on-chain 1271 check has a contract to validate
      // against. Undeployed → deploy with a sponsored no-op self-call (gasless, silent).
      try {
        const publicClient = createPublicClient({ chain: chainFor(ACTIVE_CHAIN_ID), transport: http() });
        const code = await publicClient.getBytecode({ address: smartWalletAddress });
        if (!code || code === '0x') {
          await client.sendTransaction({ calls: [{ to: smartWalletAddress, value: 0n, data: '0x' }] });
        }
      } catch (deployErr) {
        console.warn('XMTP: smart-wallet deploy check/deploy failed (continuing):', deployErr);
      }

      const signer: Signer = {
        type: 'SCW',
        getIdentifier: () => ({ identifier: smartWalletAddress, identifierKind: 'Ethereum' }),
        signMessage: async (message: string): Promise<Uint8Array> => {
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
