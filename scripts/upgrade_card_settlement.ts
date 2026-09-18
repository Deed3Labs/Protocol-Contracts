import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * Card spend settles on chain, and fiat repayment clears it: upgrade RevolvingIssuer and wire the
 * settler.
 *
 * 1. UUPS upgrade, same proxy address, WITH the storage check. The new fields come out of __gap
 *    (41 -> 38), so there is nothing to excuse -- unlike the previous upgrade, which had to skip the
 *    check for a deliberate deletion.
 * 2. Authorise the card-settler key the API signs with (CARD_SETTLER_ADDRESS).
 * 3. Point card settlement at the co-op's account: the claim a settled purchase mints belongs to
 *    the float that paid the merchant. On testnet that is the issuer's carry treasury unless
 *    CARD_SETTLEMENT_ACCOUNT names another.
 *
 * Idempotent: each step checks the current state first, so re-running after a partial run is safe.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const existing = getDeployment(network, "RevolvingIssuer");
  if (!existing) throw new Error(`No RevolvingIssuer recorded for ${network}.`);
  const settler = (process.env.CARD_SETTLER_ADDRESS || "").trim();
  if (!ethers.isAddress(settler)) throw new Error("Set CARD_SETTLER_ADDRESS to the API's settler address.");

  let issuer = await ethers.getContractAt("RevolvingIssuer", existing.address);
  // Probe for the newest function this script ships (fiat repayment netting). An implementation
  // without it is upgraded; one with it is left alone, so the script stays safe to re-run.
  const isCurrent = await issuer
    .cardRepaymentOf(ethers.ZeroHash)
    .then(() => true)
    .catch(() => false);

  if (!isCurrent) {
    console.log("Upgrading RevolvingIssuer at", existing.address);
    console.log("  from implementation", await upgrades.erc1967.getImplementationAddress(existing.address));
    const RevolvingIssuer = await ethers.getContractFactory("RevolvingIssuer");
    const upgraded = await upgrades.upgradeProxy(existing.address, RevolvingIssuer, {
      kind: "uups",
      unsafeAllow: ["missing-initializer"],
    });
    await upgraded.waitForDeployment();
    console.log("  to implementation  ", await upgrades.erc1967.getImplementationAddress(existing.address));
    saveDeployment(network, "RevolvingIssuer", existing.address, JSON.parse(upgraded.interface.formatJson()));
    issuer = await ethers.getContractAt("RevolvingIssuer", existing.address);
  } else {
    console.log("RevolvingIssuer already has card settlement and repayment; skipping the upgrade.");
  }

  if (!(await issuer.isCardSettler(settler))) {
    const tx = await issuer.setCardSettler(settler, true);
    await tx.wait();
    console.log("Authorised card settler", settler, tx.hash);
  } else {
    console.log("Card settler already authorised:", settler);
  }

  const account = (process.env.CARD_SETTLEMENT_ACCOUNT || "").trim() || (await issuer.carryTreasury());
  if ((await issuer.cardSettlementAccount()).toLowerCase() !== account.toLowerCase()) {
    const tx = await issuer.setCardSettlementAccount(account);
    await tx.wait();
    console.log("Card settlement account set to", account, tx.hash);
  } else {
    console.log("Card settlement account already", account);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
