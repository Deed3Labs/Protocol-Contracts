/**
 * The OpenZeppelin upgrade options a proxy needs beyond the plugin's defaults, by contract name, for
 * `deploy/upgrade/checkUpgrade.ts` and `deploy/upgrade/upgradeContract.ts`.
 *
 * ClearUSDUpgradeable takes the two waivers it was deployed with (deploy/21_deploy_ClearUSDUpgradeable.ts),
 * both about Chainlink's `BurnMintERC20UUPS` base rather than this contract: its initializer is
 * inherited, and it grants DEFAULT_ADMIN_ROLE directly instead of calling
 * `AccessControlDefaultAdminRules`' initializer. Without them `validateUpgrade` refuses every upgrade
 * of the live token ("Missing initializer"), which the Base Sepolia fork rehearsal found. An upgrade
 * runs no initializer, so the waivers change nothing about what is checked in the layout.
 */
export function upgradeOptionsFor(contractName: string): Record<string, unknown> {
  if (contractName === "ClearUSDUpgradeable") {
    return { kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] };
  }
  return {};
}

/** Source verification is skipped where there is no explorer: the in-process network, a local node, a rehearsal fork. */
export function verifiesOn(network: string): boolean {
  return network !== "hardhat" && network !== "localhost" && network !== "unknown" && !network.endsWith("-fork");
}
