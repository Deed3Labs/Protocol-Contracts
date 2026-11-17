import { keccak256, toBytes } from 'viem';
import { signTypedData, switchChain } from '@wagmi/core';
import {
  PLAN_TERMS_TYPES,
  planDisclosureForTerms,
  planTermsMessage,
  planTermsMismatch,
  RESPLIT_TYPES,
  resplitDisclosure,
  resplitMessage,
  resplitMismatch,
  type PlanTerms,
  type PlanTermsTypedData,
  type ResplitTypedData,
} from '@clear/domain';
import { wagmiAdapter } from '@/AppKitProvider';
import { requireStepUp } from '@/lib/stepUp';

/*
 * The member signs the terms of a plan before it opens (audit H-4).
 *
 * `TermIssuer.openPlan` opens a plan only on an EIP-712 signature by the member over its terms. The
 * typed data is defined once, in @clear/domain's planTerms; this is the phone's half: show the
 * disclosure, check the terms against the screen, sign with the member's own wallet.
 *
 * The disclosure on the screen is rebuilt here from the signed fields, never taken as text from
 * the server, and its keccak-256 must equal the `disclosureHash` being signed. So the hash the
 * chain records is the hash of what this screen showed.
 *
 * The member's wallet signs: an EOA with ECDSA, a smart account through EIP-1271, which the
 * contract accepts (SignatureChecker). wagmi's signTypedData goes to whichever the session is.
 */

export const keccakUtf8 = (text: string): string => keccak256(toBytes(text));

/** The lines to show for these terms, from the terms themselves. */
export function disclosureFor(typedData: PlanTermsTypedData, merchantName: string): string[] {
  return planDisclosureForTerms(typedData.message, merchantName);
}

/** The terms without the nonce: what the server rebuilds and `openPlan` takes. */
export function termsOf(typedData: PlanTermsTypedData): PlanTerms {
  const { nonce: _nonce, ...terms } = typedData.message;
  return terms;
}

/**
 * Check the terms against what the screen showed, then sign them. Throws with a sentence when they
 * do not match, before any signature exists.
 */
export async function signPlanTerms(args: {
  typedData: PlanTermsTypedData;
  shown: { member: string; purchaseCents: number; installments: number; disclosure: string[] };
  expected: { chainId: number; termIssuer: string };
}): Promise<{ terms: PlanTerms; signature: string }> {
  const mismatch = planTermsMismatch({
    typedData: args.typedData,
    shown: args.shown,
    expected: args.expected,
    keccakUtf8,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (mismatch) throw new Error(`These terms are not the ones on your screen (${mismatch}). Nothing was signed.`);

  // Signing a plan is taking on credit: Face ID first, like any other spend.
  await requireStepUp();
  const config = wagmiAdapter.wagmiConfig;
  try {
    await switchChain(config, { chainId: args.expected.chainId });
  } catch {
    /* already on it, or the wallet declined: the domain binds the chain either way */
  }
  const signature = await signTypedData(config, {
    account: args.shown.member as `0x${string}`,
    domain: {
      ...args.typedData.domain,
      verifyingContract: args.typedData.domain.verifyingContract as `0x${string}`,
    },
    types: PLAN_TERMS_TYPES,
    primaryType: 'PlanTerms',
    message: {
      ...planTermsMessage(args.typedData.message),
      member: args.typedData.message.member as `0x${string}`,
      merchant: args.typedData.message.merchant as `0x${string}`,
      productId: args.typedData.message.productId as `0x${string}`,
      disclosureHash: args.typedData.message.disclosureHash as `0x${string}`,
    },
  });
  return { terms: termsOf(args.typedData), signature };
}

/**
 * A re-split that costs more (Phase 2, spec item 6): the lines to show, from the signed fields and
 * the remainder the server read from chain. The rate on screen is the one being signed.
 */
export function resplitDisclosureFor(typedData: ResplitTypedData, remaining: string, installmentLength: string): string[] {
  return resplitDisclosure({
    remaining: BigInt(remaining),
    rateBps: Number(typedData.message.rateBps),
    installments: Number(typedData.message.installments),
    installmentLengthSeconds: Number(installmentLength),
  });
}

/**
 * Check a `Resplit` against what the screen showed, then sign it with the member's own wallet. The
 * server submits it (`resplitWithSignature`). Throws with a sentence before any signature exists if
 * the plan, split or rate differ from the screen.
 */
export async function signResplit(args: {
  typedData: ResplitTypedData;
  member: string;
  shown: { planId: number; installments: number; rateBps: number };
  expected: { chainId: number; termIssuer: string };
}): Promise<string> {
  const mismatch = resplitMismatch({
    typedData: args.typedData,
    shown: args.shown,
    expected: args.expected,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (mismatch) throw new Error(`These terms are not the ones on your screen (${mismatch}). Nothing was signed.`);

  // New finance-charge terms: Face ID first, like signing a plan.
  await requireStepUp();
  const config = wagmiAdapter.wagmiConfig;
  try {
    await switchChain(config, { chainId: args.expected.chainId });
  } catch {
    /* already on it, or the wallet declined: the domain binds the chain either way */
  }
  return signTypedData(config, {
    account: args.member as `0x${string}`,
    domain: { ...args.typedData.domain, verifyingContract: args.typedData.domain.verifyingContract as `0x${string}` },
    types: RESPLIT_TYPES,
    primaryType: 'Resplit',
    message: resplitMessage(args.typedData.message),
  });
}
