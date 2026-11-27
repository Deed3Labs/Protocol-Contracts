import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { liveNetworkOf } from "../../deploy/helpers";
import { loadEarnRoles } from "../../deploy/earnWiring";
import { upgradeCall, upgradeCallLine } from "../../scripts/vaultUpgrade";
import { upgradeOptionsFor, verifiesOn } from "../../deploy/upgrade/upgradeOptions";
import { deployBondFactory, ensureBondTokenWhitelisted } from "../../deploy/bondModules";
import { deployCreditCore } from "../../deploy/20_deploy_CreditCore";
import { pointCarryAtPayoutPool } from "../../deploy/creditWiring";
import { PRE2D_FACTORY_RECORD, planSavingsFactory } from "../../deploy/19_deploy_SavingsIntentFactory";
import { parseEnvFile, standIn, standIns, rehearsalEnv } from "../../scripts/rehearse_sepolia_fork";
import { assertTwoPersonSafe } from "../../deploy/vault_timelock_handover";
import { checkRolloutInputs } from "../../scripts/check_rollout_inputs";

/*
 * The script bugs the Base Sepolia fork rehearsal found (docs/audit/SEPOLIA-REHEARSAL.md), each
 * reproduced on the in-process Hardhat network. Nothing here touches a live network or uses a key.
 */
const quiet = () => undefined;
const random = () => ethers.Wallet.createRandom().address;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    return String(e?.message);
  }
  return "";
}

