import { ethers, upgrades } from "hardhat";
import { deployBondFactory, bondAt } from "../../deploy/bondModules";
import { deployEarnControls, attestation, grant } from "./earnControls";

export { deployBondFactory, deployBondPledges, deployBondImplementation, bondAt, BOND_LEGEND } from "../../deploy/bondModules";

export const DAY = 24 * 3600;
export const U = (n: number | bigint) => BigInt(n) * 10n ** 6n;
export const ROLL_NOTICE_ROLE = ethers.id("ROLL_NOTICE_ROLE");
export const WIND_DOWN_ROLE = ethers.id("WIND_DOWN_ROLE");

export async function now() {
  return BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
}

export interface BondStackOptions {
  /** `[termDays, yieldBps]` rungs listed and offered (default one year at 10.25%). */
  rungs?: [number, number][];
  membership?: string;
  fundingLimit?: bigint;
  offeringCap?: bigint;
  /** the controls to use instead of deploying new ones (admin must be able to grant on them) */
  controls?: any;
  /** the pledge registry and kind, if bonds are to be pledgeable */
  registry?: any;
  kind?: string;
}

/**
 * Phase 2f: a bond collection from the factory, its BondVault, and real EarnControls with a Ladder,
 * an attester, BOND_ROLE for the collection, and the vault as reserve status and hook. No Collateral
 * Agent unless a test names one (`vault.setEarnSources`, `bond.setSources`).
 */
export async function deployBondStack(admin: any, usdc: any, tokenRegistry: any, opts: BondStackOptions = {}) {
  const controls = opts.controls ?? await deployEarnControls(admin, {
    membership: opts.membership,
    fundingLimit: opts.fundingLimit ?? U(1_000_000_000),
    offeringCap: opts.offeringCap ?? U(1_000_000_000),
  });
  const attester = ethers.Wallet.createRandom();
  await grant(controls, admin, "ATTESTER_ROLE", attester.address);

  const factory: any = await deployBondFactory(await tokenRegistry.getAddress(), "ipfs://bonds");
  await factory.createCollection(await usdc.getAddress(), "USDC", "USD Coin", "ipfs://bonds");
  const bond = await bondAt((await factory.getCollectionInfo(await usdc.getAddress())).collectionAddress, admin);
  const vault: any = await upgrades.deployProxy(await ethers.getContractFactory("BondVault"),
    [admin.address, await usdc.getAddress(), 0], { kind: "uups" });
  await vault.grantRole(await vault.BOND_ROLE(), await bond.getAddress());
  await vault.setEarnSources(ethers.ZeroAddress, await controls.getAddress());
  await bond.setSources(await vault.getAddress(), opts.registry ? await opts.registry.getAddress() : ethers.ZeroAddress,
    opts.kind ?? ethers.ZeroHash, await controls.getAddress(), ethers.ZeroAddress);
  if (opts.registry) await opts.registry.grantRole(await opts.registry.ITEM_ROLLER_ROLE(), await bond.getAddress());

  await grant(controls, admin, "BOND_ROLE", await bond.getAddress());
  await controls.setSources(opts.membership ?? (await controls.membership()), await controls.yieldPool(),
    await vault.getAddress(), await controls.collateralAgent(), await vault.getAddress());
  await controls.setBondBooks([await vault.getAddress()]);
  for (const [term, y] of opts.rungs ?? [[365, 1_025]]) await controls.setRung(term, y, true);

  const net = await ethers.provider.getNetwork();
  const domain = { name: "BurnerBond", version: "2", chainId: net.chainId, verifyingContract: await bond.getAddress() };
  const QUOTE = {
    Quote: [
      { name: "payer", type: "address" }, { name: "holder", type: "address" },
      { name: "maturityAmount", type: "uint256" }, { name: "termDays", type: "uint32" },
      { name: "yieldBps", type: "uint32" }, { name: "quotedAt", type: "uint64" }, { name: "nonce", type: "uint256" },
    ],
  };
  const CONFIRM = {
    ConfirmRoll: [
      { name: "bondId", type: "uint256" }, { name: "noticeHash", type: "bytes32" },
      { name: "rollDeadline", type: "uint64" }, { name: "nonce", type: "uint32" },
    ],
  };
  const BUYBACK = {
    Buyback: [{ name: "bondId", type: "uint256" }, { name: "price", type: "uint256" }, { name: "deadline", type: "uint256" }],
  };
  let nonce = 0n;
  const attested = new Set<string>();

  /** A quote signed by `payer` (a signer), for `holder` (default the payer). */
  async function quote(payer: any, maturityAmount: bigint, termDays = 365, o: { holder?: string; quotedAt?: bigint; yieldBps?: number } = {}) {
    const yieldBps = o.yieldBps ?? Number((await controls.ladderYieldBps(termDays)));
    const q = {
      payer: payer.address, holder: o.holder ?? payer.address, maturityAmount, termDays, yieldBps,
      quotedAt: o.quotedAt ?? (await now()), nonce: ++nonce,
    };
    return { q, sig: await payer.signTypedData(domain, QUOTE, q) };
  }

  /**
   * Buys a bond of Maturity Amount `m` for `payer`, funding and approving the price; returns its id.
   * A purchase that leaves the vault in Reserve Shortfall (a bond within 90 days counts at 100%) is
   * cured at once by paying the gap into the vault, as Clear Lending must (IV-01 §7.2), unless
   * `cover` is false.
   */
  async function buy(payer: any, m: bigint, termDays = 365, o: { holder?: string; caller?: any; cover?: boolean } = {}) {
    const { q, sig } = await quote(payer, m, termDays, o);
    const price = await bond.quotePrice(m, termDays, q.yieldBps);
    await usdc.mint(payer.address, price);
    await usdc.connect(payer).approve(await bond.getAddress(), price);
    const att = attested.has(payer.address) ? "0x" : await attestation(controls, attester, payer.address);
    const cure = async () => {
      if (o.cover !== false && (await vault.inReserveShortfall())) {
        await usdc.mint(await vault.getAddress(), (await vault.requiredReserve()) - (await vault.held()));
        await vault.pokeReserve();
      }
    };
    await cure();
    const tx = await bond.connect(o.caller ?? payer).purchase(q, sig, att);
    const rc = await tx.wait();
    attested.add(payer.address);
    await cure();
    const ev = rc.logs.map((l: any) => { try { return bond.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "BondMinted");
    return { id: ev.args.bondId as bigint, price, tx };
  }

  /** The Holder's (a signer's) Roll Confirmation signature on bond `id` as its notice stands. */
  async function confirmSig(holder: any, id: bigint) {
    const n = await bond.rollNotice(id);
    return holder.signTypedData(domain, CONFIRM, { bondId: id, noticeHash: n.noticeHash, rollDeadline: n.deadline, nonce: n.nonce });
  }

  /** Records a fresh eligibility attestation for `who` (a roll needs one in force: decision 44). */
  async function attest(who: any, exemption = "506C") {
    return controls.attestEligibility(who.address, await attestation(controls, attester, who.address, exemption));
  }

  async function buybackSig(holder: any, id: bigint, price: bigint, deadline: bigint) {
    return holder.signTypedData(domain, BUYBACK, { bondId: id, price, deadline });
  }

  return { controls, attester, factory, bond, vault, usdc, domain, quote, buy, attest, confirmSig, buybackSig };
}

/** Grants the roll-notice role to `who` on the controls. */
export async function grantNoticeRole(controls: any, admin: any, ...who: string[]) {
  for (const w of who) await controls.connect(admin).grantRoleByResolution(ROLL_NOTICE_ROLE, w, ethers.id("resolution"));
}
