import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Registers a merchant, which is what makes it possible to raise a charge at all.
 *
 * A merchant has no account and no password. It is an address in `MerchantRegistry`, and it
 * authenticates by signing -- the server recovers the signer from an EIP-712 charge and asks this
 * registry whether that address is a merchant in good standing. So registering one here is the
 * whole of merchant onboarding as it exists today, and until at least one exists the charge flow
 * cannot be exercised end to end by anybody.
 *
 * The three terms are all enforced server-side on every charge, so they are not documentation:
 *
 *   discountBps   what the co-op takes. The merchant reference quotes 2.5% at confirmation, so
 *                 250 unless a merchant negotiated otherwise. The payout is computed from this
 *                 and never from what the merchant device sends.
 *   approvalCap   the ceiling on a single charge. Zero means no ceiling, which is the right
 *                 default for a trusted partner and the wrong one for a new counter.
 *   payoutWindow  how long the co-op has to pay the claim. Zero takes the registry default.
 *
 *   MERCHANT=0x… npx hardhat run scripts/register_merchant.ts --network base-sepolia
 *   MERCHANT=0x… DISCOUNT_BPS=250 APPROVAL_CAP=2000 npx hardhat run scripts/register_merchant.ts --network base-sepolia
 *
 * APPROVAL_CAP is in dollars for the sake of whoever runs this; it is converted to the 6dp units
 * the contract holds. Run by an operator.
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

  const discountBps = BigInt(process.env.DISCOUNT_BPS?.trim() || "250");
  if (discountBps > 10_000n) throw new Error("DISCOUNT_BPS cannot exceed 10000.");

  const capDollars = process.env.APPROVAL_CAP?.trim() || "0";
  const approvalCap = ethers.parseUnits(capDollars, 6);
  const payoutWindow = Number(process.env.PAYOUT_WINDOW?.trim() || "0");

  const registry = await ethers.getContractAt("MerchantRegistry", record.address);

  if (await registry.isRegistered(merchant)) {
    // Registering twice reverts, so say what is already true rather than failing on a re-run.
    const terms = await registry.termsOf(merchant);
    console.log("already registered:", merchant);
    console.log("  active       ", terms.active);
    console.log("  discountBps  ", terms.discountBps.toString());
    console.log("  approvalCap  ", ethers.formatUnits(terms.approvalCap, 6));
    console.log("  payoutWindow ", terms.payoutWindow.toString(), "seconds");
    console.log("\nUse updateTerms to change these; this script only registers.");
    return;
  }

  const tx = await registry.registerMerchant(merchant, payoutWindow, approvalCap, discountBps);
  const receipt = await tx.wait();
  console.log("registered", merchant, "in", receipt?.hash ?? tx.hash);
  console.log("  discountBps ", discountBps.toString(), `(${Number(discountBps) / 100}%)`);
  console.log("  approvalCap ", approvalCap === 0n ? "none" : `$${capDollars}`);
  console.log("  payoutWindow", payoutWindow === 0 ? "registry default" : `${payoutWindow}s`);
  console.log("\nMerchants now registered:", (await registry.merchantCount()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
