import { ethers } from 'ethers';
import { chainId } from '../chargeService.js';

/**
 * What the shop already holds — reference section 07.
 *
 * Owed and held are different kinds of money, and the reference is explicit that showing them as
 * one figure misstates both. What the co-op owes is a claim: scheduled, and released only as far
 * as the payout pool allows. What sits here is already the merchant's, released and movable at any
 * hour. That distinction is the entire reason a withdrawal has to ask where the money comes from.
 *
 * The cash account IS the merchant's organization wallet. The merchant address the registry knows,
 * the address a payout lands at and the balance read here are the same address by construction —
 * which is what makes this a lookup rather than a reconciliation.
 *
 * USDC, not CLRUSD: this is the account a merchant sends an ACH into and withdraws from, so it
 * holds the dollar-denominated token the rails actually move.
 */
const USDC: Readonly<Record<number, string>> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const ERC20 = ['function balanceOf(address) view returns (uint256)'];

function provider(): ethers.JsonRpcProvider {
  const url =
    process.env.BASE_SEPOLIA_RPC_URL ||
    process.env.RPC_URL_84532 ||
    (chainId() === 8453 ? 'https://mainnet.base.org' : 'https://sepolia.base.org');
  return new ethers.JsonRpcProvider(url);
}

/**
 * Null, never zero, when the balance cannot be read.
 *
 * A shop with money in its account and an unreachable RPC would otherwise be shown $0.00 — a
 * number that looks like an empty account rather than a failed lookup, and one they would act on.
 * The screens say so instead.
 */
export async function cashAccountCents(merchant: string): Promise<number | null> {
  const token = USDC[chainId()];
  if (!token || !ethers.isAddress(merchant)) return null;

  try {
    const erc20 = new ethers.Contract(token, ERC20, provider());
    const raw = (await erc20.balanceOf(merchant)) as bigint;
    // USDC is 6dp; cents are 2. Truncate rather than round — a shop should never be shown a cent
    // it cannot withdraw.
    return Number(raw / 10_000n);
  } catch (error) {
    console.error(
      '[merchant] could not read the cash account balance',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}
