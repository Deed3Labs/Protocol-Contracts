import { createWalletClient, custom, encodeFunctionData, parseUnits } from 'viem';

/*
 * Move an ERC-20 (e.g. CLRUSD, which has NO EIP-3009/permit by decision A3) FROM a linked external wallet
 * TO the Clear smart wallet, using the LINKED wallet's own provider. Two tiers:
 *   1. EIP-5792 wallet_sendCalls + the ZeroDev paymaster — the wallet uses EIP-7702 to batch + sponsor at
 *      its own address → GASLESS, when the wallet supports it.
 *   2. Plain ERC-20 transfer — the linked wallet pays its own (small, Base) gas. Universal fallback.
 * USDC has a better path (the EIP-3009 relayer, see gaslessMoney) — this is for tokens without 3009.
 * See [[clearpath-account-abstraction]] / the 3-tier note in [[clearpath-privy-migration]].
 */

const ERC20_TRANSFER = [
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const ZERODEV_PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const paymasterUrl = (chainId: number) => `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${chainId}?selfFunded=true`;

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export async function linkedWalletTokenTransfer(args: {
  provider: unknown; // the linked wallet's EIP-1193 provider (Privy getEthereumProvider)
  from: `0x${string}`;
  token: `0x${string}`;
  to: `0x${string}`; // the Clear smart wallet
  amount: string; // decimal; CLRUSD is 6-decimals (matches USDC)
  chainId: number;
}): Promise<string> {
  const provider = args.provider as Eip1193Provider;
  const value = parseUnits(args.amount, 6);
  const data = encodeFunctionData({ abi: ERC20_TRANSFER, functionName: 'transfer', args: [args.to, value] });

  // Tier 1 — 7702/EIP-5792: ask the wallet to sponsor via the paymaster. Any failure → plain transfer.
  if (ZERODEV_PROJECT_ID) {
    try {
      const sendRes = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            version: '2.0.0',
            from: args.from,
            chainId: `0x${args.chainId.toString(16)}`,
            atomicRequired: true,
            calls: [{ to: args.token, data }],
            capabilities: { paymasterService: { url: paymasterUrl(args.chainId) } },
          },
        ],
      });
      const id = typeof sendRes === 'string' ? sendRes : (sendRes as { id?: string })?.id;
      if (id) {
        for (let i = 0; i < 30; i++) {
          const st = (await provider.request({ method: 'wallet_getCallsStatus', params: [id] })) as {
            status?: number | string;
            receipts?: Array<{ transactionHash?: string }>;
          };
          const receipts = st?.receipts ?? [];
          const hash = receipts[receipts.length - 1]?.transactionHash;
          if (hash && (st?.status === 200 || st?.status === 'CONFIRMED' || receipts.length > 0)) return hash;
          if (st?.status === 500 || st?.status === 'FAILED') throw new Error('Sponsored call failed.');
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw new Error('Sponsored call did not confirm.');
    } catch {
      /* fall through to the plain transfer */
    }
  }

  // Tier 2 — plain transfer (linked wallet pays gas).
  const walletClient = createWalletClient({ account: args.from, transport: custom(provider as Parameters<typeof custom>[0]) });
  return walletClient.sendTransaction({ account: args.from, to: args.token, data, chain: null } as Parameters<typeof walletClient.sendTransaction>[0]);
}
