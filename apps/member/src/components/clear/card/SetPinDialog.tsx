import { useEffect, useRef, useState } from 'react';
import LithicEmbed, { Environment, type PinSettingEmbed } from 'lithic-embed';
import Modal from '../Modal';
import { Btn } from '../brand/anatomy';

/**
 * Set a PIN — the issuer's own field, in our frame.
 *
 * The digits are typed into Lithic's embed, not into anything of ours: Clear never sees a PIN, and
 * the screen says so rather than implying otherwise by dressing the field in our type. The box
 * around it is ours and labelled as a borrowed field, which is the honest version of a hosted input
 * — pretending to style something we do not own would be the worse choice.
 *
 * Only a physical card has one. There is nothing to type a PIN into on a virtual card.
 */
export default function SetPinDialog({
  open,
  onOpenChange,
  session,
  environment,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A PIN_SETTING_EMBED session from the server; absent while it is being fetched. */
  session?: { session: string; environment: 'sandbox' | 'production' };
  environment?: 'sandbox' | 'production';
  onDone?: () => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const embed = useRef<PinSettingEmbed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    let live = true;
    const lithic = new LithicEmbed(
      (environment ?? session.environment) === 'production' ? Environment.PRODUCTION : Environment.SANDBOX,
    );
    const pin = lithic.pinSetting(session.session, {});
    embed.current = pin;
    // Same as the card's frames: paint nothing, take the ground's ink. A hosted field is still
    // part of the sheet it sits in.
    const page = getComputedStyle(document.documentElement);
    void pin
      .mount(target.current!, {
        color: page.getPropertyValue('--ink').trim() || '#16211D',
        'background-color': 'transparent',
        'font-family': page.getPropertyValue('--font-text').trim() || 'system-ui',
        'font-size': '22px',
      })
      .then(() => live && setReady(true))
      .catch(() => live && setError("We couldn't open the PIN field. Try again in a moment."));

    return () => {
      live = false;
      embed.current = null;
      setReady(false);
    };
  }, [open, session, environment]);

  const submit = async () => {
    if (!embed.current) return;
    setBusy(true);
    setError(null);
    try {
      await embed.current.submit();
      onDone?.();
      onOpenChange(false);
    } catch {
      setError('That PIN was not accepted. Try four different digits.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Set a PIN"
      description="For ATMs and chip-and-PIN terminals."
      footer={
        <>
          {error && <p className="c-det c-errline mb-s1">{error}</p>}
          <Btn primary lg disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? 'Setting…' : 'Set PIN'}
          </Btn>
        </>
      }
    >
      <p className="c-det mb-s2">
        For ATMs and chip-and-PIN terminals. Choose four digits you have not used elsewhere.
      </p>
      <div className="c-hosted">
        <div ref={target} className="c-pinbox [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0" />
        <p className="c-note-hosted">Handled by the card issuer</p>
      </div>
      <p className="c-det mt-s2">
        Clear never sees it. The field above is the issuer’s, which is why it does not carry our type.
      </p>
    </Modal>
  );
}
