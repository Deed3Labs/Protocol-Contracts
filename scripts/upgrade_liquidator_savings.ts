import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * Let members settle savings-backed credit out of their own savings: upgrade the Liquidator (UUPS,
 * same address, WITH the storage check -- the new mapping comes out of __gap 43 -> 42), trust the
 * RevolvingIssuer for it, and confirm the Liquidator holds the rights the move needs. Idempotent.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const liq = getDeployment(network, "Liquidator");
  const rev = getDeployment(network, "RevolvingIssuer");
  if (!liq || !rev) throw new Error(`Liquidator or RevolvingIssuer missing for ${network}.`);

  let liquidator = await ethers.getContractAt("Liquidator", liq.address);
  const current = await liquidator.trustedSavingsIssuer(rev.address).then(() => true).catch(() => false);
  if (!current) {
    console.log("Upgrading Liquidator at", liq.address, "from", await upgrades.erc1967.getImplementationAddress(liq.address));
    const Liquidator = await ethers.getContractFactory("Liquidator");
    const upgraded = await upgrades.upgradeProxy(liq.address, Liquidator, { kind: "uups" });
    await upgraded.waitForDeployment();
    saveDeployment(network, "Liquidator", liq.address, JSON.parse(upgraded.interface.formatJson()));
    liquidator = await ethers.getContractAt("Liquidator", liq.address);
    console.log("  upgraded (implementation may read stale on a public RPC for a few seconds)");
  } else {
    console.log("Liquidator already supports settling from savings; skipping the upgrade.");
  }

  if (!(await liquidator.trustedSavingsIssuer(rev.address))) {
    const tx = await liquidator.setTrustedSavingsIssuer(rev.address, true);
    await tx.wait();
    console.log("Trusted RevolvingIssuer for savings settlement", tx.hash);
  } else {
    console.log("RevolvingIssuer already trusted");
  }

  // The move needs three rights -- the same ones liquidation needs. Testnet had only one of them,
  // which means liquidation could not have run there either. Granted here, idempotently.
  const issuer = await ethers.getContractAt("RevolvingIssuer", rev.address);
  const sc = await ethers.getContractAt("StableCredit", await issuer.stableCredit());
  const access = await ethers.getContractAt("AccessManager", await sc.access());
  const clrusd = await ethers.getContractAt("ClearUSDUpgradeable", await liquidator.clrusd());
  const registry = await ethers.getContractAt("CollateralRegistry", await liquidator.collateralRegistry());

  if (!(await access.isOperator(liq.address))) {
    const tx = await access.grantOperator(liq.address);
    await tx.wait();
    console.log("Granted operator on the credit system (settleFromCollateral)", tx.hash);
  }
  const LIQ = await clrusd.LIQUIDATOR_ROLE();
  if (!(await clrusd.hasRole(LIQ, liq.address))) {
    const tx = await clrusd.grantRole(LIQ, liq.address);
    await tx.wait();
    console.log("Granted LIQUIDATOR_ROLE on CLRUSD (seize past the lock)", tx.hash);
  }
  const OP = await registry.OPERATOR_ROLE();
  if (!(await registry.hasRole(OP, liq.address))) {
    const tx = await registry.grantRole(OP, liq.address);
    await tx.wait();
    console.log("Granted OPERATOR_ROLE on the collateral registry (record seizures)", tx.hash);
  }
  console.log("operator on the issuer:", await access.isOperator(liq.address));
  console.log("may seize CLRUSD:", await clrusd.hasRole(LIQ, liq.address));
  console.log("may record seizures:", await registry.hasRole(OP, liq.address));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
