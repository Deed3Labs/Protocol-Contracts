import { saveDeployment, getDeployment } from "./helpers";

/**
 * The co-op's $10 offers: OffersIssuer, its capped line, and the ledger told about it.
 *
 * The contract holds a credit line and gives each new member the offer from it, so nothing is
 * funded in advance. It is registered as an issuer against the ledger like the revolving and term
 * issuers (it opens lines and reverses expired offers on it), and its line is opened at the cap.
 * Nothing about it is exposure: its `debtByKind` reports no position, so the AssurancePool's RTD
 * does not reserve against the co-op owing itself.
 *
 * Idempotent: an OffersIssuer already recorded in `deployments/<network>/` is reused, and every
 * wiring call is a set.
 *
 *   npx hardhat run deploy/24_deploy_OffersIssuer.ts --network base-sepolia
 *
 * OFFERS_TREASURY is the Safe that pays the line down; unset, it is the PayoutPool's coopTreasury.
 * OFFERS_CAP (default 1000), OFFER_AMOUNT (default 10) and OFFER_EXPIRY_DAYS (default 90) are in
 * dollars and days. Needs operator access on the AccessManager and NetworkRegistry.
 *
 * Two things are left for after it, and said so at the end: the API's OFFERS_ISSUER_<chainId>, and
 * the Safe's USDC allowance to the contract, which is what `settle` pays the line down with.
 */
async function main() {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;

  const ledger = getDeployment(network, "ClearCredit");
  const registry = getDeployment(network, "NetworkRegistry");
  const pool = getDeployment(network, "AssurancePool");
  const oracle = getDeployment(network, "AssuranceOracle");
  const payout = getDeployment(network, "PayoutPool");
  if (!ledger || !registry || !pool || !oracle) throw new Error(`Missing the credit core on ${network}: run 20_deploy_CreditCore first.`);

  const treasury =
    process.env.OFFERS_TREASURY?.trim() ||
    (payout ? await (await ethers.getContractAt(["function coopTreasury() view returns (address)"], payout.address)).coopTreasury() : "");
  if (!treasury) throw new Error("No treasury: set OFFERS_TREASURY to the Safe.");

  const decimals = Number(await (await ethers.getContractAt(["function decimals() view returns (uint8)"], ledger.address)).decimals());
  const dollars = (v: string) => ethers.parseUnits(v, decimals);
  const amount = dollars(process.env.OFFER_AMOUNT?.trim() || "10");
  const cap = dollars(process.env.OFFERS_CAP?.trim() || "1000");
  const expiry = Number(process.env.OFFER_EXPIRY_DAYS?.trim() || "90") * 24 * 60 * 60;

  console.log(`network        ${network} (${net.chainId})`);
  console.log(`deployer       ${deployer.address}`);
  console.log(`treasury       ${treasury}`);
  console.log(`offer          ${ethers.formatUnits(amount, decimals)} · cap ${ethers.formatUnits(cap, decimals)} · expires after ${expiry / 86400} days`);

  let offers;
  const existing = getDeployment(network, "OffersIssuer");
  if (existing) {
    console.log(`= OffersIssuer already at ${existing.address}`);
    offers = await ethers.getContractAt("OffersIssuer", existing.address);
  } else {
    const factory = await ethers.getContractFactory("OffersIssuer");
    offers = await upgrades.deployProxy(factory, [ledger.address, treasury, amount, expiry], { initializer: "initialize", kind: "uups" });
    await offers.waitForDeployment();
    saveDeployment(network, "OffersIssuer", await offers.getAddress(), JSON.parse(offers.interface.formatJson()));
    console.log(`+ OffersIssuer deployed to ${await offers.getAddress()}`);
  }
  const address = await offers.getAddress();

  const networkRegistry = await ethers.getContractAt("NetworkRegistry", registry.address);
  if (!(await networkRegistry.isIssuer(address))) {
    await (await networkRegistry.registerIssuer(address, ledger.address, pool.address, oracle.address)).wait();
    console.log("  registered against the ledger");
  }
  if ((await offers.cap()) !== cap) {
    await (await offers.setCap(cap)).wait();
    console.log(`  line opened at ${ethers.formatUnits(cap, decimals)}`);
  }

  console.log(`\nleft to do:
  - the API: OFFERS_ISSUER_${net.chainId}=${address}
  - the Safe: approve USDC to ${address} for whatever cap its owners choose, so settle() can pay the line down`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
