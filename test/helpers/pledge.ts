import { ethers } from "hardhat";

/**
 * Pledges through CollateralRegistry the way production must since Phase 4b (re-review L-I): the
 * member signs the pledge (EIP-712, at their current nonce) and the operator submits it.
 *
 * `member` is a signer or the address of one of the Hardhat accounts. `registry` is connected to
 * whoever submits (the operator in every test that does not say otherwise).
 */
const PLEDGE_TYPES = {
  Pledge: [
    { name: "member", type: "address" },
    { name: "kind", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const PLEDGE_ITEM_TYPES = {
  PledgeItem: [
    { name: "member", type: "address" },
    { name: "kind", type: "bytes32" },
    { name: "itemId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function signerOf(member: any) {
  return typeof member === "string" ? ethers.getSigner(member) : member;
}

async function domainOf(registry: any) {
  return {
    name: "Clear CollateralRegistry",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await registry.getAddress(),
  };
}

async function deadlineAhead(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp) + 3600n;
}

/** The member's signature over a pledge of `amount` of `kind`, and the deadline it carries. */
export async function signPledge(registry: any, member: any, kind: string, amount: bigint, deadline?: bigint) {
  const signer = await signerOf(member);
  const memberAddress = await signer.getAddress();
  const nonce = await registry.pledgeNonces(memberAddress);
  const until = deadline ?? (await deadlineAhead());
  const signature = await signer.signTypedData(await domainOf(registry), PLEDGE_TYPES, {
    member: memberAddress,
    kind,
    amount,
    nonce,
    deadline: until,
  });
  return { member: memberAddress, deadline: until, signature };
}

/** The member's signature over a pledge of item `itemId` of `kind`. */
export async function signPledgeItem(registry: any, member: any, kind: string, itemId: bigint, deadline?: bigint) {
  const signer = await signerOf(member);
  const memberAddress = await signer.getAddress();
  const nonce = await registry.pledgeNonces(memberAddress);
  const until = deadline ?? (await deadlineAhead());
  const signature = await signer.signTypedData(await domainOf(registry), PLEDGE_ITEM_TYPES, {
    member: memberAddress,
    kind,
    itemId,
    nonce,
    deadline: until,
  });
  return { member: memberAddress, deadline: until, signature };
}

/** Pledges `amount` of `kind` for `member`, signed by the member and submitted through `registry`. */
export async function pledgeSigned(registry: any, member: any, kind: string, amount: bigint) {
  const s = await signPledge(registry, member, kind, amount);
  return registry.pledge(s.member, kind, amount, s.deadline, s.signature);
}

/** Pledges item `itemId` of `kind` for `member`, signed by the member and submitted through `registry`. */
export async function pledgeItemSigned(registry: any, member: any, kind: string, itemId: bigint) {
  const s = await signPledgeItem(registry, member, kind, itemId);
  return registry.pledgeItem(s.member, kind, itemId, s.deadline, s.signature);
}
