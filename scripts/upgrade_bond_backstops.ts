import hre from "hardhat";
import { getDeployment, saveDeployment } from "../deploy/helpers";

/*
 * UUPS upgrade of AssurancePool, BondVault and PayoutPool, same proxy addresses, so a bond and a
 * payout claim each have somewhere to go when the money is not there:
 *
 *  - A maturing bond is paid from BondVault, then the treasury (the Safe) up to the USDC allowance
 *    it has given the vault, then the AssurancePool as the last resort: excess, then buffer while
 *    the primary reserve is at target, never the primary reserve. The vault repays the reserve from
 *    new proceeds before the Safe can withdraw anything.
 *  - The AssurancePool's RTD counts the near-term bond gap it now backs: face value due inside the
 *    vault's window that neither the vault nor the treasury's allowance can pay.
 *  - A payout claim that has come due draws the yield pool, then BondVault's deployable excess
 *    (never its redemption reserve), then the treasury up to its allowance to the pool (as capital
 *    that holds the position it pays for), then the AssurancePool. Lenders split the carry by what
 *    each put up.
 *
 * The pool first, because the vault calls it; then the vault, which the payout pool calls; then the
 * payout pool. Each works on its own with the others not yet named, so a run that stops part way
 * leaves nothing calling a method that is not there. Then the three are named to each other.
 *
 *   npx hardhat run scripts/upgrade_bond_backstops.ts --network base-sepolia
 *
 * BOND_BACKSTOP_DRY_RUN=1 validates and reports without sending. Needs the AssurancePool's owner and
 * operator access, and admin and operator roles on BondVault and PayoutPool.
 *
 * The treasury's part is its own decision and is not made here: the Safe approves USDC to BondVault
 * and to PayoutPool for whatever cap its owners choose. Until it does, that step contributes nothing.
 */
const { ethers, upgrades } = hre as typeof hre & {
  upgrades: typeof import("@openzeppelin/hardhat-upgrades").upgrades;
};

const DRY_RUN = process.env.BOND_BACKSTOP_DRY_RUN === "1";

async function main() {
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  const [signer] = await ethers.getSigners();

  const reserve = getDeployment(network, "AssurancePool");
  const vault = getDeployment(network, "BondVault");
  const payout = getDeployment(network, "PayoutPool");
  if (!reserve || !vault || !payout) throw new Error(`Missing a deployment record for ${network}.`);

  console.log(`network        ${network} (${net.chainId})`);
  console.log(`signer         ${signer.address}`);
  console.log(`AssurancePool  ${reserve.address}`);
  console.log(`BondVault      ${vault.address}`);
  console.log(`PayoutPool     ${payout.address}`);

  const treasury: string = await (await ethers.getContractAt(["function coopTreasury() view returns (address)"], payout.address)).coopTreasury();
  console.log(`treasury       ${treasury} (PayoutPool's coopTreasury)`);

  const AssurancePool = await ethers.getContractFactory("AssurancePool");
  const BondVault = await ethers.getContractFactory("BondVault");
  const PayoutPool = await ethers.getContractFactory("PayoutPool");
  await upgrades.validateUpgrade(reserve.address, AssurancePool, { kind: "uups" });
  await upgrades.validateUpgrade(vault.address, BondVault, { kind: "uups" });
  await upgrades.validateUpgrade(payout.address, PayoutPool, { kind: "uups" });
  console.log("all three validate as upgrade-safe against what is deployed");

  if (DRY_RUN) {
    console.log("\nBOND_BACKSTOP_DRY_RUN=1: validated, nothing sent.");
    return;
  }

  const was = {
    reserve: await implementationOf(reserve.address),
    vault: await implementationOf(vault.address),
    payout: await implementationOf(payout.address),
  };

  console.log("\nupgrading AssurancePool…");
  const r = await upgrades.upgradeProxy(reserve.address, AssurancePool, { kind: "uups" });
  await r.waitForDeployment();
  saveDeployment(network, "AssurancePool", reserve.address, JSON.parse(r.interface.formatJson()));
  await confirm("AssurancePool", reserve.address, "lendToBondVault(uint256)", was.reserve);

  console.log("upgrading BondVault…");
  const v = await upgrades.upgradeProxy(vault.address, BondVault, { kind: "uups" });
  await v.waitForDeployment();
  saveDeployment(network, "BondVault", vault.address, JSON.parse(v.interface.formatJson()));
  await confirm("BondVault", vault.address, "uncoveredNearTerm()", was.vault);

  console.log("upgrading PayoutPool…");
  const p = await upgrades.upgradeProxy(payout.address, PayoutPool, { kind: "uups" });
  await p.waitForDeployment();
  saveDeployment(network, "PayoutPool", payout.address, JSON.parse(p.interface.formatJson()));
  await confirm("PayoutPool", payout.address, "setBondVault(address)", was.payout);

  console.log("\nnaming them to each other…");
  await (await v.getFunction("setBackstops")(treasury, reserve.address, payout.address)).wait(1);
  await (await r.getFunction("setBondVault")(vault.address)).wait(1);
  await (await p.getFunction("setBondVault")(vault.address)).wait(1);
  console.log(`BondVault      treasury ${await v.getFunction("treasury")()} · reserve ${await v.getFunction("assurancePool")()} · payout ${await v.getFunction("payoutPool")()}`);
  console.log(`AssurancePool  bondVault ${await r.getFunction("bondVault")()} · bondExposure ${await r.getFunction("bondExposure")()}`);
  console.log(`PayoutPool     bondVault ${await p.getFunction("bondVault")()}`);
  console.log("\nthe Safe's allowances to BondVault and PayoutPool are still its owners' to set.");
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function implementationOf(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(26));
}

/** Confirm against the chain, waiting for it to agree with itself. */
async function confirm(label: string, proxy: string, signature: string, before: string) {
  let implementation = before;
  for (let i = 0; i < 20 && implementation === before; i++) {
    implementation = await implementationOf(proxy);
    if (implementation === before) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`${label.padEnd(14)} implementation ${implementation}${implementation === before ? "  (unchanged)" : ""}`);
  if (implementation === before) throw new Error(`${label} at ${proxy} still runs its old implementation.`);
  // A function's own selector sits in its dispatcher even under viaIR; a caller's view of a callee's
  // doesn't, which is why only each contract's own new function is looked for.
  const present = (await ethers.provider.getCode(implementation)).includes(ethers.id(signature).slice(2, 10));
  console.log(`${"".padEnd(14)} ${signature.split("(")[0]} in deployed code: ${present}`);
  if (!present) throw new Error(`${label} at ${proxy} does not carry ${signature} after the upgrade.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
