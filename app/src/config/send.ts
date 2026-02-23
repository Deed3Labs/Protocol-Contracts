import { getCommonTokens } from '@/config/tokens';

const DEFAULT_SUPPORTED_CHAIN_IDS = [8453];

function parseChainList(rawValue: string | undefined): number[] {
  if (!rawValue) return DEFAULT_SUPPORTED_CHAIN_IDS;
  const parsed = rawValue
    .split(',')
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return parsed.length > 0 ? parsed : DEFAULT_SUPPORTED_CHAIN_IDS;
}

export function getSendSupportedChainIds(): number[] {
  return parseChainList(import.meta.env.VITE_SEND_SUPPORTED_CHAIN_IDS);
}

export function getSendUsdcAddress(chainId: number): string | null {
  const overrideKey = `VITE_SEND_USDC_${chainId}`;
  const overrideAddress = (import.meta.env[overrideKey] as string | undefined)?.trim();
  if (overrideAddress) {
    return overrideAddress;
  }

  const usdcToken = getCommonTokens(chainId).find((token) => token.symbol.toUpperCase() === 'USDC');
  return usdcToken?.address || null;
}

export function getSendClaimEscrowAddress(chainId: number): string | null {
  const chainSpecificKey = `VITE_SEND_CLAIM_ESCROW_${chainId}`;
  const chainSpecific = (import.meta.env[chainSpecificKey] as string | undefined)?.trim();
  if (chainSpecific) {
    return chainSpecific;
  }

  const globalValue = (import.meta.env.VITE_SEND_CLAIM_ESCROW_ADDRESS as string | undefined)?.trim();
  return globalValue || null;
}

export const SEND_USDC_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

export const CLAIM_ESCROW_ABI = [
  'function createTransfer(bytes32 transferId, uint256 principalUsdc, uint256 sponsorFeeUsdc, uint64 expiry, bytes32 recipientHintHash)',
] as const;
