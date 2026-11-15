import { getDeployment, requireMainnetConfirmation } from "../deploy/helpers";

/*
 * Unwinds the pre-2f bonds before the BondVault upgrade (PHASE-2F-BONDS.md §3 item 22: after it, a
 * pre-2f collection can neither record into nor settle through the vault). Every pre-2f collection
 * on record is covered:
 *
 * - `BurnerBondLegacy` (replaced 2026-11-03);
 * - the current pre-2f collection, `BurnerBond`, or `BurnerBondPre2f` once deploy 22 with
 *   REPLACE_BOND_FACTORY=1 has kept it under that name;
 * - every collection the recorded factories made (`BurnerBondFactoryLegacy`,
 *   `BurnerBondFactoryPre2f`, `BurnerBondFactory`) that is pre-2f.
 *
 * A collection is pre-2f when it does not answer `controls()` (the Phase 2f collection does).
 *
 * MODE=report (the default) reads only: for each pre-2f collection, every bond its vault still
 * holds outstanding, with its creator, whether the creator still holds it, face, maturity and
 * present value, and whether the vault holds enough to pay them all early. It sends nothing and
 * needs no key.
 *
 * MODE=unwind closes out one holder's bonds, at the holder's request (HOLDER; IDS=1,2 limits it),
 * and sends them what the bonds are worth today, so the money can buy bonds in the new collection.
 * A pre-2f collection has no early redemption for a holder, only for its liquidator. So, per
 * collection: the owner names itself liquidator, takes each bond (`seizeBond`), redeems it early at
 * present value (`redeemEarly`, paid by the BondVault), sends everything it received to the holder,
 * and puts the liquidator back. If the vault holds less than that, TOP_UP=1 has the signer send the
 * difference to the vault first. It refuses once the BondVault is upgraded (the collection could
 * no longer settle through it) and needs CONFIRM=unwind. On a fork the deployer is impersonated and
 * nothing is real.
 *
 *   npx hardhat run scripts/unwind_legacy_bonds.ts --network base-sepolia                                      # report
 *   MODE=unwind CONFIRM=unwind HOLDER=0x… npx hardhat run scripts/unwind_legacy_bonds.ts --network base-sepolia
 *   FORK_RPC_URL=https://sepolia.base.org MODE=unwind CONFIRM=unwind HOLDER=0x… TOP_UP=1 npx hardhat run scripts/unwind_legacy_bonds.ts
 */

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** The pre-2f collection's own ABI: Phase 2e removed `seizeBond` and `redeemEarly` from BurnerBond's
 * source, but the pre-2f collections are clones of the old implementation and still have them. */
export const PRE2F_BOND_ABI = [
  "function owner() view returns (address)",
  "function bondVault() view returns (address)",
  "function liquidator() view returns (address)",
  "function setLiquidator(address)",
  "function seizeBond(uint256 bondId, address from, address to)",
  "function redeemEarly(uint256 bondId) returns (uint256)",
  "function presentValueOf(uint256 bondId) view returns (uint256)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function getBondIdsByCreator(address creator) view returns (uint256[])",
  "function getBondInfo(uint256 bondId) view returns ((uint256 faceValue, uint256 maturityDate, uint256 discountPercentage, uint256 purchasePrice, bool isRedeemed, address creator, uint64 issuedAt))",
];

export const PRE2F_VAULT_ABI = [
  "function outstandingBonds() view returns (uint256[])",
  "function held() view returns (uint256)",
  "function obligations(uint256) view returns (uint256 principal, uint256 faceValue, uint64 maturity, bool settled)",
  "function agent() view returns (address)",
];

export const PRE2F_COLLECTION_RECORDS = ["BurnerBondLegacy", "BurnerBondPre2f", "BurnerBond"];
export const BOND_FACTORY_RECORDS = ["BurnerBondFactoryLegacy", "BurnerBondFactoryPre2f", "BurnerBondFactory"];

type At = (address: string, abi: string[]) => any;
const defaultAt: At = (address, abi) => {
  const { ethers } = require("hardhat");
  return new ethers.Contract(address, abi, ethers.provider);
};

/** Whether `address` is a pre-2f collection: the Phase 2f one answers `controls()`. */
export async function isPre2fCollection(address: string, at: At = defaultAt): Promise<boolean> {
  return at(address, ["function controls() view returns (address)"]).controls().then(() => false, () => true);
}

