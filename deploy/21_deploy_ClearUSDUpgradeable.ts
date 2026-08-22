import { saveDeployment, getDeployment } from "./helpers";

/**
 * The replacement CLRUSD: upgradeable, and carrying the redemption lock.
 *
 * The deployed `ClearUSD` is a plain constructor deployment behind no proxy, so giving it the
 * encumbrance check that makes savings-backed credit enforceable means replacing the token rather
 * than changing it. That is the whole of this script's reason to exist.
 *
 * It deploys and configures the token only. Pointing the vault at it is a separate step, and
 * deliberately: `ESADepositVault.setClrusd` refuses while any of the old token is outstanding, so
 * the order is redeem, then re-point, enforced rather than remembered.
 *
 *   npx hardhat run deploy/21_deploy_ClearUSDUpgradeable.ts --network base-sepolia
 */
async function main() {
  const hre = require("hardhat");
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  const existing = getDeployment(network, "ClearUSDUpgradeable");
  if (existing) {
    console.log(`= ClearUSDUpgradeable already at ${existing.address}`);
    return;
  }

  const admin = process.env.CLRUSD_ADMIN ?? deployer.address;
  // Matching the token being replaced: 6 decimals, and its own max supply.
  const old = getDeployment(network, "ClearUSD");
  const maxSupply = process.env.CLRUSD_MAX_SUPPLY
    ? BigInt(process.env.CLRUSD_MAX_SUPPLY)
    : old
      ? await (await ethers.getContractAt("ClearUSD", old.address)).maxSupply()
      : 0n;

  console.log(`Deploying ClearUSDUpgradeable to ${network}`);
  console.log(`  admin      : ${admin}`);
  console.log(`  maxSupply  : ${maxSupply.toString()}`);
  console.log(`  preMint    : 0 (supply arrives through the vault, one-for-one against USDC)`);

  const ClearUSDUpgradeable = await ethers.getContractFactory("ClearUSDUpgradeable");
  const token = await upgrades.deployProxy(
    ClearUSDUpgradeable,
    ["Clear USD", "CLRUSD", 6, maxSupply, 0, admin, admin],
    {
      initializer: "initialize",
      kind: "uups",
      // Both waivers are about Chainlink's base contract, not this one.
      //
      // `missing-initializer`: the initializer is inherited from BurnMintERC20UUPS rather than
      // declared here, and the validator only looks at the subclass. Redeclaring it is not an
      // option -- the parent's is `public initializer`, so calling it from another `initializer`
      // would revert on the nested guard.
      //
      // `missing-initializer-call`: the base inherits AccessControlDefaultAdminRulesUpgradeable
      // but calls plain `__AccessControl_init()` and then `_grantRole(DEFAULT_ADMIN_ROLE, ...)`
      // directly. That is deliberate on their side and it does grant the role; what it skips is
      // the two-step admin-transfer delay that contract would otherwise enforce, so
      // `defaultAdminDelay()` is zero and an admin handover takes effect immediately. Worth
      // knowing before the co-op multisig becomes that admin.
      unsafeAllow: ["missing-initializer", "missing-initializer-call"],
    }
  );
  await token.waitForDeployment();
  const address = await token.getAddress();

  saveDeployment(network, "ClearUSDUpgradeable", address, JSON.parse(token.interface.formatJson()));
  console.log(`+ ClearUSDUpgradeable deployed to ${address}`);

  // The vault mints on deposit and burns on redemption, so it needs both roles. Granted here
  // rather than at the swap, because a token nobody can mint is a token the vault cannot back.
  const vault = getDeployment(network, "ESADepositVault");
  if (vault) {
    const minter = await token.MINTER_ROLE();
    const burner = await token.BURNER_ROLE();
    if (!(await token.hasRole(minter, vault.address))) {
      await (await token.grantMintAndBurnRoles(vault.address)).wait();
      console.log(`  mint+burn granted to ESADepositVault (${vault.address})`);
    }
    console.log(`  vault is minter: ${await token.hasRole(minter, vault.address)}`);
    console.log(`  vault is burner: ${await token.hasRole(burner, vault.address)}`);
  }

  console.log("\nNext: the old token must reach zero supply before ESADepositVault.setClrusd will");
  console.log("accept this one. Redeem first — the guard makes that the only available order.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
