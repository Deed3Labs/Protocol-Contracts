import { PrivyClient } from '@privy-io/node';
import type { Address, Hex } from 'viem';

/*
 * The shop's organization wallet, as something that can sign.
 *
 * Clear's backend is already a registered signer on every merchant org wallet, under a policy
 * ceiling (see `privySigner`). What was missing was the other half of that arrangement: the
 * private key that proves a wallet request came from Clear. The public half is registered at
 * onboarding, and this is where the private half is used -- for nothing except acting on a
 * merchant's own instruction to take money they are owed.
 *
 * PRIVY_AUTHORIZATION_PRIVATE_KEY is base64-encoded PKCS8 with no PEM headers, which is the shape
 * Privy's `authorization_private_keys` takes. Unset, everything here reports "not configured" and
 * nothing is attempted -- never a half-signed redemption.
 *
 * **Why an account rather than a transaction.** The org wallet holds no ETH and a shop should
 * never have to. So a redemption travels as a sponsored user operation: EIP-7702 delegates this
 * address to a Kernel account AT THE SAME ADDRESS and a paymaster pays the gas. The address the
 * registry knows, that holds the credits, that a claim is recorded against, and that the cash
 * account reads, stays exactly as it is -- which is the point, because those four things are the
 * same address by construction and moving to a new one would break all four.
 *
 * That is the same trick the member app plays for members (`create7702KernelAccount`), which is
 * why this has to sign a 7702 authorization as well as the operation itself.
 */

const APP_ID = process.env.PRIVY_APP_ID || '';
const APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTHORIZATION_PRIVATE_KEY = (process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '').trim();

let client: PrivyClient | null = null;

function privy(): PrivyClient | null {
  if (!APP_ID || !APP_SECRET) return null;
  if (!client) client = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

/** Whether Clear can sign for an org wallet at all. */
export function orgWalletSigningConfigured(): boolean {
  return privy() !== null && AUTHORIZATION_PRIVATE_KEY.length > 0;
}

/** Why it cannot, in the words a shop should be told. */
export function orgWalletSigningGap(): string | null {
  if (!privy()) return 'Privy is not configured on this server.';
  if (!AUTHORIZATION_PRIVATE_KEY) return "Clear's signing key is not configured on this server.";
  return null;
}

const auth = () => ({ authorization_private_keys: [AUTHORIZATION_PRIVATE_KEY] });

/**
 * A viem-shaped account backed by the org wallet.
 *
 * Hand-rolled rather than Privy's own viem adapter, which states it does not support EIP-7702 yet
 * -- and 7702 is the whole point here. The wallet API does support it, so this maps the three
 * things an account has to do onto the three calls that do them, and nothing else.
 */
export function orgWalletAccount(input: { walletId: string; address: string }) {
  const p = privy();
  if (!p || !AUTHORIZATION_PRIVATE_KEY) {
    throw new Error(orgWalletSigningGap() ?? 'Cannot sign for merchant wallets.');
  }
  const ethereum = p.wallets().ethereum();
  const walletId = input.walletId;
  const address = input.address as Address;

  return {
    address,
    type: 'local' as const,
    source: 'privy-org-wallet' as const,
    publicKey: address,

    async signMessage({ message }: { message: string | { raw: Hex | Uint8Array } }) {
      const raw =
        typeof message === 'string'
          ? message
          : typeof message.raw === 'string'
            ? message.raw
            : (`0x${Buffer.from(message.raw).toString('hex')}` as Hex);
      const { signature } = await ethereum.signMessage(walletId, {
        message: raw,
        authorization_context: auth(),
      });
      return signature as Hex;
    },

    async signTypedData(typedData: unknown) {
      const { signature } = await ethereum.signTypedData(walletId, {
        params: { typed_data: typedData as never },
        authorization_context: auth(),
      });
      return signature as Hex;
    },

    /**
     * The authorization that turns this EOA into a smart account at its own address.
     *
     * Asked for on every send rather than cached: whether an address is already delegated is a
     * fact about the chain, and the bundler is the one that knows it. Signing one that turns out
     * to be unnecessary costs nothing.
     */
    async signAuthorization(authorization: { address: Address; chainId: number; nonce: number }) {
      const { authorization: signed } = await ethereum.sign7702Authorization(walletId, {
        params: {
          contract: authorization.address,
          chain_id: authorization.chainId,
          nonce: authorization.nonce,
        },
        authorization_context: auth(),
      });
      return {
        address: authorization.address,
        chainId: authorization.chainId,
        nonce: authorization.nonce,
        r: signed.r as Hex,
        s: signed.s as Hex,
        yParity: signed.y_parity,
      };
    },
  };
}

export type OrgWalletAccount = ReturnType<typeof orgWalletAccount>;
