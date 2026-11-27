import { useState } from 'react';
import { Button, PrimaryButton } from '@/shell/ui';
import { api } from '@/data/apiClient';

/**
 * Letting Clear settle this shop's payouts, once, with the owner's own key.
 *
 * **Why there is a passkey in a payouts screen.** The shop's wallet is non-custodial: it belongs
 * to the owner's key quorum, so adding a signer to it takes the owner's authorization and nothing
 * else will do. Three other routes were refused by Privy — the server alone, the server holding
 * the owner's token, and this browser calling `addSigners` on a wallet that is the shop's rather
 * than the person's. What remains is the owner signing one specific request, and the key that
 * signs it is unlocked by a passkey.
 *
 * A passkey is scoped to a site. The owner may well have one for the member app and none here,
 * which looks from inside the browser like having none at all — so this offers to make one rather
 * than reporting that something is missing.
 *
 * **Two presses, and both are gestures.** A browser will not mint a credential on the back of an
 * emailed code submitted a moment ago; it wants a click. So this is buttons rather than an effect,
 * and it lives inside Privy's provider for the same reason.
 *
 * Shops created after this exists never see it: their wallet is made with Clear already named on
 * it. This is the path for the one shop that predates that.
 */
export function GrantSignerPanel({
  signRequest,
  linkPasskey,
  onGranted,
}: {
  signRequest: (payload: never) => Promise<{ signature: string }>;
  linkPasskey: (options?: { name?: string }) => Promise<void>;
  onGranted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the authorization failed for want of a credential on this site, not for want of rights. */
  const [needsPasskey, setNeedsPasskey] = useState(false);

  /** Prepare, sign, send. The server composes the request; the owner authorizes that exact one. */
  async function grant() {
    const prepared = await api.prepareSigner();
    const { signature } = await signRequest(prepared.authorization as never);
    await api.confirmSigner({ signature, requestExpiry: prepared.requestExpiry });
    onGranted();
  }

  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      await grant();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'That could not be allowed just now.';
      // "No credential", "not allowed", a cancelled WebAuthn prompt — all the same situation from
      // the owner's side: this device has nothing to sign with yet. Offering the fix beats naming
      // the error, which would be true and useless.
      if (/passkey|credential|not allowed|NotAllowed|abort|cancel/i.test(message)) {
        setNeedsPasskey(true);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function addPasskeyThenAuthorize() {
    setBusy(true);
    setError(null);
    try {
      await linkPasskey({ name: 'Clear for Merchants' });
      await grant();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That passkey could not be set up.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {needsPasskey ? (
        <>
          <p className="m-0 mb-3 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            This device has no passkey for Clear for Merchants yet. Setting one up takes a moment
            and is what authorises Clear to pay you out — the same face or fingerprint you already
            use to unlock this device.
          </p>
          <PrimaryButton onClick={addPasskeyThenAuthorize} disabled={busy} className="w-full">
            {busy ? 'Setting up…' : 'Set up a passkey and allow'}
          </PrimaryButton>
        </>
      ) : (
        <>
          <p className="m-0 mb-3 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            You are authorising one thing: Clear may pay this shop out of the payout pool, up to
            your agreed ceiling. It cannot move your money anywhere else.
          </p>
          <PrimaryButton onClick={authorize} disabled={busy} className="w-full">
            {busy ? 'Authorising…' : 'Allow Clear to settle payouts'}
          </PrimaryButton>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2.5 text-[11.5px] leading-[1.55]">
          {error}
        </p>
      )}
      {needsPasskey && (
        <Button onClick={() => setNeedsPasskey(false)} className="mt-2 w-full">
          Try without setting one up
        </Button>
      )}
    </div>
  );
}

export default GrantSignerPanel;
