import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";
import {
  BOND_VAULT_READ_ABI,
  PAYOUT_POOL_READ_ABI,
  YIELD_POOL_READ_ABI,
  describePayoutFunding,
  evaluatePayoutFunding,
  gatherPayoutFunding,
  payoutKeeperConfigFromEnv,
  type BondVaultReader,
  type PayoutFundingStatus,
  type PayoutKeeperConfig,
  type PayoutPoolReader,
  type YieldPoolReader,
} from "../apps/api/src/services/payoutFunding/fundingStatus";

/*
 * Is the PayoutPool funded ahead of what it owes merchants? The payout funding keeper's check
 * (apps/api/src/jobs/payoutFundingKeeper.ts), by hand.
 *
 *   npx hardhat run scripts/check_payout_funding.ts --network base-sepolia
 *
 * Prints GREEN, AMBER or RED with the numbers behind it, what is needed and by when, and the
 * funding options (Yield Pool Deployment headroom, BondVault deployable excess, the treasury's
 * allowance to the pool). Exits 2 on RED, 1 if it could not read the chain, 0 otherwise.
 *
 * Read-only: every call is a view through the provider, never through a signer, so it sends
 * nothing and needs no key (the network's configured account, if any, is never used).
 *
 * Addresses: PAYOUT_POOL_<chainId>, LENDING_POOL_<chainId> and BOND_VAULT_<chainId> if set (the
 * API's variables), else the deployment records `PayoutPool`, `LendingPool` and `BondVault` for the
 * network. Settings: the keeper's PAYOUT_KEEPER_* variables (apps/api/env.example), with the same
 * defaults: 30 days, 2 business days (weekdays in America/Los_Angeles less PAYOUT_KEEPER_HOLIDAYS),
 * 200 claims.
 */
const { ethers } = hre;

export interface CheckAddresses {
  payoutPool: string;
  yieldPool?: string | null;
  bondVault?: string | null;
}

/** The check against `addresses`, on hardhat's provider. Views only. */
export async function checkPayoutFunding(
  addresses: CheckAddresses,
  config: PayoutKeeperConfig = payoutKeeperConfigFromEnv(process.env),
): Promise<{ status: PayoutFundingStatus; subject: string; body: string }> {
  const provider = ethers.provider;
  const reader = <T>(address: string, abi: readonly string[]) => new ethers.Contract(address, abi, provider) as unknown as T;
  const reads = await gatherPayoutFunding(
    {
      now: async () => {
        const block = await provider.getBlock("latest");
        if (!block) throw new Error("no latest block");
        return block.timestamp;
      },
      payoutPool: reader<PayoutPoolReader>(addresses.payoutPool, PAYOUT_POOL_READ_ABI),
      yieldPool: addresses.yieldPool ? reader<YieldPoolReader>(addresses.yieldPool, YIELD_POOL_READ_ABI) : null,
      bondVault: addresses.bondVault ? reader<BondVaultReader>(addresses.bondVault, BOND_VAULT_READ_ABI) : null,
    },
    config,
  );
  const status = evaluatePayoutFunding(reads, config);
  const chainId = (await provider.getNetwork()).chainId;
  const text = describePayoutFunding(status, { chain: `${hre.network.name} (${chainId})`, payoutPool: addresses.payoutPool });
  return { status, ...text };
}

async function main() {
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const pick = (variable: string, record: string) =>
    process.env[`${variable}_${chainId}`]?.trim() || getDeployment(network, record)?.address || null;
  const payoutPool = pick("PAYOUT_POOL", "PayoutPool");
  if (!payoutPool) throw new Error(`No PayoutPool for ${network}: set PAYOUT_POOL_${chainId} or add the deployment record.`);
  const { status, subject, body } = await checkPayoutFunding({
    payoutPool,
    yieldPool: pick("LENDING_POOL", "LendingPool"),
    bondVault: pick("BOND_VAULT", "BondVault"),
  });
  console.log(subject);
  console.log("");
  console.log(body);
  if (status.level === "RED") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
