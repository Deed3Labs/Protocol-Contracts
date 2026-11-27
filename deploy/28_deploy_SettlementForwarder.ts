import { getDeployment, requireMainnetConfirmation, saveDeployment } from "./helpers";

/**
 * Settlement Funding (decision 54): the SettlementForwarder, CL Operating's AllowanceModule delegate
 * that pushes USDC from CL Operating to the off-ramp, for the funding desk's wallet only.
 *
 * It deploys `SettlementForwarder(CL Operating, AllowanceModule, USDC)` and records it as
 * `deployments/<network>/SettlementForwarder.json`. That is all: the deployer sets nothing on it.
 * The off-ramp address and the desk wallet are set by CL Operating itself, in the same batch that
 * names the forwarder a delegate and gives it its allowance (signing plan stage SL,
 * `SL-cl-operating-*`), signed by CL Operating's owner, the Clear Lending Safe.
 *
 * Idempotent: a forwarder already recorded with the same Safe, module and token is reused; one with
 * different ones is refused (delete the record on purpose to replace it).
 *
 *   npx hardhat run deploy/28_deploy_SettlementForwarder.ts --network base-sepolia
 *
 * Inputs: CLEAR_LENDING_ACCOUNT (CL Operating), RESERVE_TOKEN (USDC) and, optionally,
 * PAYOUT_TOPUP_ALLOWANCE_MODULE (default the canonical AllowanceModule v0.1.1).
 */
export const CANONICAL_ALLOWANCE_MODULE = "0xAA46724893dedD72658219405185Fb0Fc91e091C";

export async function deploySettlementForwarder(o: { safe: string; allowanceModule: string; token: string; network?: string; log?: (m: string) => void }) {
  const { ethers } = require("hardhat");
  const log = o.log ?? console.log;
  for (const [what, a] of [["CL Operating (CLEAR_LENDING_ACCOUNT)", o.safe], ["the AllowanceModule", o.allowanceModule], ["USDC (RESERVE_TOKEN)", o.token]]) {
    if (!ethers.isAddress(a) || (await ethers.provider.getCode(a)) === "0x") throw new Error(`${what} ${a || "(empty)"} is not a contract on this network.`);
  }
  const module = new ethers.Contract(o.allowanceModule, ["function NAME() view returns (string)", "function VERSION() view returns (string)"], ethers.provider);
  const [name, version] = [await module.NAME().catch(() => ""), await module.VERSION().catch(() => "")];
  if (name !== "Allowance Module") throw new Error(`${o.allowanceModule} does not answer as Safe's AllowanceModule.`);
  log(`AllowanceModule  ${o.allowanceModule} (${name} ${version})`);

  const existing = o.network ? getDeployment(o.network, "SettlementForwarder") : null;
  if (existing) {
    const f = await ethers.getContractAt("SettlementForwarder", existing.address);
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (!same(await f.safe(), o.safe) || !same(await f.allowanceModule(), o.allowanceModule) || !same(await f.token(), o.token)) {
      throw new Error(`The recorded SettlementForwarder ${existing.address} names another Safe, module or token. Delete its record on purpose to deploy a new one.`);
    }
    log(`= SettlementForwarder already at ${existing.address}`);
    return f;
  }
  const forwarder = await (await ethers.getContractFactory("SettlementForwarder")).deploy(o.safe, o.allowanceModule, o.token);
  await forwarder.waitForDeployment();
  const address = await forwarder.getAddress();
  if (o.network) saveDeployment(o.network, "SettlementForwarder", address, JSON.parse(forwarder.interface.formatJson()));
  log(`+ SettlementForwarder deployed to ${address}`);
  return forwarder;
}

async function main() {
  const { ethers } = require("hardhat");
  const net = await ethers.provider.getNetwork();
  const network = net.name === "unknown" ? `chain-${net.chainId}` : net.name;
  requireMainnetConfirmation(network, "deploy/28_deploy_SettlementForwarder.ts");
  const safe = process.env.CLEAR_LENDING_ACCOUNT?.trim() ?? "";
  const token = process.env.RESERVE_TOKEN?.trim() ?? "";
  const allowanceModule = process.env.PAYOUT_TOPUP_ALLOWANCE_MODULE?.trim() || CANONICAL_ALLOWANCE_MODULE;
  console.log(`network          ${network} (${net.chainId})`);
  console.log(`CL Operating     ${safe}`);
  console.log(`USDC             ${token}`);
  const f = await deploySettlementForwarder({ safe, allowanceModule, token, network });
  console.log(`\nleft to do (nothing here is sent by this script):
  - CL Operating's batch, signing plan stage SL (npx hardhat run scripts/signing_plan.ts --network ${network}):
    addDelegate(${await f.getAddress()}), setAllowance(…, SETTLEMENT_CAP_USDC per SETTLEMENT_PERIOD_DAYS),
    setOffRamp(SETTLEMENT_OFFRAMP_ADDRESS), setDesk(SETTLEMENT_FUNDER)
  - the API: SETTLEMENT_FORWARDER_${net.chainId}=${await f.getAddress()}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
