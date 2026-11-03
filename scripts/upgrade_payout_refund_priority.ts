import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of PayoutPool, same proxy address, so refunds owed come ahead of every claim and a
 * lender's return reaches the lender.
 *
 *   - `payNext`, `payQueue`, `canPayNext` and `redeem`'s pay-on-the-spot used the pool's whole
 *     balance, so a claim could be paid out of money already owed to a member on a refund. Only
 *     `drawForDueClaim` held it back. All of them now pay from the balance less `refundsOwed`, and
 *     `shortfall` counts what is owed.
 *   - The yield pool's return was paid through `LendingPool.repay`, which takes everything as
 *     principal while anybody owes it; with the card settler owing, the return came off the
 *     settler's loan instead of reaching depositors. It is now sent as cash.
 *   - A lender unnamed since it lent had its return counted as paid without being sent. It now
 *     stays owed, in `carryEarned`, until the lender is named again.
 *
 * No storage changes. No other contract changes, and nothing calls PayoutPool differently.
 *
 *   npx hardhat run scripts/upgrade_payout_refund_priority.ts --network base-sepolia
 *
 * PAYOUT_UPGRADE_DRY_RUN=1 validates and reports without sending. The upgrade needs
 * DEFAULT_ADMIN_ROLE on PayoutPool. If the signer has it, this upgrades. If it does not -- the Ops
 * Safe holds it once admin has been handed over -- this deploys the new implementation and prints
 * the call for the Safe to make.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.PAYOUT_UPGRADE_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const record = getDeployment(network, "PayoutPool");
  const ledger = getDeployment(network, "ClearCredit");
  if (!record) throw new Error(`No PayoutPool recorded for ${network}.`);
  if (!ledger) throw new Error(`No ClearCredit recorded for ${network}.`);

  console.log(`network       ${network} (${net.chainId})`);
  console.log(`signer        ${signer.address}`);
  console.log(`PayoutPool    ${record.address}`);

  // The pool the ledger pays into, not just the one on record: upgrading the wrong one would
  // report success and change nothing that matters.
  const wired: string = await (
    await ethers.getContractAt(["function payoutPool() view returns (address)"], ledger.address)
  ).payoutPool();
  if (wired.toLowerCase() !== record.address.toLowerCase()) {
    throw new Error(`The ledger pays into ${wired}, not the PayoutPool on record.`);
  }

  const pool = await ethers.getContractAt("PayoutPool", record.address);
  console.log(`refundsOwed   ${ethers.formatUnits(await pool.refundsOwed(), 6)}`);
  console.log(`queued        ${ethers.formatUnits(await pool.queuedTotal(), 6)}`);
  console.log(`held          ${ethers.formatUnits(await pool.held(), 6)}`);

  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  await upgrades.validateUpgrade(record.address, PayoutPool, { kind: "uups" });
  console.log("validates as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nPAYOUT_UPGRADE_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const isAdmin: boolean = await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), signer.address);
  const before = await implementationOf(record.address);

  if (!isAdmin) {
    // Admin sits elsewhere, normally the Ops Safe: put the code on chain and hand over the call.
    const implementation = (await upgrades.prepareUpgrade(record.address, PayoutPool, {
      kind: "uups",
    })) as string;
    const data = PayoutPool.interface.encodeFunctionData("upgradeTo", [implementation]);
    console.log("\nThe signer isn't PayoutPool's admin, so nothing was upgraded.");
    console.log(`new implementation  ${implementation}`);
    console.log("Have the admin (the Ops Safe) send:");
    console.log(`  to     ${record.address}`);
    console.log(`  value  0`);
    console.log(`  data   ${data}`);
    return;
  }

  console.log("\nupgrading PayoutPool…");
  const upgraded = await upgrades.upgradeProxy(record.address, PayoutPool, { kind: "uups" });
  await upgraded.waitForDeployment();
  saveDeployment(network, "PayoutPool", record.address, JSON.parse(upgraded.interface.formatJson()));

  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(record.address);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  if (implementation === before) throw new Error("PayoutPool still runs its old implementation.");
  console.log(`implementation ${implementation}`);
  console.log(`shortfall      ${ethers.formatUnits(await pool.shortfall(), 6)}  (now counts refunds owed)`);
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
