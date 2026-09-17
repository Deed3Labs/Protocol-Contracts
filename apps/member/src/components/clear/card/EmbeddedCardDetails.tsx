import { useEffect, useRef, useState } from 'react';
import LithicEmbed, { Environment, type CardEmbed } from 'lithic-embed';
import { Rows } from '../brand/anatomy';

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
  onControls,
}: {
  session: string;
  environment: 'sandbox' | 'production';
  /** The frames never rendered, so the sheet can fall back to the issuer's own page. */
  onFailed: () => void;
  /**
   * Revealing belongs to the sheet's own action, not to a second button sitting among the rows —
   * so the control is handed up rather than drawn here.
   */
  onControls?: (controls: { shown: boolean; busy: boolean; toggle: () => void }) => void;
}) {
  const pan = useRef<HTMLSpanElement>(null);
  const month = useRef<HTMLSpanElement>(null);
  const year = useRef<HTMLSpanElement>(null);
  const cvv = useRef<HTMLSpanElement>(null);
  const embed = useRef<CardEmbed | null>(null);
  const [shown, setShown] = useState(false);
  /*
   * The frames are told their colour once, at mount, so a ground that changes underneath them would
   * leave the digits in the old one. Remounting is the whole fix, and a theme change is rare enough
   * that it costs nothing.
   */
  const [ground, setGround] = useState(0);
  useEffect(() => {
    const again = () => setGround((n) => n + 1);
    window.addEventListener('themechange', again);
    return () => window.removeEventListener('themechange', again);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    /*
     * The type the digits arrive in, said explicitly.
     *
     * The SDK copies the mount target's computed styles, and a computed `background-color` of
     * transparent leaves the frame's own document showing — which is white. On paper nobody
     * noticed; on ink it was three white boxes sitting in a dark sheet. A frame is a piece of the
     * row, not a thing on top of it, so it is told to paint nothing and to take the row's ink.
     */
    const page = getComputedStyle(document.documentElement);
    const styles = {
      color: page.getPropertyValue('--ink').trim() || '#16211D',
      'background-color': 'transparent',
      'font-family': page.getPropertyValue('--font-mono').trim() || 'monospace',
      'font-size': '13px',
      'letter-spacing': '0.06em',
      'line-height': '22px',
    };
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
          card.mountPan(pan.current!, styles),
          card.mountExpMonth(month.current!, styles),
          card.mountExpYear(year.current!, styles),
          card.mountCvv(cvv.current!, styles),
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
  }, [session, environment, onFailed, ground]);

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

  useEffect(() => {
    // `toggle` closes over refs and setters rather than render values, so it does not need watching.
    onControls?.({ shown, busy, toggle: () => void toggle() });
  }, [shown, busy, onControls]);

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
          /*
           * Month, slash, year as one line rather than three boxes.
           *
           * Each frame is the width of the two digits it holds — a box wider than its contents put
           * air between the month and the slash — and the row centres rather than sitting on a
           * baseline, which a frame does not have one of.
           */
          <span className="flex items-center gap-[3px]">
            <span ref={month} className="block h-[22px] w-[22px] overflow-hidden" />
            <span aria-hidden className="text-ink-50">
              /
            </span>
            <span ref={year} className="block h-[22px] w-[22px] overflow-hidden" />
          </span>,
        )}
        {row('Security code', <span ref={cvv} className="block h-[22px] w-[34px] overflow-hidden" />)}
      </Rows>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
    </>
  );
}
