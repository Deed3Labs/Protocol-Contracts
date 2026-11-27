import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Turns a merchant off, or back on.
 *
 * `MerchantRegistry` has no remove, deliberately: a shop that ever raised a charge is part of the
 * record, and deleting the row would orphan every charge, claim and payout that names it. Inactive
 * is the honest state -- `PayoutPool.redeem` refuses a registered-but-inactive merchant, and the
 * charge path checks the same flag -- and it is reversible, which deletion is not.
 *
 *   MERCHANT=0x… npx hardhat run scripts/set_merchant_active.ts --network base-sepolia
 *   MERCHANT=0x… ACTIVE=true npx hardhat run scripts/set_merchant_active.ts --network base-sepolia
 *
 * ACTIVE defaults to false, because deactivating is the reason this exists.
 *
 * It refuses to deactivate a merchant still holding a balance. That balance is money the co-op
 * owes them, and an inactive merchant cannot redeem it -- so switching one off mid-payable strands
 * it until somebody notices. Pay them out first, or pass STRAND=1 to say you meant it.
 *
 * Run by an operator.
 */
const { ethers } = hre as typeof hre & {
  ethers: typeof import("hardhat").ethers;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const record = getDeployment(network, "MerchantRegistry");
  if (!record) throw new Error(`No MerchantRegistry on ${network}.`);

  const merchant = process.env.MERCHANT?.trim();
  if (!merchant || !ethers.isAddress(merchant)) throw new Error("Set MERCHANT to an address.");
  const active = process.env.ACTIVE?.trim() === "true";

  const registry = await ethers.getContractAt("MerchantRegistry", record.address);
  if (!(await registry.isRegistered(merchant))) throw new Error(`${merchant} is not registered.`);

  const was: boolean = await registry.isActive(merchant);
  console.log(`${merchant}  active ${was} -> ${active}`);
  if (was === active) {
    console.log("Already there. Nothing sent.");
    return;
  }

  if (!active) {
    const credit = getDeployment(network, "ClearCredit");
    if (credit) {
      const ledger = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)"],
        credit.address,
      );
      const held: bigint = await ledger.balanceOf(merchant);
      if (held > 0n && process.env.STRAND !== "1") {
        throw new Error(
          `${merchant} still holds ${ethers.formatUnits(held, 6)} they are owed, and an inactive ` +
            "merchant cannot redeem it. Pay them out first, or set STRAND=1 if that is the intent.",
        );
      }
      if (held > 0n) console.log(`WARNING: stranding ${ethers.formatUnits(held, 6)} they are owed.`);
    }
  }

  const tx = await registry.setActive(merchant, active);
  await tx.wait();
  console.log(`done (${tx.hash})`);

  // Read until the node agrees with itself. A read taken the instant this is mined can still be
  // served from the previous state, which reports the old flag on a run that in fact succeeded --
  // the kind of wrong answer that gets believed.
  let now: boolean = was;
  for (let i = 0; i < 20 && now === was; i++) {
    now = await registry.isActive(merchant);
    if (now === was) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`active now ${now}${now === was ? "  (node still catching up — check again)" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