describe("the Base Sepolia fork rehearsal's fixes", function () {
  describe("the rehearsal network", function () {
    it("stands for the network it forks in name-keyed lookups, and grants that network's Earn roles", function () {
      expect(liveNetworkOf("base-sepolia-fork")).to.equal("base-sepolia");
      expect(liveNetworkOf("base-sepolia")).to.equal("base-sepolia");
      expect(liveNetworkOf("hardhat")).to.equal("hardhat");
      // Deploy 27 refused the fork with "owner to fill: no entry for base-sepolia-fork".
      expect(loadEarnRoles("base-sepolia-fork")).to.deep.equal(loadEarnRoles("base-sepolia"));
    });

    it("reads the rollout inputs and makes a stand-in only from a label", function () {
      const env = parseEnvFile(fs.readFileSync(path.join("deploy", "config", "base-sepolia.rollout.env"), "utf8"));
      // The Clear Lending Safe split (Nov 16, 2026): its own Safe; CL Operating is its account, the ledger's operating
      // address and the Assurance draw address; the Clear Treasury Safe keeps every other Safe role.
      expect(env.CLEAR_LENDING_SAFE).to.equal("0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d");
      expect(env.CLEAR_LENDING_ACCOUNT).to.equal("0xfAFf1081F77bF528bA21eea590f251a755bCdf65");
      expect(env.LENDER_OPERATING).to.equal(env.CLEAR_LENDING_ACCOUNT);
      expect(env.ASSURANCE_DRAW_ADDRESS).to.equal(env.CLEAR_LENDING_ACCOUNT);
      expect(env.ASSURANCE_LOSS_RESERVE).to.equal("0xb42561F3FE68B6719628C0eAC398eA097DD56bAa");
      // Clear Lending's plan fees and card claims go to CL Operating (Nov 18, 2026; the signing plan's RT steps).
      expect(env.FEE_RECIPIENT).to.equal(env.CLEAR_LENDING_ACCOUNT);
      expect(env.CARD_SETTLEMENT_ACCOUNT).to.equal(env.CLEAR_LENDING_ACCOUNT);
      for (const k of ["CLEAR_FINANCIAL_SAFE", "OPS_SAFE", "COOP_TREASURY", "BOARD_SAFE", "CARRY_TREASURY", "COLLATERAL_ACCOUNT", "AGENT_COST_ADDRESS", "EXCESS_DESTINATION", "SAFE_ADDRESS"]) {
        expect(env[k], k).to.equal("0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50");
      }
      // The two CDP wallets the owner created on Nov 17, 2026 (cl-fees-base-sepolia, assurance-disbursement-base-sepolia).
      expect(env.ASSURANCE_CL_FEES_PAYER).to.equal("0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd");
      expect(env.ASSURANCE_DISBURSEMENT).to.equal("0x510cDFa8e647C3f1fe0c431fe903fA60aA4F926B");
      expect(env.FIRST_BOND_ID).to.equal("1000");
      expect(Object.keys(env).filter((k) => /PRIVATE_KEY|MNEMONIC|SECRET/.test(k))).to.deep.equal([]); // addresses only, never a key
      expect(standIn("Agent Key")).to.equal(standIn("Agent Key"));
      expect(standIn("Agent Key")).to.not.equal(standIn("vault pauser 1"));
    });
  });

  describe("the rehearsal's inputs with an owner-to-fill line in the rollout env", function () {
    it("keeps the stand-in where the rollout file is empty, and lets a real value or the environment win", function () {
      const stand = standIns();
      const env = rehearsalEnv({ ASSURANCE_CL_FEES_PAYER: "", ASSURANCE_DISBURSEMENT: "0x00000000000000000000000000000000000000d1", AGENT_KEY: "0x00000000000000000000000000000000000000a1" }, stand, { AGENT_KEY: "0x00000000000000000000000000000000000000a2" });
      // The bug: `{ ...standIns, ...rollout }` let an empty "owner to fill" line blank the stand-in.
      expect(env.ASSURANCE_CL_FEES_PAYER).to.equal(stand.ASSURANCE_CL_FEES_PAYER);
      expect(env.ASSURANCE_DISBURSEMENT).to.equal("0x00000000000000000000000000000000000000d1");
      expect(env.AGENT_KEY).to.equal("0x00000000000000000000000000000000000000a2");
      expect(env.DEPLOYER).to.equal("0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA");
    });
  });

  describe("the two-person Safe check", function () {
    it("names the Safe it refuses (the Clear Lending Safe for the Earn handover)", async function () {
      const [o1, o2] = await ethers.getSigners();
      const one = await (await ethers.getContractFactory("MockSafe")).deploy([o1.address, o2.address], 1);
      expect(await failure(assertTwoPersonSafe(await one.getAddress(), "The Clear Lending Safe"))).to.contain("The Clear Lending Safe must need two signers");
      expect(await failure(assertTwoPersonSafe(await one.getAddress()))).to.contain("The Clear Financial Safe must need two signers");
    });
  });

  describe("scripts/check_rollout_inputs.ts (the preflight)", function () {
    it("fails each empty input, a Safe of the wrong shape and a conflicting Assurance input; passes the right ones", async function () {
      const [aaa, k698a, a3, a4, other] = await ethers.getSigners();
      const F = await ethers.getContractFactory("MockSafe");
      const treasury = await F.deploy([aaa.address], 1);
      const lending = await F.deploy([aaa.address, k698a.address], 2);
      const operating = await F.deploy([await lending.getAddress()], 1);
      const reserve = await F.deploy([await lending.getAddress()], 1);
      const env: Record<string, string> = {
        CLEAR_FINANCIAL_SAFE: await treasury.getAddress(), BOARD_SAFE: await treasury.getAddress(), COOP_TREASURY: await treasury.getAddress(),
        CLEAR_LENDING_SAFE: await lending.getAddress(), CLEAR_LENDING_ACCOUNT: await operating.getAddress(), LENDER_OPERATING: await operating.getAddress(),
        ASSURANCE_DRAW_ADDRESS: await operating.getAddress(), ASSURANCE_LOSS_RESERVE: await reserve.getAddress(),
        ASSURANCE_CL_FEES_PAYER: random(), ASSURANCE_DISBURSEMENT: random(), ASSURANCE_SIGNERS: `${a3.address},${a4.address}`,
      };
      const fails = async (e: Record<string, string>) => (await checkRolloutInputs(e, ethers.provider)).filter((r) => r.status === "FAIL").map((r) => r.what);
      expect(await fails(env)).to.deep.equal([]);
      expect(await fails({ ...env, ASSURANCE_CL_FEES_PAYER: "" })).to.deep.equal(["ASSURANCE_CL_FEES_PAYER is empty: owner to fill in deploy/config/base-sepolia.rollout.env"]);
      expect((await fails({ ...env, CLEAR_LENDING_SAFE: env.CLEAR_FINANCIAL_SAFE })).join("\n")).to.contain("CLEAR_LENDING_SAFE is its own Safe");
      expect((await fails({ ...env, LENDER_OPERATING: other.address })).join("\n")).to.contain("LENDER_OPERATING is CL Operating");
      expect((await fails({ ...env, ASSURANCE_LOSS_RESERVE: await treasury.getAddress() })).join("\n")).to.contain("wanted 1 of 1, owned by the Clear Lending Safe");
      expect((await fails({ ...env, ASSURANCE_DISBURSEMENT: a3.address })).join("\n")).to.contain("one of the pool's signers");
      expect((await fails({ ...env, CLEAR_LENDING_SAFE: other.address })).join("\n")).to.contain("has no code");
    });
  });

  describe("scripts/upgrade_vault.ts with no USDC known", function () {
    it("prints the call in words instead of throwing after the implementation is deployed", async function () {
      const iface = (await ethers.getContractFactory("ESADepositVault")).interface;
      const [impl, proxy, usdc] = [random(), random(), random()];
      expect(() => upgradeCallLine(iface, proxy, impl)).to.not.throw();
      expect(upgradeCallLine(iface, proxy, impl)).to.contain("setAcceptedToken(<USDC>, true)");
      expect(upgradeCallLine(iface, proxy, impl, usdc)).to.contain(upgradeCall(iface, impl, usdc));
    });
  });

  describe("deploy/upgrade/upgradeContract.ts for ClearUSDUpgradeable", function () {
    it("validates and upgrades the token with the waivers it was deployed with; without them it is refused", async function () {
      const [admin] = await ethers.getSigners();
      const F = await ethers.getContractFactory("ClearUSDUpgradeable");
      const token = await upgrades.deployProxy(F, ["Clear USD", "CLRUSD", 6, 0, 0, admin.address, admin.address],
        { initializer: "initialize", kind: "uups", unsafeAllow: ["missing-initializer", "missing-initializer-call"] });
      const proxy = await token.getAddress();
      expect(await failure(upgrades.validateUpgrade(proxy, F))).to.contain("Missing initializer");
      await upgrades.validateUpgrade(proxy, F, upgradeOptionsFor("ClearUSDUpgradeable"));
      await (await upgrades.upgradeProxy(proxy, F, upgradeOptionsFor("ClearUSDUpgradeable"))).waitForDeployment();
      expect(upgradeOptionsFor("ClaimEscrow")).to.deep.equal({});
    });

    it("never tries to verify source on a rehearsal fork", function () {
      expect(verifiesOn("base-sepolia")).to.equal(true);
      expect(verifiesOn("base-sepolia-fork")).to.equal(false);
      expect(verifiesOn("hardhat")).to.equal(false);
    });
  });

  describe("deploy 23 on a TokenRegistry that never whitelisted the bond token", function () {
    it("whitelists it first, so createCollection goes through, and tells a non-owner what to send", async function () {
      const [owner, other] = await ethers.getSigners();
      const registry: any = await (await ethers.getContractFactory("TokenRegistry")).deploy();
      const usdc: any = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
      const token = await usdc.getAddress();
      const factory: any = await deployBondFactory(await registry.getAddress(), "ipfs://clear-bonds/");
      // What Base Sepolia does today: the Phase 2f factory refuses the token.
      await expect(factory.createCollection(token, "USDC", "USD Coin", "ipfs://clear-bonds/")).to.be.revertedWith("Token not whitelisted");

      expect(await failure(ensureBondTokenWhitelisted(await registry.getAddress(), token, other, quiet))).to.contain("registerToken");
      expect(await ensureBondTokenWhitelisted(await registry.getAddress(), token, owner, quiet)).to.equal(true);
      expect(await registry.getIsWhitelisted(token)).to.equal(true);
      expect(await ensureBondTokenWhitelisted(await registry.getAddress(), token, owner, quiet)).to.equal(false);
      await factory.createCollection(token, "USDC", "USD Coin", "ipfs://clear-bonds/");
      expect((await factory.getCollectionInfo(token)).collectionAddress).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("deploy 25 when one Safe is both the carry treasury and the fee recipient", function () {
    const dir = path.join("deployments", "hardhat");
    const saved = process.env.CARRY_TREASURY;
    after(function () {
      fs.rmSync(dir, { recursive: true, force: true });
      if (saved === undefined) delete process.env.CARRY_TREASURY; else process.env.CARRY_TREASURY = saved;
    });

    it("points carry at the fresh PayoutPool first, so the fee recipient can be proposed", async function () {
      const [admin] = await ethers.getSigners();
      const safe = random();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const record = (name: string, address: string) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ address, abi: [] }));
      const access = await upgrades.deployProxy(await ethers.getContractFactory("AccessManager"), [admin.address]);
      record("AccessManager", await access.getAddress());
      process.env.CARRY_TREASURY = safe;
      const core = await deployCreditCore({ quiet: true });
      const reason = ethers.encodeBytes32String("INITIAL");
      // Base Sepolia's inputs: the same Safe for carry and fee. TermIssuer refuses it.
      await expect(core.term.proposeFeeRecipient(safe, reason)).to.be.revertedWithCustomError(core.term, "TermIssuerFeeRecipientNotAllowed");

      const issuers = [{ name: "RevolvingIssuer", contract: core.revolving }, { name: "TermIssuer", contract: core.term }];
      // Only the retired PayoutPool on record: nothing moves.
      const retired = random();
      record("PayoutPoolPreAudit", retired);
      record("PayoutPool", retired);
      expect(await pointCarryAtPayoutPool("hardhat", issuers, admin, quiet)).to.deep.equal([]);
      expect(await core.term.carryTreasury()).to.equal(safe);

      const payout = await upgrades.deployProxy(await ethers.getContractFactory("PayoutPool"),
        [admin.address, await core.ledger.getAddress(), random(), random(), safe], { kind: "uups" });
      record("PayoutPool", await payout.getAddress());
      expect(await pointCarryAtPayoutPool("hardhat", issuers, admin, quiet)).to.deep.equal([]);
      expect(await core.term.carryTreasury()).to.equal(await payout.getAddress());
      expect(await core.revolving.carryTreasury()).to.equal(await payout.getAddress());
      await core.term.proposeFeeRecipient(safe, reason);
      expect((await core.term.feeRecipientProposalOf()).recipient).to.equal(safe);

      // A sender without CREDIT_SETTINGS_ROLE gets the call back as a proposal, and sends nothing.
      const [, outsider] = await ethers.getSigners();
      await core.term.setCarryTreasury(safe);
      const proposals = await pointCarryAtPayoutPool("hardhat", issuers, outsider, quiet);
      expect(proposals.map((p) => p.what)).to.deep.equal([`TermIssuer carry treasury -> PayoutPool ${await payout.getAddress()}`]);
      expect(await core.term.carryTreasury()).to.equal(safe);
    });
  });

  describe("deploy 19 over a recorded SavingsIntentFactory", function () {
    const network = "hardhat-rehearsal-19";
    const dir = path.join("deployments", network);
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("keeps a pre-2d factory's record before replacing it, and reuses a Phase 2d one", async function () {
      const [admin] = await ethers.getSigners();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const write = (name: string, address: string) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ address, abi: [] }));
      const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).address;

      expect(await planSavingsFactory(network, quiet)).to.equal("deploy"); // nothing recorded
      const old = random(); // no isIntentEscrow: from before Phase 2d
      write("SavingsIntentFactory", old);
      expect(await planSavingsFactory(network, quiet)).to.equal("deploy");
      expect(read(PRE2D_FACTORY_RECORD)).to.equal(old);
      write("SavingsIntentFactory", random());
      await planSavingsFactory(network, quiet);
      expect(read(PRE2D_FACTORY_RECORD)).to.equal(old); // kept once, never overwritten

      const current: any = await (await ethers.getContractFactory("SavingsIntentFactory")).deploy(admin.address);
      write("SavingsIntentFactory", await current.getAddress());
      expect(await planSavingsFactory(network, quiet)).to.equal("reuse");
    });
  });
});

describe("earn-controls.json network overrides (deploy 26)", () => {
  const cfg = require("../../deploy/config/earn-controls.json");
  const merged = (n: string) => ({ ...cfg, ...(cfg.networks?.[liveNetworkOf(n)] ?? {}) });

  it("gives Base Sepolia (and its fork) a $100,000 Funding Limit and pool capacity with a resolution hash", () => {
    for (const n of ["base-sepolia", "base-sepolia-fork"]) {
      const s = merged(n);
      expect(s.fundingLimitDollars).to.equal(100000);
      expect(s.poolCapacityDollars).to.equal(100000);
      expect(s.fundingResolution).to.match(/^0x[0-9a-f]{64}$/).and.not.equal(ethers.ZeroHash);
    }
  });

  it("leaves Base mainnet on the Boards' placeholders (0, refusing every subscription)", () => {
    const s = merged("base");
    expect(cfg.networks?.base).to.equal(undefined);
    expect(s.fundingLimitDollars).to.equal(0);
    expect(s.poolCapacityDollars).to.equal(0);
  });
});
