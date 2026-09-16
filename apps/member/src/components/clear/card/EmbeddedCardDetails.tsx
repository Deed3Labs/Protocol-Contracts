import { useEffect, useRef, useState } from 'react';
import LithicEmbed, { Environment, type CardEmbed } from 'lithic-embed';
import { Btn, Line, Rows } from '../brand/anatomy';

/**
 * The card's own numbers, in the app's rows.
 *
 * The issuer used to render its whole card page in one frame, styled at a distance through a
 * stylesheet it loaded — labels by position, no way to copy, and a sheet that had to be described
 * to it rather than shown. Their SDK mounts one small frame per value instead, into markup that is
 * ours: the labels, the rules and the ground are the app's, and only the digits belong to Lithic.
 *
 * That is not a loosening of anything. The values still never enter this app — each frame fetches
 * its own from Lithic with a session the server minted — which is what keeps the whole app out of
 * PCI scope.
 *
 * Masked until asked, because a card number should not be sitting on a screen somebody walked past.
 */
export default function EmbeddedCardDetails({
  session,
  environment,
  onFailed,
}: {
  session: string;
  environment: 'sandbox' | 'production';
  /** The frames never rendered, so the sheet can fall back to the issuer's own page. */
  onFailed: () => void;
}) {
  const pan = useRef<HTMLSpanElement>(null);
  const month = useRef<HTMLSpanElement>(null);
  const year = useRef<HTMLSpanElement>(null);
  const cvv = useRef<HTMLSpanElement>(null);
  const embed = useRef<CardEmbed | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const lithic = new LithicEmbed(environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX);
    const card = lithic.card(session, { syncStyles: true });
    embed.current = card;

    void (async () => {
      try {
        /*
         * Mounted one at a time, by element rather than by selector.
         *
         * The combined `mount` takes CSS selectors, which would mean ids on a sheet that can hold
         * several cards' worth of rows over its life — and an id is a promise about the whole
         * document. A ref is the element itself and cannot collide.
         */
        await Promise.all([
          card.mountPan(pan.current!),
          card.mountExpMonth(month.current!),
          card.mountExpYear(year.current!),
          card.mountCvv(cvv.current!),
        ]);
      } catch {
        // A frame that never rendered is not something a member can act on, so the sheet falls
        // back to the issuer's own page rather than showing them an empty row.
        if (live) onFailed();
      }
    })();

    return () => {
      live = false;
      void card.unmount().catch(() => {});
      embed.current = null;
    };
  }, [session, environment, onFailed]);

  const toggle = async () => {
    if (!embed.current) return;
    setBusy(true);
    setError(null);
    try {
      await embed.current.toggleMasking();
      setShown((was) => !was);
    } catch {
      setError("We couldn't reach your card details. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * A row is a label and a value, and the value is a frame the size of its own line. The type is
   * set here rather than inside: the SDK copies the mount target's computed styles into the frame,
   * so what the row is dressed in is what the digits arrive in.
   */
  const row = (label: string, children: React.ReactNode) => (
    <div>
      <p className="c-label">{label}</p>
      {/* The frame fills the line it is given and cannot exceed it: a value sized by somebody
          else's stylesheet must not be able to land on the row underneath. */}
      <div className="c-mono mt-[4px] text-sec! leading-[22px] text-ink [&_iframe]:block [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0">
        {children}
      </div>
    </div>
  );

  return (
    <>
      <Rows>
        {row('Card number', <span ref={pan} className="block h-[22px] overflow-hidden" />)}
        {row(
          'Expires',
          <Line className="justify-start! gap-[6px]">
            <span ref={month} className="block h-[22px] w-[32px] overflow-hidden" />
            <span aria-hidden>/</span>
            <span ref={year} className="block h-[22px] w-[34px] overflow-hidden" />
          </Line>,
        )}
        {row('Security code', <span ref={cvv} className="block h-[22px] w-[56px] overflow-hidden" />)}
      </Rows>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
      <Btn className="mt-s2" disabled={busy} onClick={() => void toggle()}>
        {busy ? 'One moment…' : shown ? 'Hide the numbers' : 'Show the numbers'}
      </Btn>
    </>
  );
}