/** Every pre-2f collection on record, each once: the named records, then each factory's collections. */
export async function pre2fCollections(lookup: (name: string) => string | undefined, at: At = defaultAt) {
  const { ethers } = require("hardhat");
  const found: { name: string; address: string }[] = [];
  const seen = new Set<string>();
  const add = async (name: string, address?: string) => {
    if (!address || address === ethers.ZeroAddress || seen.has(address.toLowerCase())) return;
    seen.add(address.toLowerCase());
    if (await isPre2fCollection(address, at)) found.push({ name, address: ethers.getAddress(address) });
  };
  for (const name of PRE2F_COLLECTION_RECORDS) await add(name, lookup(name));
  for (const f of BOND_FACTORY_RECORDS) {
    const address = lookup(f);
    if (!address) continue;
    const factory = at(address, [
      "function getCollectionCount() view returns (uint256)",
      "function getCollectionAtIndex(uint256) view returns ((address tokenAddress, string tokenSymbol, string tokenName, address collectionAddress, address depositContract, bool isActive, uint256 createdAt))",
    ]);
    const n = Number(await factory.getCollectionCount().catch(() => 0n));
    for (let i = 0; i < n; i++) {
      const info = await factory.getCollectionAtIndex(i);
      await add(`${f} collection ${info.tokenSymbol || i}`, info.collectionAddress);
    }
  }
  return found;
}

export interface OutstandingBond {
  collection: string;
  collectionName: string;
  vault: string;
  id: bigint;
  creator: string;
  creatorHolds: boolean;
  faceValue: bigint;
  maturityDate: bigint;
  presentValue: bigint;
}

/**
 * Read-only: every bond of each pre-2f collection that its vault still holds outstanding, and per
 * vault what it holds against what paying them all early would take. Sends nothing.
 */
export async function outstandingPre2fBonds(collections: { name: string; address: string }[], at: At = defaultAt) {
  const bonds: OutstandingBond[] = [];
  const vaults = new Map<string, { held: bigint; presentValue: bigint; faceValue: bigint; count: number }>();
  for (const c of collections) {
    const bond = at(c.address, PRE2F_BOND_ABI);
    const vaultAddress: string = await bond.bondVault();
    const vault = at(vaultAddress, PRE2F_VAULT_ABI);
    const key = vaultAddress.toLowerCase();
    if (!vaults.has(key)) vaults.set(key, { held: await vault.held(), presentValue: 0n, faceValue: 0n, count: 0 });
    for (const id of (await vault.outstandingBonds()) as bigint[]) {
      const info = await bond.getBondInfo(id).catch(() => undefined);
      // Another collection's id (they share the vault and its id space), or none of this one's.
      if (!info || info.faceValue === 0n || info.isRedeemed) continue;
      const presentValue: bigint = await bond.presentValueOf(id);
      bonds.push({
        collection: c.address,
        collectionName: c.name,
        vault: vaultAddress,
        id: BigInt(id),
        creator: info.creator,
        creatorHolds: (await bond.balanceOf(info.creator, id)) > 0n,
        faceValue: info.faceValue,
        maturityDate: info.maturityDate,
        presentValue,
      });
      const v = vaults.get(key)!;
      v.presentValue += presentValue;
      v.faceValue += info.faceValue;
      v.count += 1;
    }
  }
  return { bonds, vaults };
}

/** Prints the report. */
export function printOutstanding(report: Awaited<ReturnType<typeof outstandingPre2fBonds>>, log: (m: string) => void = console.log) {
  const { ethers } = require("hardhat");
  const usd = (v: bigint) => ethers.formatUnits(v, 6);
  if (report.bonds.length === 0) log("No pre-2f bond is outstanding. The BondVault can be upgraded.");
  for (const b of report.bonds) {
    log(`${b.collectionName} ${b.collection} bond ${b.id}: face ${usd(b.faceValue)}, matures ${new Date(Number(b.maturityDate) * 1000).toISOString().slice(0, 10)}, ` +
      `worth ${usd(b.presentValue)} today; creator ${b.creator}${b.creatorHolds ? "" : " (no longer holds it: find the holder in TransferSingle logs)"}`);
  }
  for (const [vault, v] of report.vaults) {
    if (v.count === 0) continue;
    log(`vault ${vault}: ${v.count} outstanding, face ${usd(v.faceValue)}, worth ${usd(v.presentValue)} today; holds ${usd(v.held)}` +
      (v.held < v.presentValue ? ` (short ${usd(v.presentValue - v.held)}: unwind with TOP_UP=1)` : ""));
  }
}

