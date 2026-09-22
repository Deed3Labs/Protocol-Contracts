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
 *
 * It also grants the merchant network membership, without which they can be paid but cannot
 * redeem -- see `grantMembership` below. Re-running it on a merchant who is already registered
 * does nothing except that check, which is how the two merchants registered before this existed
 * get fixed.
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
    await grantMembership(merchant);
    return;
  }

  const tx = await registry.registerMerchant(merchant, payoutWindow, approvalCap, discountBps);
  const receipt = await tx.wait();
  console.log("registered", merchant, "in", receipt?.hash ?? tx.hash);
  console.log("  discountBps ", discountBps.toString(), `(${Number(discountBps) / 100}%)`);
  console.log("  approvalCap ", approvalCap === 0n ? "none" : `$${capDollars}`);
  console.log("  payoutWindow", payoutWindow === 0 ? "registry default" : `${payoutWindow}s`);
  console.log("\nMerchants now registered:", (await registry.merchantCount()).toString());

  await grantMembership(merchant);
}

/*
 * The half of onboarding that is not in the registry at all.
 *
 * `StableCredit.senderIsMember` gates every outbound transfer, and a merchant redeeming has the
 * pool pull their credits with `transferFrom` -- so a merchant who is registered but not a member
 * takes payment perfectly well and then cannot redeem a cent of it. The revert carries no reason
 * string, because deployed builds strip them.
 *
 * Both merchants on Base Sepolia were in exactly that state, undetected, because the test fixtures
 * grant membership and nothing in onboarding did. It belongs here: registration is already an
 * operator's job, and this is the same operator in the same run.
 *
 * Buying on credit grants membership by itself (`StableCredit._accrueCredit`), so this is only
 * ever ahead of that, never instead of it.
 */
async function grantMembership(merchant: string) {
  const network = (await ethers.provider.getNetwork()).name;
  const credit = getDeployment(network, "ClearCredit");
  if (!credit) {
    console.log("\nNo ClearCredit recorded here, so membership was not checked. Check it by hand:");
    console.log("a merchant who is not a network member cannot redeem.");
    return;
  }

  const accessAddress: string = await (
    await ethers.getContractAt(["function access() view returns (address)"], credit.address)
  ).access();
  const access = await ethers.getContractAt(
    [
      "function isMember(address) view returns (bool)",
      "function isOperator(address) view returns (bool)",
      "function grantMember(address) external",
    ],
    accessAddress,
  );

  if (await access.isMember(merchant)) {
    console.log("network member: already");
    return;
  }

  const [signer] = await ethers.getSigners();
  if (!(await access.isOperator(signer.address))) {
    console.log(`\n${merchant} IS NOT A NETWORK MEMBER AND CANNOT REDEEM.`);
    console.log(`${signer.address} is not an operator, so this run could not fix it.`);
    console.log(`Have an operator call grantMember(${merchant}) on ${accessAddress}.`);
    return;
  }

  const tx = await access.grantMember(merchant);
  await tx.wait();
  console.log("network member: granted in", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
