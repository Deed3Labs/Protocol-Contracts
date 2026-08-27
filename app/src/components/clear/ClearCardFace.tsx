import { useId } from 'react';
import type { CardData } from '@/lib/clearModel';
import { NETWORK_MARKS } from '@/assets/brand/networkMarks';

/*
 * The card face.
 *
 * Six layers, in order: material gradient, light sweep, film grain, bevel, contents, shadow. The
 * grain is what stops it reading as a CSS gradient, and the chip, contactless mark and network
 * wordmark are what stop it reading as a coloured rectangle.
 *
 * Obsidian rather than black. A warm indigo bloom top-left and a sage one bottom-right — the app's
 * two accent families, pulled onto the one surface that leaves the app. Pure black would belong to
 * any fintech.
 *
 * Deliberately plain CSS values rather than theme tokens: this is a physical object, not a surface
 * of the page, and it must look identical in light and dark. A card that changes colour with the
 * app's theme is not a card.
 *
 * The network mark and the rules about which asset is licensed for what live in
 * assets/brand/networkMarks.ts.
 */

/**
 * The network mark for this card.
 *
 * The asset and its provenance live in assets/brand/networkMarks.ts, deliberately: replacing it
 * with the licensed file the issuer program supplies should be a file swap, not a hunt through
 * components. An unrecognised network renders nothing rather than the wrong network's mark.
 */
function NetworkMark({ network, className }: { network: string; className?: string }) {
  const mark = NETWORK_MARKS[network] ?? NETWORK_MARKS[network?.toUpperCase?.() ?? ''];
  if (!mark) return null;
  return (
    <svg viewBox={mark.viewBox} className={className} role="img" aria-label={mark.label} focusable="false">
      <path fill="currentColor" d={mark.path} />
    </svg>
  );
}

/** An EMV contact plate: eight pads, the centre island, traces breaking at the edges. */
function Chip({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 42 32" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F3E3B4" />
          <stop offset="28%" stopColor="#D9BE7E" />
          <stop offset="52%" stopColor="#EFDDAA" />
          <stop offset="74%" stopColor="#C4A768" />
          <stop offset="100%" stopColor="#E4CE94" />
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="41" height="31" rx="5" fill={`url(#${id})`} stroke="rgba(112,88,38,.7)" />
      <g stroke="rgba(96,74,30,.78)" strokeWidth="1.25" fill="none" strokeLinecap="round">
        <path d="M1 11.2h12.2M1 20.8h12.2M41 11.2H28.8M41 20.8H28.8" />
        <path d="M13.2 1v5.4a5.2 5.2 0 0 0 5.2 5.2h5.2a5.2 5.2 0 0 0 5.2-5.2V1" />
        <path d="M13.2 31v-5.4a5.2 5.2 0 0 1 5.2-5.2h5.2a5.2 5.2 0 0 1 5.2 5.2V31" />
        <path d="M13.2 11.6v8.8M28.8 11.6v8.8" />
      </g>
      <rect x="13.2" y="11.6" width="15.6" height="8.8" fill="rgba(255,255,255,.16)" />
      <rect x="1.4" y="1.4" width="39.2" height="29.2" rx="4" fill="none" stroke="rgba(255,255,255,.34)" strokeWidth=".8" />
    </svg>
  );
}

function Contactless({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" className={className} aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity=".78">
        <path d="M3.5 8.2a7.5 7.5 0 0 1 0 7.6" />
        <path d="M8 5.4a12.4 12.4 0 0 1 0 13.2" />
        <path d="M12.5 2.6a17.2 17.2 0 0 1 0 18.8" />
      </g>
    </svg>
  );
}

const MATERIAL = {
  // Physical: obsidian, with the indigo and sage blooms.
  physical:
    'radial-gradient(88% 120% at 14% -8%, #4A4568 0%, rgba(74,69,104,0) 58%),' +
    'radial-gradient(78% 105% at 104% 108%, #2A6B5B 0%, rgba(42,107,91,0) 54%),' +
    'radial-gradient(140% 120% at 50% 50%, #2E2C3C 0%, #1A1922 78%)',
  // Virtual: the same family inverted — accent leads, charcoal recedes — so the two are
  // unmistakable in a stack without reading the label.
  virtual:
    'radial-gradient(85% 115% at 96% -6%, #B6AEF6 0%, rgba(182,174,246,0) 55%),' +
    'radial-gradient(80% 110% at -6% 106%, #F0EDFB 0%, rgba(240,237,251,0) 48%),' +
    'radial-gradient(150% 130% at 45% 45%, #6F66CC 0%, #443C93 82%)',
  // Frozen: the colour drains and the sheen dulls. No badge and no overlay — a card that has gone
  // flat reads as stopped without being told.
  frozen:
    'radial-gradient(90% 120% at 20% 0%, #9B9992 0%, rgba(155,153,146,0) 58%),' +
    'linear-gradient(158deg, #7C7A74 0%, #585650 100%)',
} as const;

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22180%22%20height%3D%22180%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.9%22%20numOctaves%3D%224%22%20stitchTiles%3D%22stitch%22%2F%3E%3CfeColorMatrix%20type%3D%22saturate%22%20values%3D%220%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22180%22%20height%3D%22180%22%20filter%3D%22url%28%23n%29%22%20opacity%3D%220.55%22%2F%3E%3C%2Fsvg%3E\")";