async function unwindHolder(collection: { name: string; address: string }, holder: string, signer: any, ids: bigint[] | undefined, log: (m: string) => void) {
  const { ethers } = require("hardhat");
  const bond = new ethers.Contract(collection.address, PRE2F_BOND_ABI, signer);
  const vaultAddress: string = await bond.bondVault();
  const vault = new ethers.Contract(vaultAddress, PRE2F_VAULT_ABI, signer);
  if (await vault.agent().then(() => true, () => false)) {
    throw new Error(`BondVault ${vaultAddress} is already upgraded: a pre-2f collection can no longer settle through it.`);
  }
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC, signer);
  if ((await bond.owner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error(`The signer doesn't own ${collection.name}.`);

  const candidates: bigint[] = ids ?? (await bond.getBondIdsByCreator(holder)).map((x: bigint) => x);
  const open: bigint[] = [];
  let worth = 0n;
  for (const id of candidates) {
    const info = await bond.getBondInfo(id).catch(() => undefined);
    if (!info || info.faceValue === 0n || info.isRedeemed) continue;
    if ((await bond.balanceOf(holder, id)) === 0n) continue;
    const pv: bigint = await bond.presentValueOf(id);
    open.push(id);
    worth += pv;
    log(`${collection.name} bond ${id}: worth ${ethers.formatUnits(pv, 6)} today`);
  }
  if (open.length === 0) return;
  const held: bigint = await vault.held();
  log(`total ${ethers.formatUnits(worth, 6)}; vault holds ${ethers.formatUnits(held, 6)}`);
  if (worth + 10_000n > held) {
    // A cent of headroom: present value grows every block between this read and the redemption.
    const short = worth - held + 10_000n;
    if (process.env.TOP_UP !== "1") throw new Error(`Vault is ${ethers.formatUnits(short, 6)} short; rerun with TOP_UP=1 to send it from the signer.`);
    await (await usdc.transfer(vaultAddress, short)).wait();
    log(`topped the vault up by ${ethers.formatUnits(short, 6)} from the signer`);
  }

  const previous: string = await bond.liquidator();
  const before: bigint = await usdc.balanceOf(signer.address);
  await (await bond.setLiquidator(signer.address)).wait();
  try {
    for (const id of open) {
      await (await bond.seizeBond(id, holder, signer.address)).wait();
      await (await bond.redeemEarly(id)).wait();
      log(`  bond ${id} redeemed early`);
    }
  } finally {
    await (await bond.setLiquidator(previous)).wait();
    log(`liquidator back to ${previous}`);
  }
  const received: bigint = (await usdc.balanceOf(signer.address)) - before;
  await (await usdc.transfer(holder, received)).wait();
  log(`sent ${ethers.formatUnits(received, 6)} USDC to ${holder}`);
  for (const id of open) {
    const ob = await vault.obligations(id);
    if (!ob.settled || (await bond.balanceOf(holder, id)) !== 0n) throw new Error(`bond ${id} not closed`);
  }
  log(`${collection.name}: every bond of ${holder} closed, and settled in the vault`);
}

async function main() {
  const { ethers, network } = require("hardhat");
  const fork = network.name === "hardhat";
  const records = fork ? "base-sepolia" : network.name;
  requireMainnetConfirmation(network.name, "scripts/unwind_legacy_bonds.ts");
  if (fork) await network.provider.send("evm_mine", []);

  const collections = await pre2fCollections((name) => getDeployment(records, name)?.address);
  console.log(`Pre-2f collections on record (${records}): ${collections.map((c) => `${c.name} ${c.address}`).join(", ") || "none"}\n`);
  const mode = process.env.MODE ?? "report";
  if (mode === "report") {
    printOutstanding(await outstandingPre2fBonds(collections));
    console.log("\nReport only: nothing was sent.");
    return;
  }
  if (mode !== "unwind") throw new Error("MODE is report (the default) or unwind.");
  if (process.env.CONFIRM !== "unwind") throw new Error("Set CONFIRM=unwind: this seizes and redeems the holder's bonds at their request.");
  const holder: string = process.env.HOLDER ?? "";
  if (!ethers.isAddress(holder)) throw new Error("Set HOLDER.");

  let signer = (await ethers.getSigners())[0];
  if (fork) {
    const deployer = process.env.DEPLOYER ?? "0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA";
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [deployer] });
    await network.provider.request({ method: "hardhat_setBalance", params: [deployer, "0x56BC75E2D63100000"] });
    signer = await ethers.getSigner(deployer);
    console.log(`FORK: impersonating ${deployer}\n`);
  }
  const ids = process.env.IDS ? process.env.IDS.split(",").map((s: string) => BigInt(s.trim())) : undefined;
  for (const c of collections) await unwindHolder(c, holder, signer, ids, console.log);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e: unknown) => { console.error(e); process.exit(1); });
}
