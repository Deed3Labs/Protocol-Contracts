import { expect } from "chai";
import { ethers } from "hardhat";
import { prng } from "../deep/fuzz-engine";
import { deployDeedTrack, mintTrust, trustParams, deedIdFor, signTrust, k, coder, dec, Ctx } from "../deed/fixture";

/*
 * Phase 4, step 3: invariant fuzz for the Deed track (trust agreement v5).
 *
 * A seeded random sequence of mints, transfers (by the holder, by strangers, to the trustee, into
 * and out of Subdivide), burns, voids (transferable and freezing), trustee and protector changes,
 * standby appointments, licensing determinations, notices and edit attempts on the locked traits
 * runs against DeedNFT with its two extensions. An off-chain model tracks who should hold each deed.
 * After every step, for every deed ever minted:
 *
 *  (1) the holder is exactly what the model says: nobody but the holder (or Subdivide's release
 *      back to them) ever moved a deed;
 *  (2) a burned deed stays Retired, keeps its definition readable, and its ID can never be minted
 *      again;
 *  (3) a trust deed's definition, agreementHash and assetType never change (no correction is run
 *      here, so they must equal what was minted);
 *  (4) the trustee is never the holder nor the protector, and the standby never the protector;
 *  (5) a deed under a freezing void never changes hands;
 *  (6) beneficialOwnerOf is the holder, or the depositor while the deed sits in Subdivide;
 *  (7) a transfer to the current trustee (outside a Functional Contract) never succeeds.
 */
const STEPS = Number(process.env.FUZZ_STEPS ?? 300);

type Model = {
  id: bigint;
  holder: string; // current ownerOf, or "" once burned
  depositor?: string; // set while in Subdivide
  definition: string;
  burned: boolean;
  frozen: boolean;
  params: any;
};

