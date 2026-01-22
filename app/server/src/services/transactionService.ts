import { ethers } from 'ethers';

/**
 * Get RPC URL for a chain
 */
function getRpcUrl(chainId: number): string {
  const rpcUrls: Record<number, string> = {
    1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    11155111: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  };

  return rpcUrls[chainId] || '';
}

export interface TransactionData {
  id: string;
  type: string;
  assetSymbol: string;
  amount: number;
  currency: string;
  date: string;
  status: string;
  hash: string;
  from?: string;
  to?: string;
  timestamp: number;
}

/**
 * Get transactions for an address on a chain
 */
export async function getTransactions(
  chainId: number,
  address: string,
  limit: number = 20
): Promise<TransactionData[]> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return [];
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const blockNumber = await provider.getBlockNumber();

    const transactions: TransactionData[] = [];
    const blocksToCheck = Math.min(limit * 3, 50);
    let foundCount = 0;

    for (let i = 0; i < blocksToCheck && foundCount < limit; i++) {
      try {
        const block = await provider.getBlock(blockNumber - i, true);
        if (!block || !block.transactions) continue;

        // Type guard: when getBlock is called with true, transactions are TransactionResponse objects
        const txList = block.transactions;
        if (!Array.isArray(txList)) continue;

        for (const tx of txList) {
          if (foundCount >= limit) break;

          // Skip if it's just a hash string (shouldn't happen with includeTransactions=true, but type guard)
          if (typeof tx === 'string') continue;

          // Now TypeScript knows tx is a TransactionResponse
          const txResponse = tx as ethers.TransactionResponse;
          const isFromAddress = txResponse.from?.toLowerCase() === address.toLowerCase();
          const isToAddress = txResponse.to?.toLowerCase() === address.toLowerCase();

          if (isFromAddress || isToAddress) {
            try {
              const receipt = await provider.getTransactionReceipt(txResponse.hash);
              const txStatus =
                receipt?.status === 1 ? 'completed' : receipt?.status === 0 ? 'failed' : 'pending';

              const value = parseFloat(ethers.formatEther(txResponse.value || 0n));
              const timestamp = Number(block.timestamp) * 1000;
              const date = new Date(timestamp).toISOString();

              // Determine transaction type
              let type = 'transfer';
              if (isFromAddress && value > 0) {
                type = 'withdraw';
              } else if (isToAddress && value > 0) {
                type = 'deposit';
              } else if (isFromAddress && !txResponse.to) {
                type = 'contract';
              }

              transactions.push({
                id: `${chainId}-${txResponse.hash}`,
                type,
                assetSymbol: 'ETH', // You may want to detect the actual token
                amount: value,
                currency: 'ETH',
                date,
                status: txStatus,
                hash: txResponse.hash,
                from: txResponse.from,
                to: txResponse.to || undefined,
                timestamp,
              });

              foundCount++;
            } catch (err) {
              // Skip this transaction
            }
          }
        }
      } catch (err) {
        // Skip this block
      }
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    return transactions.slice(0, limit);
  } catch (error) {
    console.error(`Error fetching transactions for ${address} on chain ${chainId}:`, error);
    return [];
  }
}
