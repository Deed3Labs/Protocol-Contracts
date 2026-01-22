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

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

export interface TokenBalanceData {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
}

/**
 * Get ERC20 token balance for an address
 */
export async function getTokenBalance(
  chainId: number,
  tokenAddress: string,
  userAddress: string
): Promise<TokenBalanceData | null> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    const [balance, symbol, name, decimals] = await Promise.all([
      contract.balanceOf(userAddress),
      contract.symbol().catch(() => 'UNKNOWN'),
      contract.name().catch(() => 'Unknown Token'),
      contract.decimals().catch(() => 18),
    ]);

    if (balance === 0n) {
      return null; // Zero balance
    }

    return {
      address: tokenAddress.toLowerCase(),
      symbol,
      name,
      decimals: Number(decimals),
      balance: ethers.formatUnits(balance, decimals),
      balanceRaw: balance.toString(),
    };
  } catch (error) {
    console.error(`Error fetching token balance for ${tokenAddress} on chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Get multiple token balances in batch
 */
export async function getTokenBalancesBatch(
  requests: Array<{ chainId: number; tokenAddress: string; userAddress: string }>
): Promise<Array<{ chainId: number; tokenAddress: string; userAddress: string; data: TokenBalanceData | null; error?: string }>> {
  const results = await Promise.allSettled(
    requests.map(async ({ chainId, tokenAddress, userAddress }) => {
      const data = await getTokenBalance(chainId, tokenAddress, userAddress);
      return {
        chainId,
        tokenAddress,
        userAddress,
        data,
      };
    })
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        chainId: requests[index].chainId,
        tokenAddress: requests[index].tokenAddress,
        userAddress: requests[index].userAddress,
        data: null,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}
