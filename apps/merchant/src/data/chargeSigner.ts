import type { TypedDataDomain, TypedDataField } from 'ethers';

/**
 * Signing a charge — and the open question underneath it.
 *
 * `POST /api/charges` authenticates by EIP-712: the merchant signs the charge, the server recovers
 * the address and checks it against `MerchantRegistry` on chain for active status, the per-charge
 * cap and the discount. The payout is then computed from the registry rather than from the
 * request, so a merchant cannot name its own cut.
 *
 * **Where a shared counter tablet gets that key is not decided, and this file does not decide it.**
 * The three plausible answers are meaningfully different products:
 *
 *  1. A key in the tablet's storage. Simplest, and the worst: a tablet in a public-facing stand
 *     holds a credential that can raise charges in the shop's name until it is rotated.
 *  2. A key held by the owner, with the tablet asking them to sign. Safest, and it destroys the
 *     flow — the whole design is two taps with no owner at the counter.
 *  3. A session-scoped delegate the registry recognises, issued when a shop is set up and
 *     revocable per device. More work on chain, and almost certainly the right answer.
 *
 * Until that is settled, `signCharge` throws rather than pretending. A merchant device that cannot
 * sign is a device that cannot raise a charge, and the app says so plainly — which is the correct
 * behaviour for an unprovisioned tablet in any of the three designs.
 *
 * The nonce and timestamp are built here because they are part of what gets signed: without them a
 * captured signature is a reusable licence to charge the same member the same amount forever. The
 * server refuses anything older than five minutes.
 */

export interface ChargePayload {
  merchant: string;
  member: string;
  amountCents: number;
  nonce: string;
  issuedAt: number;
}

/** Mirrors `chargeTypedData` in the API. Both must agree or every signature is rejected. */
export function chargeTypedData(
  chainId: number,
  registryAddress: string,
  message: ChargePayload,
): { domain: TypedDataDomain; types: Record<string, TypedDataField[]>; message: ChargePayload } {
  return {
    domain: {
      name: 'Clear Charge',
      version: '1',
      chainId,
      verifyingContract: registryAddress,
    },
    types: {
      Charge: [
        { name: 'merchant', type: 'address' },
        { name: 'member', type: 'address' },
        { name: 'amountCents', type: 'uint256' },
        { name: 'nonce', type: 'string' },
        { name: 'issuedAt', type: 'uint256' },
      ],
    },
    message,
  };
}

export function newChargePayload(input: {
  merchant: string;
  member: string;
  amountCents: number;
}): ChargePayload {
  return {
    ...input,
    nonce: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

export class NotProvisionedError extends Error {
  constructor() {
    super('This tablet is not set up to raise charges yet. Take the ticket the usual way.');
  }
}

/**
 * The seam.
 *
 * Replace this with whichever of the three designs above is chosen. Everything either side of it —
 * the payload, the typed data, the request, the server's recovery and registry check — is already
 * built and does not change when it is.
 */
export type ChargeSigner = (payload: ChargePayload) => Promise<string>;

let signer: ChargeSigner | null = null;

export function setChargeSigner(next: ChargeSigner | null): void {
  signer = next;
}

export function chargeSigningAvailable(): boolean {
  return signer !== null;
}

export async function signCharge(payload: ChargePayload): Promise<string> {
  if (!signer) throw new NotProvisionedError();
  return signer(payload);
}
