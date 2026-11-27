/**
 * Deed-track admin handover (audit D-13).
 *
 * Moves every admin, upgrade and settings power over the Deed contracts from the deployer EOA to
 * `admin`, then has the deployer renounce everything, so no single EOA is left holding them.
 *
 * `admin` should be the Deed TimelockController (OpenZeppelin's, unmodified) whose proposer is the
 * Foundation multisig (Safe), with the 7-day minimum delay (trust agreement v5 item 6; DECISIONS #8, #10).
 * Set `requireTimelockDelay` (deploy_all does on every live network) and the handover refuses an admin
 * that is not a timelock with at least that delay. Operational keys are separate and optional: `minter`
 * gets DeedNFT MINTER_ROLE and `validatorSigner` gets the default Validator's VALIDATOR_ROLE (deed edits
 * and validations for deeds that name that validator). Both default to `admin`.
 *
 * The Functional Contract registry (v5, DECISIONS #8): additions (REGISTRAR_ROLE) and role admin go to the
 * timelock; `remover` (the Foundation Safe) gets REMOVER_ROLE for immediate removals.
 *
 * This module only builds transactions from the signer it is given. It never reads a key.
 */
import { Contract } from "ethers";

export interface DeedContracts {
  validatorRegistry: any;
  metadataRenderer: any;
  validator: any;
  deedNFT: any;
  fundManager: any;
  subdivide: any;
  fractionalize?: any;
  fractionTokenFactory?: any;
  functionalContractRegistry?: any;
}

export interface HandoverOptions {
  admin: string;
  minter?: string;
  validatorSigner?: string;
  /** The Foundation Safe: may remove Functional Contracts at once (DECISIONS #8). */
  remover?: string;
  /** When set, `admin` must be a TimelockController whose minimum delay is at least this many seconds. */
  requireTimelockDelay?: number;
  log?: (msg: string) => void;
}

const ethersZeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function send(txp: Promise<any>) {
  const tx = await txp;
  await tx.wait();
}

/** Grant `roles` to `to`, then renounce them from the deployer, DEFAULT_ADMIN_ROLE last. */
async function moveRoles(c: any, roles: string[], to: string, deployer: string) {
  for (const r of roles) {
    if (!(await c.hasRole(r, to))) await send(c.grantRole(r, to));
  }
  const ordered = [...roles].sort((a, b) => (a === ethersZeroHash ? 1 : 0) - (b === ethersZeroHash ? 1 : 0));
  for (const r of ordered) {
    if (await c.hasRole(r, deployer)) await send(c.renounceRole(r, deployer));
  }
}

