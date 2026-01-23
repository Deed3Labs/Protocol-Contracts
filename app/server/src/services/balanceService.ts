import { ethers } from 'ethers';
import { getRpcUrl } from '../utils/rpc.js';

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
 * Get multiple native balances in batch
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
