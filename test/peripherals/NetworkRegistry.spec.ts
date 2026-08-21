import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("NetworkRegistry", function () {
  let registry: any;
  let admin: any, operator: any, outsider: any, member: any, other: any;
  let revolving: any, term: any, partner: any;
  let stableCredit: string, assurancePool: string, oracle: string;

  beforeEach(async function () {
    [admin, operator, outsider, member, other, revolving, term, partner] =
      await ethers.getSigners();

    const NetworkRegistry = await ethers.getContractFactory("NetworkRegistry");
    registry = await upgrades.deployProxy(NetworkRegistry, [admin.address], { kind: "uups" });
    await registry.grantRole(await registry.OPERATOR_ROLE(), operator.address);

    // The issuers are EOAs here so they can call in as themselves.
    stableCredit = ethers.Wallet.createRandom().address;
    assurancePool = ethers.Wallet.createRandom().address;
    oracle = ethers.Wallet.createRandom().address;
  });

  async function register(issuer: any, credit: string = stableCredit) {
    await registry
      .connect(operator)
      .registerIssuer(issuer.address, credit, assurancePool, oracle);
  }

  describe("issuer registration", function () {
    it("resolves an issuer to its network", async function () {
      await register(revolving);

      const network = await registry.networkOf(revolving.address);
      expect(network.stableCredit).to.equal(stableCredit);
      expect(network.assurancePool).to.equal(assurancePool);
      expect(network.assuranceOracle).to.equal(oracle);
      expect(await registry.isIssuer(revolving.address)).to.equal(true);
    });

    it("answers whether an issuer belongs to a given ledger", async function () {
      // The check StableCredit makes before accepting a caller as an issuer.
      await register(revolving);
      const otherCredit = ethers.Wallet.createRandom().address;

      expect(await registry.isIssuerOf(revolving.address, stableCredit)).to.equal(true);
      expect(await registry.isIssuerOf(revolving.address, otherCredit)).to.equal(false);
      expect(await registry.isIssuerOf(outsider.address, stableCredit)).to.equal(false);
    });

    it("reverts resolving an unknown issuer rather than returning an empty network", async function () {
      await expect(registry.networkOf(outsider.address))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryUnknownIssuer");
    });

    it("rejects a duplicate registration", async function () {
      await register(revolving);
      await expect(register(revolving))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryIssuerAlreadyRegistered");
    });

    it("rejects a zero address anywhere in the wiring", async function () {
      const z = ethers.ZeroAddress;
      for (const args of [
        [z, stableCredit, assurancePool, oracle],
        [revolving.address, z, assurancePool, oracle],
        [revolving.address, stableCredit, z, oracle],
        [revolving.address, stableCredit, assurancePool, z],
      ]) {
        await expect(registry.connect(operator).registerIssuer(...(args as [string, string, string, string])))
          .to.be.revertedWithCustomError(registry, "NetworkRegistryInvalidAddress");
      }
    });

    it("is operator gated", async function () {
      await expect(
        registry.connect(outsider).registerIssuer(revolving.address, stableCredit, assurancePool, oracle)
      ).to.be.reverted;
    });
  });

  describe("a member holds a set of issuers", function () {
    // The revolving line and term plans are separate rule sets against one ledger, so a member
    // has more than one issuer from day one. Nothing may assume otherwise.

    it("enrols a member with several issuers at once", async function () {
      await register(revolving);
      await register(term);

      await registry.connect(revolving).enrolMember(member.address, revolving.address);
      await registry.connect(term).enrolMember(member.address, term.address);

      const issuers = await registry.issuersOf(member.address);
      expect(issuers).to.have.lengthOf(2);
      expect(issuers).to.include(revolving.address);
      expect(issuers).to.include(term.address);
      expect(await registry.issuerCountOf(member.address)).to.equal(2);
    });

    it("lets an issuer enrol its own members without a second transaction", async function () {
      await register(revolving);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);
      expect(await registry.isEnrolled(member.address, revolving.address)).to.equal(true);
    });

    it("lets an operator enrol on an issuer's behalf", async function () {
      await register(revolving);
      await registry.connect(operator).enrolMember(member.address, revolving.address);
      expect(await registry.isEnrolled(member.address, revolving.address)).to.equal(true);
    });

    it("refuses enrolment by anyone else", async function () {
      await register(revolving);
      await expect(registry.connect(outsider).enrolMember(member.address, revolving.address))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryUnauthorized");
      await expect(registry.connect(term).enrolMember(member.address, revolving.address))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryUnauthorized");
    });

    it("refuses enrolment with an unregistered issuer", async function () {
      await expect(registry.connect(operator).enrolMember(member.address, partner.address))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryUnknownIssuer");
    });

    it("is idempotent, so a repeated enrolment does not duplicate the entry", async function () {
      await register(revolving);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);

      expect(await registry.issuerCountOf(member.address)).to.equal(1);
    });

    it("removes an issuer without disturbing the others", async function () {
      await register(revolving);
      await register(term);
      await register(partner);
      for (const issuer of [revolving, term, partner]) {
        await registry.connect(issuer).enrolMember(member.address, issuer.address);
      }

      await registry.connect(term).withdrawMember(member.address, term.address);

      const issuers = await registry.issuersOf(member.address);
      expect(issuers).to.have.lengthOf(2);
      expect(issuers).to.include(revolving.address);
      expect(issuers).to.include(partner.address);
      expect(issuers).to.not.include(term.address);
      expect(await registry.isEnrolled(member.address, term.address)).to.equal(false);
    });

    it("keeps members separate", async function () {
      await register(revolving);
      await register(term);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);
      await registry.connect(term).enrolMember(other.address, term.address);

      expect(await registry.issuersOf(member.address)).to.deep.equal([revolving.address]);
      expect(await registry.issuersOf(other.address)).to.deep.equal([term.address]);
    });
  });

  describe("deregistration", function () {
    it("refuses while a member is still enrolled", async function () {
      // Deregistering underneath a live position would strand it: the ledger would stop
      // recognising the issuer that owns it, and nothing could adjust or close it.
      await register(revolving);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);

      await expect(registry.connect(operator).deregisterIssuer(revolving.address))
        .to.be.revertedWithCustomError(registry, "NetworkRegistryMemberStillEnrolled");
    });

    it("succeeds once the last member has left", async function () {
      await register(revolving);
      await registry.connect(revolving).enrolMember(member.address, revolving.address);
      await registry.connect(revolving).enrolMember(other.address, revolving.address);
      expect(await registry.enrolledCountOf(revolving.address)).to.equal(2);

      await registry.connect(revolving).withdrawMember(member.address, revolving.address);
      await registry.connect(revolving).withdrawMember(other.address, revolving.address);

      await registry.connect(operator).deregisterIssuer(revolving.address);
      expect(await registry.isIssuer(revolving.address)).to.equal(false);
      expect(await registry.isIssuerOf(revolving.address, stableCredit)).to.equal(false);
    });

    it("lets a deregistered issuer be registered again", async function () {
      await register(revolving);
      await registry.connect(operator).deregisterIssuer(revolving.address);
      await register(revolving);
      expect(await registry.isIssuer(revolving.address)).to.equal(true);
    });
  });
});