export async function handOverDeedAdmin(c: DeedContracts, deployerSigner: any, opts: HandoverOptions) {
  const log = opts.log ?? (() => {});
  const admin = opts.admin;
  const minter = opts.minter ?? admin;
  const signer = opts.validatorSigner ?? admin;
  const me = await deployerSigner.getAddress();
  const ADMIN = ethersZeroHash;

  if (opts.requireTimelockDelay !== undefined) {
    let delay = -1n;
    try {
      const tl = new Contract(admin, ["function getMinDelay() view returns (uint256)"], deployerSigner);
      delay = await tl.getMinDelay();
    } catch {}
    if (delay < BigInt(opts.requireTimelockDelay)) {
      throw new Error(`Deed admin ${admin} is not a TimelockController with a minimum delay of at least ${opts.requireTimelockDelay}s`);
    }
  }

  // DeedNFT: admin (upgrade, pause, settings) and the minter
  const MINTER = await c.deedNFT.MINTER_ROLE();
  if (!(await c.deedNFT.hasRole(MINTER, minter))) await send(c.deedNFT.grantRole(MINTER, minter));
  if (minter !== me && (await c.deedNFT.hasRole(MINTER, me))) await send(c.deedNFT.renounceRole(MINTER, me));
  await moveRoles(c.deedNFT, [ADMIN], admin, me);
  log("DeedNFT handed over");

  // ValidatorRegistry: Ownable (register/activate/upgrade) + roles
  await moveRoles(c.validatorRegistry, [await c.validatorRegistry.REGISTRY_ADMIN_ROLE(), ADMIN], admin, me);
  if ((await c.validatorRegistry.owner()) === me) await send(c.validatorRegistry.transferOwnership(admin));
  log("ValidatorRegistry handed over");

  // MetadataRenderer: Ownable (display settings, upgrade) + DEFAULT_ADMIN (gallery, setDeedNFT)
  await moveRoles(c.metadataRenderer, [ADMIN], admin, me);
  if ((await c.metadataRenderer.owner()) === me) await send(c.metadataRenderer.transferOwnership(admin));
  log("MetadataRenderer handed over");

  // Validator: royalty receiver first (needs FEE_MANAGER), then roles and ownership
  if ((await c.validator.royaltyReceiver()) === me) await send(c.validator.setRoyaltyReceiver(admin));
  const VAL = await c.validator.VALIDATOR_ROLE();
  if (!(await c.validator.hasRole(VAL, signer))) await send(c.validator.grantRole(VAL, signer));
  await moveRoles(
    c.validator,
    [VAL, await c.validator.METADATA_ROLE(), await c.validator.CRITERIA_MANAGER_ROLE(), await c.validator.FEE_MANAGER_ROLE(), ADMIN],
    admin,
    me
  );
  if ((await c.validator.owner()) === me) await send(c.validator.transferOwnership(admin));
  log("Validator handed over");

  // FundManager: fee receiver, then roles
  if ((await c.fundManager.feeReceiver()) === me) await send(c.fundManager.setFeeReceiver(admin));
  await moveRoles(
    c.fundManager,
    [await c.fundManager.ADMIN_ROLE(), await c.fundManager.MINTER_ROLE(), await c.fundManager.FEE_MANAGER_ROLE(), ADMIN],
    admin,
    me
  );
  log("FundManager handed over");

  // Subdivide and Fractionalize: upgrade + pause + settings
  await moveRoles(c.subdivide, [await c.subdivide.ADMIN_ROLE(), ADMIN], admin, me);
  log("Subdivide handed over");
  if (c.fractionalize) {
    await moveRoles(c.fractionalize, [await c.fractionalize.ADMIN_ROLE(), ADMIN], admin, me);
    log("Fractionalize handed over");
  }
  if (c.functionalContractRegistry) {
    const fc = c.functionalContractRegistry;
    const REMOVER = await fc.REMOVER_ROLE();
    if (opts.remover && !(await fc.hasRole(REMOVER, opts.remover))) await send(fc.grantRole(REMOVER, opts.remover));
    await moveRoles(fc, [await fc.REGISTRAR_ROLE(), REMOVER, ADMIN], admin, me);
    log("FunctionalContractRegistry handed over");
  }
  if (c.fractionTokenFactory && (await c.fractionTokenFactory.owner()) === me) {
    await send(c.fractionTokenFactory.transferOwnership(admin));
    log("FractionTokenFactory handed over");
  }

  await assertNoDeployerPowers(c, me);
}

/** Throws if `account` still holds any admin, upgrade, settings or operational role on a Deed contract. */
export async function assertNoDeployerPowers(c: DeedContracts, account: string) {
  const left: string[] = [];
  const checkRoles = async (name: string, ct: any, roleGetters: string[]) => {
    for (const g of roleGetters) {
      const role = g === "DEFAULT_ADMIN_ROLE" ? ethersZeroHash : await ct[g]();
      if (await ct.hasRole(role, account)) left.push(`${name}.${g}`);
    }
  };
  const checkOwner = async (name: string, ct: any) => {
    if ((await ct.owner()) === account) left.push(`${name}.owner`);
  };
  await checkRoles("DeedNFT", c.deedNFT, ["DEFAULT_ADMIN_ROLE", "MINTER_ROLE", "VALIDATOR_ROLE"]);
  await checkRoles("ValidatorRegistry", c.validatorRegistry, ["DEFAULT_ADMIN_ROLE", "REGISTRY_ADMIN_ROLE"]);
  await checkOwner("ValidatorRegistry", c.validatorRegistry);
  await checkRoles("MetadataRenderer", c.metadataRenderer, ["DEFAULT_ADMIN_ROLE"]);
  await checkOwner("MetadataRenderer", c.metadataRenderer);
  await checkRoles("Validator", c.validator, ["DEFAULT_ADMIN_ROLE", "VALIDATOR_ROLE", "METADATA_ROLE", "CRITERIA_MANAGER_ROLE", "FEE_MANAGER_ROLE"]);
  await checkOwner("Validator", c.validator);
  await checkRoles("FundManager", c.fundManager, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "MINTER_ROLE", "FEE_MANAGER_ROLE"]);
  await checkRoles("Subdivide", c.subdivide, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]);
  if (c.fractionalize) await checkRoles("Fractionalize", c.fractionalize, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]);
  if (c.fractionTokenFactory) await checkOwner("FractionTokenFactory", c.fractionTokenFactory);
  if (c.functionalContractRegistry) {
    await checkRoles("FunctionalContractRegistry", c.functionalContractRegistry, ["DEFAULT_ADMIN_ROLE", "REGISTRAR_ROLE", "REMOVER_ROLE"]);
  }
  if (left.length > 0) throw new Error(`Deployer still holds Deed-track powers: ${left.join(", ")}`);
}