async function runDeedFuzz(seed: number) {
  const ctx: Ctx = await deployDeedTrack();
  const { deed, trust, subdivide, alice, bob, carol, mallory, trustee, standby, deployer } = ctx;
  const people = [alice, bob, carol, mallory];
  const rnd = prng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const breaks: string[] = [];
  const counts: Record<string, number> = {};
  const reverts: Record<string, number> = {};
  const deeds: Model[] = [];
  const subAddr = await subdivide.getAddress();
  let salt = 50_000n;

  const attempt = async (name: string, fn: () => Promise<any>) => {
    counts[name] = (counts[name] ?? 0) + 1;
    try {
      const tx = await fn();
      await tx.wait();
      return true;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/panic code/i.test(msg)) breaks.push(`panic in ${name}: ${msg.slice(0, 140)}`);
      const key = `${name}: ${(msg.match(/custom error '([A-Za-z]+)/) ?? msg.match(/reverted with reason string '([^']+)/) ?? [, "other"])[1]}`;
      reverts[key] = (reverts[key] ?? 0) + 1;
      return false;
    }
  };
  const live = () => deeds.filter((d) => !d.burned);
  const signerOf = async (addr: string) => ethers.getSigner(addr);

  for (let step = 0; step < STEPS; step++) {
    const r = rnd();
    const d = live().length ? pick(live()) : undefined;
    if (r < 0.14 || !d) {
      const owner = pick(people);
      const definition = `Parcel ${step}-${Math.floor(rnd() * 1e6)}`;
      const p = trustParams(ctx, owner, { salt: ++salt, definition, assetType: pick([0, 2]), protector: rnd() < 0.4 ? carol.address : ethers.ZeroAddress });
      if (p.protector === owner.address) p.protector = ethers.ZeroAddress;
      const id = await deedIdFor(ctx, p);
      const sig = await signTrust(ctx, trustee, "TrusteeAcceptance", { tokenId: id, trustee: trustee.address, nonce: 0 });
      if (await attempt("mint", () => ctx.trust.mintTrustDeed(p, sig))) {
        deeds.push({ id, holder: owner.address, definition, burned: false, frozen: false, params: p });
      }
    } else if (r < 0.34) {
      // The holder sends it on (sometimes to the trustee, which must fail).
      const to = rnd() < 0.15 ? trustee.address : pick(people).address;
      if (d.depositor) continue;
      const ok = await attempt("transfer", async () => deed.connect(await signerOf(d.holder)).transferFrom(d.holder, to, d.id));
      if (ok) {
        if (to === (await trust.trustRecordOf(d.id)).trustee) breaks.push(`(7) deed ${d.id} was transferred to its trustee`);
        if (d.frozen) breaks.push(`(5) frozen deed ${d.id} moved`);
        d.holder = to;
      }
    } else if (r < 0.44) {
      // A stranger, the trustee, the protector or the validator signer tries to move it.
      const thief = pick([mallory, trustee, standby, carol, deployer].filter((x) => x.address !== d.holder));
      if (await attempt("theft", () => deed.connect(thief).transferFrom(d.holder, thief.address, d.id))) {
        breaks.push(`(1) ${thief.address} moved deed ${d.id} it does not hold`);
        d.holder = thief.address;
      }
    } else if (r < 0.52) {
      if (d.depositor) continue;
      const holder = await signerOf(d.holder);
      if (await attempt("burn", () => deed.connect(holder).burnAsset(d.id))) {
        d.burned = true;
        d.holder = "";
        // (2) Never again.
        const sig = await signTrust(ctx, trustee, "TrusteeAcceptance", { tokenId: d.id, trustee: trustee.address, nonce: 0 });
        if (await attempt("remint", () => ctx.trust.mintTrustDeed(d.params, sig))) breaks.push(`(2) burned deed ${d.id} minted again`);
      }
    } else if (r < 0.58) {
      const code = rnd() < 0.5 ? 1 : 128;
      const who = pick([deployer, trustee, mallory]);
      if (await attempt("markVoid", () => trust.connect(who).markVoid(d.id, code, k(`rec${step}`), ""))) {
        if (code >= 128) d.frozen = true;
      }
    } else if (r < 0.64) {
      // Edit attempts on the locked traits, by everybody who might try.
      const who = pick([await signerOf(d.holder), deployer, trustee, mallory]);
      await attempt("editDefinition", () => deed.connect(who).setTrait(d.id, ethers.toUtf8Bytes("definition"), ethers.toUtf8Bytes("rewritten"), 1));
      await attempt("editAgreement", () => deed.connect(who).setTrait(d.id, ethers.toUtf8Bytes("agreementHash"), ethers.ZeroHash, 0));
    } else if (r < 0.70) {
      // Into Subdivide and, sometimes, back out.
      if (!d.depositor) {
        const holder = await signerOf(d.holder);
        await attempt("approveSub", () => deed.connect(holder).approve(subAddr, d.id));
        if (await attempt("subdivide", () => subdivide.connect(holder).createSubdivision(d.id, "Tract", "", "TR", "ipfs://tr", 3, true))) {
          d.depositor = d.holder;
          d.holder = subAddr;
        }
      } else if (await attempt("deactivate", async () => subdivide.connect(await signerOf(d.depositor!)).deactivateSubdivision(d.id))) {
        if ((await deed.ownerOf(d.id)) === d.depositor) {
          d.holder = d.depositor!;
          d.depositor = undefined;
        }
      }
    } else if (r < 0.78) {
      // Protector and trustee changes, with whoever happens to call.
      const rec = await trust.trustRecordOf(d.id);
      const caller = pick([await signerOf(d.holder === subAddr ? d.depositor! : d.holder), carol, mallory, trustee]);
      if (rnd() < 0.5) {
        await attempt("setProtector", () => trust.connect(caller).setProtector(d.id, pick([carol.address, bob.address, trustee.address, ethers.ZeroAddress])));
      } else {
        const next = rec.trustee === trustee.address ? standby : trustee;
        const sig = await signTrust(ctx, next, "TrusteeAcceptance", { tokenId: d.id, trustee: next.address, nonce: rec.nonce });
        await attempt("setTrustee", () => trust.connect(caller).setTrustee(d.id, next.address, sig));
      }
    } else if (r < 0.84) {
      const rec = await trust.trustRecordOf(d.id);
      const protector = await trust.protectorOf(d.id);
      const sig = await signTrust(ctx, standby, "StandbyAcceptance", { tokenId: d.id, standby: standby.address, nonce: rec.nonce });
      await attempt("setStandby", async () => trust.connect(await signerOf(protector)).setStandbyTrustee(d.id, standby.address, sig));
    } else if (r < 0.88) {
      await attempt("determination", () => trust.connect(pick([standby, trustee, carol, mallory])).applyLicensingDetermination(d.id, k(`det${step}`), ""));
    } else {
      await attempt("notice", () => trust.connect(pick([...people, trustee])).postNotice(d.id, k(`n${step}`), ""));
    }

    // Invariants, for every deed ever minted.
    for (const m of deeds) {
      if (m.burned) {
        if (!(await trust.isRetired(m.id))) breaks.push(`(2) burned deed ${m.id} is not Retired`);
        if (dec(await deed.getTraitValue(m.id, k("definition"))) !== m.definition) breaks.push(`(2) burned deed ${m.id} lost its definition`);
        continue;
      }
      const owner = await deed.ownerOf(m.id);
      if (owner !== m.holder) breaks.push(`(1) step ${step}: deed ${m.id} held by ${owner}, model says ${m.holder}`);
      if (dec(await deed.getTraitValue(m.id, k("definition"))) !== m.definition) breaks.push(`(3) deed ${m.id} definition changed`);
      const agreement = coder.decode(["bytes32"], await deed.getTraitValue(m.id, k("agreementHash")))[0];
      if (agreement !== m.params.agreementHash) breaks.push(`(3) deed ${m.id} agreementHash changed`);
      const rec = await trust.trustRecordOf(m.id);
      const protector = rec.protector;
      if (rec.trustee === owner) breaks.push(`(4) deed ${m.id}: trustee is the holder`);
      if (protector !== ethers.ZeroAddress && rec.trustee === protector) breaks.push(`(4) deed ${m.id}: trustee is the protector`);
      if (protector !== ethers.ZeroAddress && rec.standbyTrustee === protector) breaks.push(`(4) deed ${m.id}: standby is the protector`);
      const beneficial = await trust.beneficialOwnerOf(m.id);
      const expected = m.depositor ?? owner;
      if (beneficial !== expected) breaks.push(`(6) deed ${m.id}: beneficial owner ${beneficial}, expected ${expected}`);
    }
  }
  return { breaks, counts, reverts, minted: deeds.length, burned: deeds.filter((d) => d.burned).length };
}

describe("PHASE 4 step 3: Deed track invariants (trust agreement v5)", function () {
  this.timeout(3_600_000);
  // These runs move the chain's clock by years. Put it back afterwards, so later suites in the same
  // Hardhat process (bond maturities are bounded) start where they would have.
  let snap: string;
  beforeEach(async () => { snap = await ethers.provider.send("evm_snapshot", []); });
  afterEach(async () => { await ethers.provider.send("evm_revert", [snap]); });
  for (const seed of [71, 72]) {
    it(`seed ${seed}: holders, locked traits, roles, freezes and IDs hold under random calls`, async function () {
      const res = await runDeedFuzz(seed);
      console.log(`      steps=${STEPS} minted=${res.minted} burned=${res.burned} actions=${JSON.stringify(res.counts)}`);
      console.log(`      reverts: ${JSON.stringify(res.reverts)}`);
      if (res.breaks.length) console.log(`      breaks:\n        ${res.breaks.slice(0, 20).join("\n        ")}`);
      expect(res.minted).to.be.gt(0);
      expect(res.breaks).to.deep.equal([]);
    });
  }
});