export interface ClearCardFaceProps {
  card: CardData;
  className?: string;
  /** Show the full number — only ever inside the timed reveal on Card details. */
  revealNumber?: boolean;
  /** Seconds until the reveal ends. Replaces the type tag rather than adding an element. */
  hidesInSeconds?: number;
  /** The card behind in a stack: no number, no chip — a wallet, not a gallery. */
  behind?: boolean;
  /**
   * Lithic's card-details iframe, for the real number.
   *
   * A URL rather than values, deliberately: the PAN and CVV are rendered by the issuer inside their
   * own frame and never enter our JavaScript, so they cannot reach our state, our logs or a
   * screenshot in a bug report. The same reason the SSN passes through rather than being stored —
   * a number we never hold is a number we cannot leak.
   */
  embedUrl?: string;
}

export default function ClearCardFace({
  card,
  className,
  revealNumber = false,
  hidesInSeconds,
  behind = false,
  embedUrl,
}: ClearCardFaceProps) {
  const { variant, frozen, last4, cardholder, expiry, pan } = card;
  const revealed = revealNumber;

  const material = frozen ? MATERIAL.frozen : MATERIAL[variant];
  const groups = revealed && pan ? pan.replace(/\s+/g, '').match(/.{1,4}/g) ?? [] : ['••••', '••••', '••••', last4 || '••••'];

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ${className ?? ''}`}
      style={{
        aspectRatio: '1.5857',
        color: '#EDEAE3',
        boxShadow:
          '0 1px 1px rgba(0,0,0,.10), 0 8px 20px -6px rgba(30,28,40,.40), 0 20px 44px -20px rgba(30,28,40,.32)',
      }}
    >
      <div className="absolute inset-0 z-0" style={{ background: material }} />
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          opacity: frozen ? 0.5 : 1,
          background:
            'radial-gradient(62% 150% at 26% -18%, rgba(255,255,255,.20) 0%, rgba(255,255,255,0) 62%),' +
            'radial-gradient(48% 120% at 88% 116%, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 60%),' +
            'linear-gradient(180deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,0) 24%, rgba(0,0,0,.10) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{ opacity: 0.34, mixBlendMode: 'overlay', backgroundImage: GRAIN, backgroundSize: '180px 180px' }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-[3] rounded-2xl"
        style={{
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,.20), inset 0 -1px 0 rgba(0,0,0,.28), inset 0 0 0 .5px rgba(255,255,255,.07)',
        }}
      />

      <div
        className="relative z-[4] flex h-full flex-col justify-between p-[18px] sm:p-5"
        style={{ opacity: frozen ? 0.82 : 1 }}
      >
        <div className="flex items-start justify-between">
          <span className="flex items-center gap-2">
            {/* The real logo, not a drawn stand-in. */}
            <img src="/ClearPath-Logo.png" alt="" aria-hidden className="h-[19px] w-[19px] rounded-[5px] object-cover" />
            <span className="text-[15px] font-semibold tracking-[-.3px]">Clear</span>
          </span>
          {/*
            * Revealing replaces the type tag with a countdown rather than adding a new element, so
            * the card never jumps. The slot already reads as status.
            */}
          <span
            className="rounded-full px-2 py-[3px] text-[8.5px] uppercase tracking-[.9px]"
            style={{
              border: `.5px solid rgba(255,255,255,${revealed ? '.5' : '.3'})`,
              background: 'rgba(255,255,255,.06)',
            }}
          >
            {frozen ? 'Frozen' : revealed && hidesInSeconds != null ? `Hides in ${hidesInSeconds}s` : variant}
          </span>
        </div>

        {!behind && (
          <div>
            <div className="mb-3.5 flex items-center gap-3">
              {/*
                * No chip on the virtual card. It has no plastic and never meets a terminal, so a
                * contact plate would be decoration pretending to be function. The contactless mark
                * stays, because that one is true: it lives in Apple Pay.
                */}
              {variant === 'physical' && <Chip className="h-8 w-[42px]" />}
              <Contactless className="h-[19px] w-[15px]" />
            </div>
            {revealed && embedUrl ? (
              /*
               * The issuer draws the number, in its own frame, over the space ours occupies.
               *
               * This replaced a dialog that showed `card.pan` — a field nothing ever filled for a
               * real card, so it displayed the placeholder's number or nothing at all. The card is
               * where a member looks for a card number, and an iframe is the only way to show a
               * real one without our JavaScript ever touching it: the PAN and CVV are rendered by
               * the issuer and cannot reach our state, our logs, or a screenshot in a bug report.
               */
              <iframe
                src={embedUrl}
                title="Card number"
                className="mb-2 h-[54px] w-full border-0 bg-transparent"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            ) : (
              <p
                className="mb-2.5 font-mono text-[14.5px] tracking-[2.2px]"
                style={{ textShadow: '0 1px 1px rgba(0,0,0,.30)' }}
              >
                {groups.map((group, i) => (
                  <span key={i} className={i < groups.length - 1 ? 'mr-2' : undefined}>
                    {group}
                  </span>
                ))}
              </p>
            )}
            <div className="flex items-end justify-between">
              <div>
                <p className="m-0 mb-[3px] text-[8px] uppercase tracking-[.7px] opacity-60">
                  Valid thru {expiry}
                </p>
                <p className="m-0 text-[10px] uppercase tracking-[.8px] opacity-95">{cardholder}</p>
              </div>
              <NetworkMark network={card.network} className="h-3 w-[38px] opacity-95" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
