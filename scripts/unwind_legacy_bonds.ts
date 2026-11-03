import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Closes out a holder's bonds in the LEGACY collection (replaced 2026-11-03) and sends them what
 * the bonds are worth today, so the money can buy bonds in the new collection instead. Done at
 * the holder's request: it uses the collection owner's power to take a bond, which no holder
 * should find used on them otherwise.
 *
 * The old collection has no early redemption for a holder, only for its liquidator. So: the owner
 * names itself liquidator, takes each bond (`seizeBond`), redeems it early at present value
 * (`redeemEarly`, paid by BondVault), sends everything it received to the holder, and puts the
 * liquidator back. A bond's present value is what was paid plus the discount earned so far; if the
 * vault holds less than that and has no backstop to draw on, TOP_UP=1 has the signer send the
 * difference to the vault first.
 *
 *   HOLDER=0x… npx hardhat run scripts/unwind_legacy_bonds.ts --network base-sepolia
 *   FORK_RPC_URL=https://sepolia.base.org HOLDER=0x… TOP_UP=1 npx hardhat run scripts/unwind_legacy_bonds.ts
 *
 * IDS=1,2 limits it to those bonds. On a fork the deployer is impersonated and nothing is real.
 */
const { ethers, network } = hre as any;

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  const fork = network.name === "hardhat";
  const records = fork ? "base-sepolia" : network.name;
  const holder: string = process.env.HOLDER ?? "";
  if (!ethers.isAddress(holder)) throw new Error("Set HOLDER.");

  let signer = (await ethers.getSigners())[0];
  if (fork) {
    await network.provider.send("evm_mine", []);
    const deployer = process.env.DEPLOYER ?? "0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA";
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [deployer] });
    await network.provider.request({ method: "hardhat_setBalance", params: [deployer, "0x56BC75E2D63100000"] });
    signer = await ethers.getSigner(deployer);
    console.log(`FORK: impersonating ${deployer}\n`);
  }

  const legacy = getDeployment(records, "BurnerBondLegacy");
  const vaultRec = getDeployment(records, "BondVault");
  if (!legacy || !vaultRec) throw new Error("No BurnerBondLegacy or BondVault on record.");
  const bond = await ethers.getContractAt("BurnerBond", legacy.address, signer);
  const vault = await ethers.getContractAt("BondVault", vaultRec.address, signer);
  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC, signer);
  if ((await bond.owner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error("The signer doesn't own the legacy collection.");

  const ids: bigint[] = process.env.IDS
    ? process.env.IDS.split(",").map((s: string) => BigInt(s.trim()))
    : (await bond.getBondIdsByCreator(holder)).map((x: bigint) => x);
  const open: bigint[] = [];
  let worth = 0n;
  for (const id of ids) {
    if ((await bond.balanceOf(holder, id)) === 0n) continue;
    if ((await bond.getBondInfo(id)).isRedeemed) continue;
    const pv: bigint = await bond.presentValueOf(id);
    open.push(id);
    worth += pv;
    console.log(`bond ${id}: worth ${ethers.formatUnits(pv, 6)} today`);
  }
  if (open.length === 0) {
    console.log("Nothing to unwind.");
    return;
  }
  const held: bigint = await vault.held();
  console.log(`total ${ethers.formatUnits(worth, 6)}; vault holds ${ethers.formatUnits(held, 6)}`);
  if (worth + 10_000n > held) {
    // A cent of headroom: present value grows every block between this read and the redemption.
    const short = worth - held + 10_000n;
    if (process.env.TOP_UP !== "1") throw new Error(`Vault is ${ethers.formatUnits(short, 6)} short; rerun with TOP_UP=1 to send it from the signer.`);
    await (await usdc.transfer(vaultRec.address, short)).wait();
    console.log(`topped the vault up by ${ethers.formatUnits(short, 6)} from the signer`);
  }

  const previous: string = await bond.liquidator();
  const before: bigint = await usdc.balanceOf(signer.address);
  await (await bond.setLiquidator(signer.address)).wait();
  try {
    for (const id of open) {
      await (await bond.seizeBond(id, holder, signer.address)).wait();
      await (await bond.redeemEarly(id)).wait();
      console.log(`  bond ${id} redeemed early`);
    }
  } finally {
    await (await bond.setLiquidator(previous)).wait();
    console.log(`liquidator back to ${previous}`);
  }
  const received: bigint = (await usdc.balanceOf(signer.address)) - before;
  await (await usdc.transfer(holder, received)).wait();
  console.log(`sent ${ethers.formatUnits(received, 6)} USDC to ${holder}`);

  for (const id of open) {
    const ob = await vault.obligations(id);
    if (!ob.settled || (await bond.balanceOf(holder, id)) !== 0n) throw new Error(`bond ${id} not closed`);
  }
  console.log("every bond closed, and settled in the vault");
}

main().then(() => process.exit(0)).catch((e: unknown) => { console.error(e); process.exit(1); });
