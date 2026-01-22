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

/**
 * Get native token balance for an address on a chain
 */
export async function getBalance(
  chainId: number,
  address: string
): Promise<{ balance: string; balanceWei: string; balanceUSD: number } | null> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balanceWei = await provider.getBalance(address);
    const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);

    // Note: balanceUSD calculation should be done on the client side with current price
    // We return 0 here and let the client calculate it
    return {
      balance,
      balanceWei: balanceWei.toString(),
      balanceUSD: 0, // Client will calculate with current price
    };
  } catch (error) {
    console.error(`Error fetching balance for ${address} on chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Get multiple balances in batch
 */
export async function getBalancesBatch(
  requests: Array<{ chainId: number; address: string }>
): Promise<Array<{ chainId: number; address: string; balance: string | null; balanceWei: string | null; error?: string }>> {
  const results = await Promise.allSettled(
    requests.map(async ({ chainId, address }) => {
      const result = await getBalance(chainId, address);
      return {
        chainId,
        address,
        balance: result?.balance || null,
        balanceWei: result?.balanceWei || null,
      };
    })
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        chainId: requests[index].chainId,
        address: requests[index].address,
        balance: null,
        balanceWei: null,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}
