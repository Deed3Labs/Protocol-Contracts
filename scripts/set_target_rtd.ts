import hre from "hardhat";
import { getDeployment } from "../deploy/helpers";

/*
 * Sets the AssuranceOracle's target RTD.
 *
 *   TARGET_RTD=0.8 npx hardhat run scripts/set_target_rtd.ts --network base-sepolia
 *
 * Reserve over POOL EXPOSURE, not over deposits: savings-backed credit is excluded entirely and
 * asset-backed counts only its shortfall after haircut. Raising it also sweeps excess back into
 * the primary reserve, which is the oracle's own behaviour rather than anything added here.
 */
async function main() {
  const { ethers } = hre;
  const network = (await ethers.provider.getNetwork()).name;
  const record = getDeployment(network, "AssuranceOracle");
  if (!record) throw new Error(`No AssuranceOracle recorded for ${network}.`);

  const target = ethers.parseEther(process.env.TARGET_RTD ?? "0.8");
  const oracle = await ethers.getContractAt("AssuranceOracle", record.address);

  console.log("before:", ethers.formatEther(await oracle.targetRTD()));
  await (await oracle.setTargetRTD(target)).wait();
  console.log("after :", ethers.formatEther(await oracle.targetRTD()));

  const pool = getDeployment(network, "AssurancePool");
  if (pool) {
    const assurancePool = await ethers.getContractAt("AssurancePool", pool.address);
    console.log("pool sees:", ethers.formatEther(await assurancePool.targetRTD()));
    console.log("hasValidRTD:", await assurancePool.hasValidRTD());
    console.log("neededReserves:", (await assurancePool.neededReserves()).toString());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
