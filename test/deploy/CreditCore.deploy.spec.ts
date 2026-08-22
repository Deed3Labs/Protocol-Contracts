import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployCreditCore } from "../../deploy/20_deploy_CreditCore";

/**
 * The deploy script, run.
 *
 * A deployment script nobody has executed is a plan rather than a script, and the wiring is the
 * part most worth proving: a role never granted or an issuer never registered produces a system
 * that deploys perfectly and then refuses the first draw. That failure appears on a real network,
 * in front of somebody, and costs a redeploy to find.
 *
 * This runs the same exported function `npx hardhat run` calls, against a fresh chain.
 */
describe("credit core deployment", function () {
  const dir = path.join("./deployments", "hardhat");
  let core: Awaited<ReturnType<typeof deployCreditCore>>;
  let admin: any;

  before(async function () {
    // The script reads and writes deployments/<network>/, so give it an empty one and take it
    // away afterwards rather than leaving a hardhat network's records in the repo.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    [admin] = await ethers.getSigners();

    const AccessManager = await ethers.getContractFactory("AccessManager");
    const access = await upgrades.deployProxy(AccessManager, [admin.address]);
    await access.waitForDeployment();
    fs.writeFileSync(
      path.join(dir, "AccessManager.json"),
      JSON.stringify(
        {
          address: await access.getAddress(),
          abi: JSON.parse(access.interface.formatJson()),
          blockNumber: 0,
        },
        null,
        2
      )
    );

    core = await deployCreditCore({ quiet: true });
  });

  after(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("puts every contract behind a proxy that can still be upgraded", async function () {
    // Not decoration: the ledger holds one signed balance per member and nothing recreates those,
    // so a contract deployed without an upgrade path can only ever be replaced account by account.
    for (const contract of [
      core.ledger,
      core.networkRegistry,
      core.revolving,
      core.term,
      core.collateral,
      core.limits,
    ]) {
      const address = await contract.getAddress();
      const implementation = await upgrades.erc1967.getImplementationAddress(address);
      expect(implementation).to.not.equal(ethers.ZeroAddress);
      expect(implementation).to.not.equal(address);
    }
  });

  it("gives the ledger and both issuers the operator access they act with", async function () {
    const access = await ethers.getContractAt(
      "AccessManager",
      JSON.parse(fs.readFileSync(path.join(dir, "AccessManager.json"), "utf8")).address
    );
    for (const contract of [core.ledger, core.revolving, core.term, core.limits]) {
      expect(await access.isOperator(await contract.getAddress())).to.equal(true);
    }
  });

  it("points the ledger at the registry that lets it hold more than one issuer", async function () {
    expect(await core.ledger.networkRegistry()).to.equal(await core.networkRegistry.getAddress());
  });

  it("lets the calculator act on the collateral registry", async function () {
    const role = await core.collateral.OPERATOR_ROLE();
    expect(await core.collateral.hasRole(role, await core.limits.getAddress())).to.equal(true);
  });

  it("points the revolving issuer at collateral, and only that one", async function () {
    expect(await core.revolving.exposureSource()).to.equal(await core.collateral.getAddress());
    // TermIssuer has no exposure source at all, and should not grow one here: term plans sit
    // under an income-based limit and pledge nothing, so there is no collateral to read.
    expect((core.term as Record<string, unknown>).exposureSource).to.equal(undefined);
  });

  it("leaves the issuers unregistered while there is no AssurancePool", async function () {
    // Deliberate: registering an issuer against a pool that does not exist is what the inherited
    // AssurancePool script did with a zero address, and it defers the failure to the first draw.
    expect(await core.networkRegistry.isIssuer(await core.revolving.getAddress())).to.equal(false);
  });

  it("configures the tiers, ascending, so nobody draws Boost before their own savings", async function () {
      // A deployed issuer with no tiers is a credit line with no ceiling in it -- capacityOf has
      // nothing to return and no member can draw a cent. The first deployment to Base Sepolia
      // came up exactly that way, which is why this is asserted rather than assumed.
      const count = Number(await core.revolving.tierCount());
      expect(count).to.equal(4);

      const rates: bigint[] = [];
      for (let id = 0; id < count; id++) {
        const [kind, rate, active] = await core.revolving.tierAt(id);
        expect(active).to.equal(true);
        expect(ethers.decodeBytes32String(kind).length).to.be.greaterThan(0);
        rates.push(rate);
      }

      // The ascending-rate invariant. Cheapest-first draw order falls out of the ordering rather
      // than being enforced anywhere, so a tier out of place silently reprices every draw.
      for (let i = 1; i < rates.length; i++) {
        expect(rates[i]).to.be.greaterThan(rates[i - 1]);
      }
      expect(rates[0]).to.equal(0n);
    });

    it("registers the collateral kinds those tiers draw against", async function () {
      for (const kind of ["SAVINGS", "ASSET_INTERNAL", "INCOME", "BOOST"]) {
        const type = await core.collateral.collateralTypes(ethers.encodeBytes32String(kind));
        expect(type.registered, `${kind} should be registered`).to.equal(true);
      }
      // Savings seize at par and burn the debt, so they take no haircut at all.
      const savings = await core.collateral.collateralTypes(ethers.encodeBytes32String("SAVINGS"));
      expect(savings.haircutBps).to.equal(10_000n);
    });

  it("runs again over its own output without deploying anything twice", async function () {
    const before = await core.ledger.getAddress();
    const second = await deployCreditCore({ quiet: true });
    expect(await second.ledger.getAddress()).to.equal(before);
    expect(await second.revolving.getAddress()).to.equal(await core.revolving.getAddress());
  });
});
