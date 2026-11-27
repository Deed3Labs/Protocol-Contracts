import { useEffect, useState } from 'react';
import Modal from '@/components/clear/Modal';
import { Btn } from '@/components/clear/brand/anatomy';
import { forgetWantsFaceId, useFaceId, wantsFaceId } from '@/hooks/useFaceId';

/**
 * "Turn on Face ID?" — the second half of a Face ID sign-in that failed.
 *
 * The sign-in screen cannot set Face ID up (there is no account to attach it to until somebody is
 * signed in), so it remembers that they tried and sends them to a code. This is where that ends:
 * the first thing they see once they are in, one tap from the passkey their phone asks to save.
 *
 * Asked once. "Not now" forgets the request, and so does success — a member who said no should not
 * be asked again on every page, and the Settings switch is there when they change their mind. Lives
 * in the signed-in shell rather than on a page, so the preview harness never shows it.
 */
export default function FaceIdOffer() {
  const faceId = useFaceId();
  // Read once: the flag belongs to the sign-in that just happened, not to later renders.
  const [open, setOpen] = useState(() => wantsFaceId());

  // Already has a passkey — the failure was something else (a cancelled sheet, another device).
  useEffect(() => {
    if (open && faceId.on) {
      forgetWantsFaceId();
      setOpen(false);
    }
  }, [open, faceId.on]);

  const close = () => {
    forgetWantsFaceId();
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title="Turn on Face ID?"
      description="Sign in next time without waiting for a code."
      footer={
        <>
          {faceId.error && <p className="c-det c-errline mb-s1">{faceId.error}</p>}
          <Btn
            primary
            lg
            disabled={faceId.busy}
            onClick={() => void faceId.turnOn().then((ok) => ok && setOpen(false))}
          >
            {faceId.busy ? 'Waiting for Face ID…' : 'Turn on Face ID'}
          </Btn>
          <Btn lg className="mt-s1" disabled={faceId.busy} onClick={close}>
            Not now
          </Btn>
        </>
      }
    >
      <p className="c-det">
        Your phone will ask to save a passkey for Clear. It stays on this device, and you can turn it
        off in Settings.
      </p>
    </Modal>
  );
}
