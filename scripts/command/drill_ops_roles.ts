/**
 * Rehearses taking every role off the deployer, against a FORK of Base Sepolia: the operational
 * roles to the wallets that do each job (ops-roles.ts), then the admin roles and ownership to the
 * Safe (safe-handover.ts), in that order. Nothing touches the real chain.
 *
 *   FORK_RPC_URL=https://sepolia.base.org npx hardhat run scripts/command/drill_ops_roles.ts
 *
 * Each job gets a throwaway address and the Safe is a stand-in address the drill acts as. It checks
 * that afterwards the deployer holds none of the mapped roles and no admin role, isn't an operator
 * on AccessManager any more, and that each job's wallet can still do its job.
 */
import { ethers, network } from "hardhat";
import { Contract, Wallet, getAddress } from "ethers";
import { deployments, execute, plan, survey } from "./handover";
import { CHECKS, ROLE_MAP, checkContracts, envName, executeMoves, fixChecks, surveyMoves } from "./ops-roles";

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
};

async function main() {
  if (!process.env.FORK_RPC_URL || network.name !== "hardhat")
    throw new Error("This drill only runs on a fork. Set FORK_RPC_URL and leave the network as `hardhat`.");
  // a fork's latest block IS the forked one; mine one so reads run on the fork's own
  await network.provider.request({ method: "evm_mine", params: [] });

  const list = deployments();
  const byName = Object.fromEntries(list.map((d) => [d.name, d]));
  const deployer = getAddress(process.env.DEPLOYER?.trim() || (await new Contract(byName.TokenRegistry.address, byName.TokenRegistry.abi, ethers.provider).owner()));
  const impersonate = async (a: string) => {
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [a] });
    await network.provider.request({ method: "hardhat_setBalance", params: [a, "0x56BC75E2D63100000"] });
    return ethers.getSigner(a);
  };
  const dep = await impersonate(deployer);

  // a throwaway wallet per job, and a stand-in Safe the drill can act as
  const jobs = [...new Set(ROLE_MAP.map((r) => r.to).filter((t) => t !== "safe" && t !== "renounce"))];
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const wallets: Record<string, string> = {};
  for (const j of jobs) env[envName(j)] = wallets[j] = Wallet.createRandom().address;
  const safe = (env.SAFE_ADDRESS = Wallet.createRandom().address);
  console.log(`Deployer ${deployer}\nJobs     ${jobs.map((j) => `${j} ${wallets[j].slice(0, 8)}…`).join(", ")}\n`);

  // 1. the operational roles, and the contract roles the checks found missing
  await fixChecks(dep, list, () => undefined);
  check((await checkContracts(ethers.provider, list)).every((k) => k.ok), `every contract holds the roles it needs (${CHECKS.length} checked, LendingPool's LIQUIDATOR_ROLE granted to the Liquidator)`);
  const moves = await surveyMoves(ethers.provider, list, deployer, env);
  await executeMoves(dep, list, moves, () => undefined);
  const after = await surveyMoves(ethers.provider, list, deployer, env);
  check(after.every((m) => !m.deployerHolds), `the deployer holds none of the ${ROLE_MAP.length} mapped operational roles`);
  check(after.filter((m) => m.wallet).every((m) => m.walletHolds), "each job's wallet (and the Safe) holds what it was given");

  // 2. the admin roles and ownership to the Safe
  const s = await survey(ethers.provider, list, deployer, safe);
  await execute(dep, list, plan(s, deployer, safe).steps, safe, () => undefined);
  const sf = await impersonate(safe);
  await network.provider.request({ method: "evm_increaseTime", params: [Math.max(0, ...s.map((c) => c.adminRules?.delaySeconds ?? 0)) + 1] });
  await network.provider.request({ method: "evm_mine", params: [] });
  for (const c of await survey(ethers.provider, list, deployer, safe)) {
    if (c.adminRules?.pending === safe) await (await new Contract(c.address, byName[c.name].abi, sf).acceptDefaultAdminTransfer()).wait();
    if (c.twoStep && c.owner === deployer) await (await new Contract(c.address, byName[c.name].abi, sf).acceptOwnership()).wait();
  }
  const end = await survey(ethers.provider, list, deployer, safe);
  const left = end.flatMap((c) => [...c.roles.filter((r) => r.deployer).map((r) => `${c.name}.${r.role}`), ...(c.owner === deployer ? [`${c.name}.owner`] : [])]);
  check(left.length === 0, `the deployer holds no role and owns nothing${left.length ? ": still " + left.join(", ") : ""}`);

  // 3. each job still works, and the deployer can't
  const am = new Contract(byName.AccessManager.address, byName.AccessManager.abi, ethers.provider);
  check(!(await am.isOperator(deployer)) && (await am.isOperator(wallets["credit-operator"])), "AccessManager: the credit operator is an operator, the deployer isn't");
  const reg = new Contract(byName.MembershipRegistry.address, byName.MembershipRegistry.abi, ethers.provider);
  check(await reg.hasRole(await reg.REGISTRAR_ROLE(), wallets["membership-registrar"]), "MembershipRegistry: the registrar can register members");
  const mr = new Contract(byName.MerchantRegistry.address, byName.MerchantRegistry.abi, sf);
  const w = Number(await mr.defaultPayoutWindow()) + 60;
  await (await mr.setDefaultPayoutWindow(w)).wait();
  check(Number(await mr.defaultPayoutWindow()) === w, "MerchantRegistry: the Safe sets shop terms");
  let refused = false;
  try {
    await (await mr.connect(dep).setDefaultPayoutWindow(w + 60)).wait();
  } catch {
    refused = true;
  }
  check(refused, "MerchantRegistry: the deployer can't any more");
  console.log("\nDrill passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
