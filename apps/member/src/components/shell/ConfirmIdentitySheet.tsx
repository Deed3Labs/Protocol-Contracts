import { useState } from 'react';
import {
  errorIndicatesMaxMfaRetries,
  errorIndicatesMfaTimeout,
  errorIndicatesMfaVerificationFailed,
  useMfa,
  useRegisterMfaListener,
  type MfaMethod,
} from '@privy-io/react-auth';
import Modal from '@/components/clear/Modal';
import { Btn } from '@/components/clear/brand/anatomy';
import PinBox from '@/components/clear/auth/PinBox';

/**
 * "Confirm it's you" — our sheet in front of Privy's wallet MFA.
 *
 * When a signature needs a verified factor, Privy calls the listener below instead of showing its
 * own modal (`mfa.noPromptOnMfaRequired: true`). This sheet asks, and hands the answer to Privy's
 * `useMfa`, which does the verifying and then signs. Only the look is ours; the check is Privy's.
 *
 * Face ID is offered first where the member has it, with the authenticator app as the other way in.
 * The Face ID button is a real tap on purpose: the system Face ID sheet needs a user gesture, and a
 * signature that asked for it on its own, halfway through an async send, would be refused by Safari.
 */
export default function ConfirmIdentitySheet() {
  const { init, submit, cancel } = useMfa();
  const [methods, setMethods] = useState<MfaMethod[] | null>(null);
  const [mode, setMode] = useState<'passkey' | 'totp'>('passkey');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRegisterMfaListener({
    onMfaRequired: async ({ mfaMethods }) => {
      setMethods(mfaMethods);
      setMode(mfaMethods.includes('passkey') ? 'passkey' : 'totp');
      setCode('');
      setError(null);
    },
  });

  const open = methods !== null;
  const hasPasskey = methods?.includes('passkey') ?? false;
  const hasTotp = methods?.includes('totp') ?? false;

  const close = () => {
    cancel();
    setMethods(null);
    setBusy(false);
  };

  const explain = (e: unknown): string => {
    if (errorIndicatesMaxMfaRetries(e)) return 'Too many tries. Wait a moment, then start again.';
    if (errorIndicatesMfaTimeout(e)) return 'That took too long. Try again.';
    if (errorIndicatesMfaVerificationFailed(e)) return mode === 'totp' ? 'That code did not match. Try the newest one.' : 'Face ID did not match. Try again.';
    return mode === 'totp' ? 'That code did not work. Try again.' : 'Face ID did not finish. Try again.';
  };

  const confirmFaceId = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await init('passkey');
      if (!options) throw new Error('No Face ID challenge');
      await submit('passkey', options);
      setMethods(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await init('totp');
      await submit('totp', code);
      setMethods(null);
    } catch (e) {
      setError(explain(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Confirm it's you"
      description="This payment needs your confirmation before it goes."
      footer={
        <>
          {error && <p className="c-det c-errline mb-s1">{error}</p>}
          {mode === 'passkey' ? (
            <Btn primary lg disabled={busy} onClick={() => void confirmFaceId()}>
              {busy ? 'Waiting for Face ID…' : 'Use Face ID'}
            </Btn>
          ) : (
            <Btn primary lg disabled={busy || code.length !== 6} onClick={() => void confirmCode()}>
              {busy ? 'Checking…' : 'Confirm'}
            </Btn>
          )}
          {hasPasskey && hasTotp && (
            <Btn
              className="c-linkish mt-s1 w-full"
              disabled={busy}
              onClick={() => {
                setMode(mode === 'passkey' ? 'totp' : 'passkey');
                setError(null);
              }}
            >
              {mode === 'passkey' ? 'Use your authenticator app instead' : 'Use Face ID instead'}
            </Btn>
          )}
        </>
      }
    >
      {mode === 'passkey' ? (
        <p className="c-det">Your wallet signs payments only after Face ID, so no one else can move your money.</p>
      ) : (
        <>
          <p className="c-det mb-s2">Enter the six digits your authenticator app shows for Clear.</p>
          <PinBox value={code} onChange={setCode} autoFocus label="Code from your authenticator app" />
        </>
      )}
    </Modal>
  );
}
