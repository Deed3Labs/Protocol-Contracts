import { useId, type ReactNode } from 'react';

/**
 * What a Point shows, and the labels, drawn as the terminal reference draws them (sections 2, 3,
 * 4, 7, 8, 8b, 9 and 13b): an e-ink screen in its bezel, its ready light, and the phone-tap waves
 * under it. Coordinates are the reference's own; only the words change.
 *
 * These are previews on the tablet. The Point draws its own screens from the device API.
 */

const INK = '#191A19';
const PAPER = '#E7E7E0';
const GREY = '#68686A';
const RULE = '#B4B4AC';
const DIM = '#B4B4AC';

/** The QR the reference draws on every screen. A preview stands in a pattern, not a working code. */
const QR =
  'M0 0h7v1h-7zM9 0h1v1h-1zM12 0h1v1h-1zM14 0h1v1h-1zM17 0h4v1h-4zM22 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM8 1h6v1h-6zM18 1h2v1h-2zM22 1h1v1h-1zM28 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM11 2h1v1h-1zM15 2h1v1h-1zM20 2h1v1h-1zM22 2h1v1h-1zM24 2h3v1h-3zM28 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM9 3h2v1h-2zM12 3h2v1h-2zM16 3h5v1h-5zM22 3h1v1h-1zM24 3h3v1h-3zM28 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h6v1h-6zM16 4h1v1h-1zM18 4h2v1h-2zM22 4h1v1h-1zM24 4h3v1h-3zM28 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM10 5h2v1h-2zM14 5h4v1h-4zM19 5h2v1h-2zM22 5h1v1h-1zM28 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h7v1h-7zM15 7h1v1h-1zM17 7h2v1h-2zM20 7h1v1h-1zM0 8h1v1h-1zM2 8h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM16 8h5v1h-5zM24 8h1v1h-1zM27 8h1v1h-1zM3 9h1v1h-1zM5 9h1v1h-1zM13 9h1v1h-1zM15 9h4v1h-4zM21 9h2v1h-2zM25 9h1v1h-1zM28 9h1v1h-1zM0 10h5v1h-5zM6 10h2v1h-2zM9 10h1v1h-1zM11 10h2v1h-2zM14 10h4v1h-4zM21 10h1v1h-1zM23 10h1v1h-1zM26 10h3v1h-3zM0 11h4v1h-4zM7 11h1v1h-1zM10 11h5v1h-5zM16 11h3v1h-3zM20 11h2v1h-2zM23 11h1v1h-1zM27 11h1v1h-1zM3 12h1v1h-1zM5 12h2v1h-2zM9 12h3v1h-3zM14 12h2v1h-2zM20 12h3v1h-3zM25 12h1v1h-1zM27 12h2v1h-2zM0 13h4v1h-4zM5 13h1v1h-1zM8 13h1v1h-1zM11 13h2v1h-2zM14 13h2v1h-2zM20 13h3v1h-3zM25 13h1v1h-1zM28 13h1v1h-1zM0 14h4v1h-4zM6 14h1v1h-1zM8 14h1v1h-1zM11 14h1v1h-1zM13 14h1v1h-1zM17 14h2v1h-2zM20 14h6v1h-6zM27 14h2v1h-2zM0 15h1v1h-1zM2 15h1v1h-1zM5 15h1v1h-1zM8 15h1v1h-1zM10 15h2v1h-2zM15 15h1v1h-1zM17 15h2v1h-2zM25 15h1v1h-1zM27 15h1v1h-1zM4 16h1v1h-1zM6 16h6v1h-6zM16 16h3v1h-3zM21 16h2v1h-2zM25 16h1v1h-1zM27 16h2v1h-2zM1 17h1v1h-1zM3 17h2v1h-2zM9 17h1v1h-1zM11 17h1v1h-1zM13 17h1v1h-1zM15 17h4v1h-4zM20 17h3v1h-3zM25 17h2v1h-2zM28 17h1v1h-1zM0 18h1v1h-1zM2 18h2v1h-2zM6 18h1v1h-1zM8 18h1v1h-1zM11 18h1v1h-1zM14 18h5v1h-5zM22 18h2v1h-2zM27 18h2v1h-2zM1 19h1v1h-1zM4 19h1v1h-1zM7 19h2v1h-2zM10 19h1v1h-1zM12 19h3v1h-3zM16 19h2v1h-2zM20 19h1v1h-1zM23 19h1v1h-1zM25 19h1v1h-1zM27 19h1v1h-1zM0 20h1v1h-1zM2 20h1v1h-1zM5 20h2v1h-2zM12 20h1v1h-1zM14 20h2v1h-2zM18 20h7v1h-7zM8 21h2v1h-2zM11 21h1v1h-1zM14 21h2v1h-2zM19 21h2v1h-2zM24 21h1v1h-1zM26 21h3v1h-3zM0 22h7v1h-7zM10 22h1v1h-1zM13 22h1v1h-1zM17 22h1v1h-1zM19 22h2v1h-2zM22 22h1v1h-1zM24 22h2v1h-2zM27 22h2v1h-2zM0 23h1v1h-1zM6 23h1v1h-1zM9 23h1v1h-1zM11 23h2v1h-2zM15 23h1v1h-1zM20 23h1v1h-1zM24 23h2v1h-2zM28 23h1v1h-1zM0 24h1v1h-1zM2 24h3v1h-3zM6 24h1v1h-1zM8 24h4v1h-4zM16 24h1v1h-1zM20 24h5v1h-5zM0 25h1v1h-1zM2 25h3v1h-3zM6 25h1v1h-1zM9 25h1v1h-1zM11 25h2v1h-2zM15 25h3v1h-3zM19 25h2v1h-2zM24 25h1v1h-1zM26 25h1v1h-1zM0 26h1v1h-1zM2 26h3v1h-3zM6 26h1v1h-1zM8 26h3v1h-3zM13 26h4v1h-4zM18 26h2v1h-2zM21 26h1v1h-1zM23 26h3v1h-3zM28 26h1v1h-1zM0 27h1v1h-1zM6 27h1v1h-1zM10 27h1v1h-1zM13 27h2v1h-2zM16 27h6v1h-6zM27 27h1v1h-1zM0 28h7v1h-7zM8 28h1v1h-1zM10 28h2v1h-2zM13 28h1v1h-1zM15 28h1v1h-1zM18 28h1v1h-1zM20 28h1v1h-1zM23 28h3v1h-3zM27 28h2v1h-2z';

type Face = 'mono' | 'disp' | 'text';
const FONT: Record<Face, string> = {
  mono: 'IBM Plex Mono, monospace',
  disp: 'Bricolage Grotesque, sans-serif',
  text: 'Instrument Sans, sans-serif',
};

/** One line of text, as every drawing writes them. */
function T({
  x,
  y,
  a = 'start',
  f,
  s,
  w = 400,
  fill = INK,
  ls,
  children,
}: {
  x: number;
  y: number;
  a?: 'start' | 'middle' | 'end';
  f: Face;
  s: number;
  w?: number;
  fill?: string;
  ls?: number;
  children: ReactNode;
}) {
  const spacing = ls ?? (f === 'mono' ? 1.2 : 0);
  return (
    <text
      x={x}
      y={y}
      textAnchor={a}
      style={{
        fontFamily: FONT[f],
        fontSize: s,
        fontWeight: w,
        fill,
        letterSpacing: spacing,
      }}
    >
      {children}
    </text>
  );
}

const Rule = ({ x1, y1, x2, y2, c = INK, w = 1 }: { x1: number; y1: number; x2: number; y2: number; c?: string; w?: number }) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={w} />;

function Qr({ x, y, scale, size }: { x: number; y: number; scale: number; size: number }) {
  return (
    <>
      <rect x={x} y={y} width={size} height={size} fill={PAPER} />
      <g transform={`translate(${x + (size - 29 * scale) / 2} ${y + (size - 29 * scale) / 2}) scale(${scale})`}>
        <path d={QR} fill={INK} />
      </g>
    </>
  );
}

/**
 * The Point: bezel, e-ink paper (with its grain), the light above it and the tap waves below.
 * `inverted` is the held and ready screens; `lit` is the ready light (and the case's ring).
 */
export function PointFrame({ label, inverted, lit, large, children }: { label: string; inverted?: boolean; lit?: boolean; large?: boolean; children: ReactNode }) {
  const id = useId().replace(/:/g, '');
  const w = large ? 800 : 400;
  const h = large ? 480 : 300;
  const k = large ? 1.0392 : 1;
  const view = large ? '-24 -22 848 559' : '-20 -23 440 377';
  const cx = w / 2;
  const ly = large ? -11 : -11.5;
  const r = 4.245283018867925 * k;
  const wave = 2.1226415094339623 * k;
  const wy = large ? 501.66 : 320.52;
  return (
    <svg viewBox={view} role="img" aria-label={label}>
      <rect x={large ? -24 : -20} y={large ? -22 : -23} width={large ? 848 : 440} height={large ? 559 : 377} rx={large ? 20 : 19} fill="#1E2622" />
      <rect x={0} y={0} width={w} height={h} fill={PAPER} />
      {inverted && <rect x={0} y={0} width={w} height={h} fill={INK} />}
      {children}
      <defs>
        <filter id={`${id}a`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves={2} seed={inverted ? 182 : 154} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values={`0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.07  0 0 0 ${inverted ? 0.288 : 0.216} 0`} />
        </filter>
        <filter id={`${id}b`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves={3} seed={inverted ? 338 : 286} />
          <feColorMatrix type="matrix" values={`0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 ${inverted ? 0.05 : 0.07} 0`} />
        </filter>
      </defs>
      <rect x={0} y={0} width={w} height={h} filter={`url(#${id}a)`} style={{ mixBlendMode: 'multiply' }} />
      <rect x={0} y={0} width={w} height={h} filter={`url(#${id}b)`} opacity={0.8} style={{ mixBlendMode: 'multiply' }} />
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="#000" strokeOpacity={0.1} strokeWidth={3} />
      {lit && <circle cx={cx} cy={ly} r={10.377358490566039 * k} fill="#7C8CC5" opacity={0.35} />}
      <circle cx={cx} cy={ly} r={r} fill={lit ? '#7C8CC5' : '#3A443F'} />
      <g fill="none" stroke="#5F6A64" strokeWidth={wave} strokeLinecap="round">
        <path d={`M${cx - 7.0754716981132 * k} ${wy} a${9.433962264150944 * k} ${9.433962264150944 * k} 0 0 1 0 ${14.150943396226417 * k}`} />
        <path d={`M${cx} ${wy - 4.32 * k} a${15.094339622641511 * k} ${15.094339622641511 * k} 0 0 1 0 ${21.69811320754717 * k}`} />
        <path d={`M${cx + 7.0754716981132 * k} ${wy - 8.64 * k} a${20.754716981132077 * k} ${20.754716981132077 * k} 0 0 1 0 ${29.245283018867926 * k}`} />
      </g>
    </svg>
  );
}

export const money = (cents: number) => (cents / 100).toFixed(2);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** "USECLEAR.ORG/P/A7K2" */
const urlFor = (code: string) => `USECLEAR.ORG/P/${code}`;

/** Free: the table's number, large, and the menu code (seating addendum: Number, the default). */
export function PointNumber({ table, shop, code }: { table: number; shop: string; code: string }) {
  return (
    <PointFrame label={`Table ${table}, free`}>
      <T x={16} y={34} f="mono" s={12}>
        TABLE
      </T>
      <T x={6} y={196} f="disp" s={178} w={800} ls={-8}>
        {table}
      </T>
      <Qr x={236} y={8} scale={4} size={148} />
      <T x={310} y={176} a="middle" f="mono" s={11}>
        SCAN FOR THE MENU
      </T>
      <T x={310} y={193} a="middle" f="mono" s={11} fill={GREY}>
        PAY HERE TOO
      </T>
      <Rule x1={0} y1={212} x2={400} y2={212} />
      <T x={16} y={246} f="text" s={22} w={600}>
        {shop}
      </T>
      <T x={16} y={284} f="mono" s={11}>
        {urlFor(code)}
      </T>
      <T x={384} y={284} a="end" f="mono" s={11}>
        TAP PHONE BELOW
      </T>
    </PointFrame>
  );
}

/** Held for a party: inverted and lit, their first name (or Reserved), until they order. */
export function PointHeld({ table, name, size, seatedAt }: { table: number; name: string | null; size: number; seatedAt: string }) {
  return (
    <PointFrame label={`Table ${table} held for ${name ?? 'a party'}, inverted`} inverted lit>
      <T x={16} y={34} f="mono" s={12} fill={PAPER}>
        TABLE
      </T>
      <T x={6} y={196} f="disp" s={178} w={800} ls={-8} fill={PAPER}>
        {table}
      </T>
      <Qr x={236} y={8} scale={4} size={148} />
      <T x={310} y={176} a="middle" f="mono" s={11} fill={PAPER}>
        SEE THE MENU
      </T>
      <T x={310} y={193} a="middle" f="mono" s={11} fill={DIM}>
        BEFORE WE COME OVER
      </T>
      <Rule x1={0} y1={212} x2={400} y2={212} c={PAPER} />
      <T x={16} y={248} f="disp" s={26} w={800} fill={PAPER}>
        {name ? `For ${name}, party of ${size}.` : 'Reserved'}
      </T>
      <T x={16} y={284} f="mono" s={11} fill={PAPER}>{`WELCOME · SEATED ${seatedAt}`}</T>
      <T x={384} y={284} a="end" f="mono" s={11} fill={DIM}>
        SIT RIGHT HERE
      </T>
    </PointFrame>
  );
}

export interface BillLine {
  qty: number;
  name: string;
  cents: number;
}

/** A table's bill (section 8), or with the Pay case's reader below it (13b). */
export function PointBill({
  shop,
  table,
  lines,
  taxCents,
  totalCents,
  sentAt,
  reader,
}: {
  shop: string;
  table: number;
  lines: BillLine[];
  taxCents: number;
  totalCents: number;
  sentAt: string;
  reader?: boolean;
}) {
  const rows = [
    ...lines.map((l) => ({
      k: `${l.qty}  ${l.name}`,
      v: money(l.cents),
      grey: false,
    })),
    { k: 'Tax', v: money(taxCents), grey: true },
  ];
  return (
    <PointFrame label={reader ? `Bill with the reader below, ${usd(totalCents)}` : `Bill screen, ${usd(totalCents)} at table ${table}`}>
      <T x={16} y={26} f="text" s={17} w={600}>
        {shop}
      </T>
      <T x={384} y={26} a="end" f="mono" s={11}>{`TABLE ${table}`}</T>
      <Rule x1={0} y1={40} x2={400} y2={40} />
      <T x={16} y={64} f="mono" s={11}>
        YOUR BILL
      </T>
      {rows.map((r, i) => (
        <g key={i}>
          <T x={16} y={92 + i * 26} f="text" s={15} fill={r.grey ? GREY : INK}>
            {r.k}
          </T>
          <T x={228} y={92 + i * 26} a="end" f="text" s={15} fill={r.grey ? GREY : INK}>
            {r.v}
          </T>
          <Rule x1={16} y1={101 + i * 26} x2={228} y2={101 + i * 26} c={RULE} />
        </g>
      ))}
      <T x={16} y={214} f="mono" s={11}>
        TOTAL
      </T>
      <T x={228} y={236} a="end" f="disp" s={36} w={800}>
        {usd(totalCents)}
      </T>
      <Rule x1={244} y1={40} x2={244} y2={260} />
      {reader ? (
        <>
          <T x={322} y={92} a="middle" f="disp" s={22} w={800}>
            Tap or
          </T>
          <T x={322} y={118} a="middle" f="disp" s={22} w={800}>
            insert
          </T>
          <T x={322} y={144} a="middle" f="disp" s={22} w={800}>
            below.
          </T>
          <path d="M310 168 l12 14 l12 -14" fill="none" stroke={INK} strokeWidth={3} />
          <T x={322} y={212} a="middle" f="mono" s={11} fill={GREY}>
            OR TAP YOUR
          </T>
          <T x={322} y={228} a="middle" f="mono" s={11} fill={GREY}>
            PHONE ON THE
          </T>
          <T x={322} y={244} a="middle" f="mono" s={11} fill={GREY}>
            READER
          </T>
        </>
      ) : (
        <>
          <Qr x={248} y={48} scale={4} size={148} />
          <T x={322} y={212} a="middle" f="mono" s={11}>
            SCAN OR TAP
          </T>
          <T x={322} y={230} a="middle" f="mono" s={11} fill={GREY}>
            PAY NOW OR
          </T>
          <T x={322} y={246} a="middle" f="mono" s={11} fill={GREY}>
            OVER TIME
          </T>
        </>
      )}
      <Rule x1={0} y1={260} x2={400} y2={260} />
      <T x={16} y={286} f="mono" s={11}>{`BILL SENT ${sentAt}`}</T>
      <T x={384} y={286} a="end" f="mono" s={11}>
        {reader ? '↓ CARD READER' : 'ANY CARD WORKS'}
      </T>
    </PointFrame>
  );
}

/** The counter Point Large with an order sent to it (section 7). */
export function PointCounterBill({ shop, order, lines, taxCents, totalCents, rungUpBy }: { shop: string; order: string; lines: BillLine[]; taxCents: number; totalCents: number; rungUpBy: string }) {
  return (
    <PointFrame label={`Counter bill screen, ${usd(totalCents)}`} large>
      <T x={28} y={42} f="text" s={26} w={600}>
        {shop}
      </T>
      <T x={772} y={42} a="end" f="mono" s={15}>{`ORDER ${order}`}</T>
      <Rule x1={0} y1={64} x2={800} y2={64} w={1.5} />
      <T x={28} y={104} f="mono" s={15}>
        YOUR ORDER
      </T>
      {lines.map((l, i) => (
        <g key={i}>
          <T x={28} y={146 + i * 44} f="text" s={24}>{`${l.qty}  ${l.name}`}</T>
          <T x={500} y={146 + i * 44} a="end" f="text" s={24}>
            {money(l.cents)}
          </T>
          <Rule x1={28} y1={160 + i * 44} x2={500} y2={160 + i * 44} c={RULE} />
        </g>
      ))}
      <T x={28} y={146 + lines.length * 44} f="text" s={22} fill={GREY}>
        Tax
      </T>
      <T x={500} y={146 + lines.length * 44} a="end" f="text" s={22} fill={GREY}>
        {money(taxCents)}
      </T>
      <T x={28} y={396} f="mono" s={15}>
        TOTAL
      </T>
      <T x={500} y={400} a="end" f="disp" s={58} w={800}>
        {usd(totalCents)}
      </T>
      <Rule x1={530} y1={64} x2={530} y2={420} w={1.5} />
      <Qr x={536} y={70} scale={7} size={259} />
      <T x={665} y={342} a="middle" f="mono" s={15}>
        SCAN OR TAP
      </T>
      <T x={665} y={368} a="middle" f="mono" s={15} fill={GREY}>
        PAY NOW · OVER TIME
      </T>
      <Rule x1={0} y1={420} x2={800} y2={420} w={1.5} />
      <T x={28} y={458} f="mono" s={15}>{`RUNG UP BY ${rungUpBy.toUpperCase()}`}</T>
      <T x={772} y={458} a="end" f="mono" s={15}>
        ANY CARD WORKS
      </T>
    </PointFrame>
  );
}

export interface ShowcaseItem {
  name: string;
  detail: string | null;
  cents: number;
}

/** Idle in Showcase: one group at a time, with the full menu's code (section 3). */
export function PointShowcase({ shop, table, group, page, of, items }: { shop: string; table: number; group: string; page: number; of: number; items: ShowcaseItem[] }) {
  return (
    <PointFrame label={`Menu showcase screen, ${group.toLowerCase()}`}>
      <T x={16} y={26} f="text" s={17} w={600}>
        {shop}
      </T>
      <T x={384} y={26} a="end" f="mono" s={11}>{`TABLE ${table}`}</T>
      <Rule x1={0} y1={40} x2={400} y2={40} />
      <T x={16} y={80} f="disp" s={28} w={800}>
        {group}
      </T>
      <T x={228} y={80} a="end" f="mono" s={11} fill={GREY}>{`${page} OF ${of}`}</T>
      <Rule x1={16} y1={94} x2={228} y2={94} c={RULE} />
      {items.slice(0, 4).map((it, i) => (
        <g key={i}>
          <T x={16} y={112 + i * 38} f="text" s={15} w={600}>
            {it.name}
          </T>
          <T x={228} y={112 + i * 38} a="end" f="text" s={15}>
            {money(it.cents)}
          </T>
          {it.detail && (
            <T x={16} y={128 + i * 38} f="text" s={12} fill={GREY}>
              {it.detail}
            </T>
          )}
          {i < 3 && <Rule x1={16} y1={132 + i * 38} x2={228} y2={132 + i * 38} c={RULE} />}
        </g>
      ))}
      <Rule x1={244} y1={40} x2={244} y2={260} />
      <Qr x={248} y={48} scale={4} size={148} />
      <T x={322} y={212} a="middle" f="mono" s={11}>
        FULL MENU
      </T>
      <T x={322} y={230} a="middle" f="mono" s={11} fill={GREY}>
        SCAN OR TAP
      </T>
      {Array.from({ length: of }, (_, i) => (
        <rect key={i} x={16 + i * 14} y={276} width={8} height={8} fill={i === page - 1 ? INK : RULE} />
      ))}
      <Rule x1={0} y1={260} x2={400} y2={260} />
      <T x={384} y={286} a="end" f="mono" s={11}>
        FROM TODAY'S MENU
      </T>
    </PointFrame>
  );
}

/** Order ready on the counter Point (section 9): inverted, lit. */
export function PointReady({ shop, order }: { shop: string; order: string }) {
  return (
    <PointFrame label={`Order ${order} ready screen, inverted`} inverted lit>
      <T x={16} y={26} f="text" s={17} w={600} fill={PAPER}>
        {shop}
      </T>
      <T x={384} y={26} a="end" f="mono" s={11} fill={PAPER}>{`ORDER ${order}`}</T>
      <Rule x1={0} y1={40} x2={400} y2={40} c={PAPER} />
      <T x={10} y={224} f="disp" s={168} w={800} ls={-6} fill={PAPER}>
        {order}
      </T>
      <Rule x1={232} y1={40} x2={232} y2={260} c={PAPER} />
      <T x={250} y={82} f="mono" s={12} fill={PAPER}>
        ORDER
      </T>
      <T x={250} y={124} f="disp" s={38} w={800} fill={PAPER}>
        Ready.
      </T>
      <T x={250} y={166} f="text" s={17} fill={PAPER}>
        Pick up at
      </T>
      <T x={250} y={188} f="text" s={17} fill={PAPER}>
        the counter.
      </T>
      <Rule x1={0} y1={260} x2={400} y2={260} c={PAPER} />
      <T x={16} y={286} f="mono" s={11} fill={PAPER}>
        THANKS FOR WAITING
      </T>
    </PointFrame>
  );
}

/** Call pressed on the Pay case (13b): lit until answered. */
export function PointCalled({ shop, table, at }: { shop: string; table: number; at: string }) {
  return (
    <PointFrame label="Call pressed, someone is coming" lit>
      <T x={16} y={26} f="text" s={17} w={600}>
        {shop}
      </T>
      <T x={384} y={26} a="end" f="mono" s={11}>{`TABLE ${table}`}</T>
      <Rule x1={0} y1={40} x2={400} y2={40} />
      <T x={16} y={100} f="disp" s={38} w={800}>
        Someone's
      </T>
      <T x={16} y={140} f="disp" s={38} w={800}>
        coming over.
      </T>
      <T x={16} y={180} f="text" s={15}>{`You pressed Call at ${at}.`}</T>
      <T x={16} y={202} f="text" s={15} fill={GREY}>
        Press it again to cancel.
      </T>
      <Rule x1={0} y1={260} x2={400} y2={260} />
      <T x={16} y={286} f="mono" s={11}>{`CALL · ${at}`}</T>
      <T x={384} y={286} a="end" f="mono" s={11}>{`TABLE ${table}`}</T>
    </PointFrame>
  );
}

// ---- Labels, at size --------------------------------------------------------------------------------

const LABEL_INK = '#111';
const LABEL_PAPER = '#FBFBF8';

function LabelFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox="-26 -26 864 661" role="img" aria-label={label}>
      <rect x={-26} y={-26} width={864} height={661} rx={10} fill="#D8D2C2" />
      <rect x={0} y={0} width={812} height={609} rx={24} fill={LABEL_PAPER} />
      <g>{children}</g>
    </svg>
  );
}

export interface LabelLine {
  qty: number;
  name: string;
  note: string | null;
}

/** A bag label, 4 × 3 (section 4). */
export function BagLabel({
  shop,
  partner,
  order,
  name,
  items,
  bags,
  bag,
  ready,
  lines,
  sealed,
}: {
  shop: string;
  partner: string;
  order: string;
  name: string;
  items: number;
  bags: number;
  bag: number;
  ready: string;
  lines: LabelLine[];
  sealed: string;
}) {
  const L = (p: Parameters<typeof T>[0]) => <T fill={LABEL_INK} {...p} />;
  return (
    <LabelFrame label={`Bag label for order ${order}, 4 by 3 inches`}>
      <L x={36} y={66} f="text" s={38} w={600}>
        {shop}
      </L>
      <L x={776} y={64} a="end" f="mono" s={24} ls={2.4}>
        {partner.toUpperCase()}
      </L>
      <Rule x1={36} y1={92} x2={776} y2={92} c={LABEL_INK} w={3} />
      <L x={28} y={300} f="disp" s={230} w={800} ls={-10}>
        {order}
      </L>
      <Rule x1={372} y1={112} x2={372} y2={330} c={LABEL_INK} w={2} />
      <L x={398} y={172} f="disp" s={60} w={800}>
        {name}
      </L>
      <L x={400} y={214} f="mono" s={22} ls={2.4}>{`${items} ITEMS · ${bags} BAGS`}</L>
      <L x={400} y={250} f="mono" s={22} ls={2.4}>{`BAG ${bag} OF ${bags}`}</L>
      <L x={400} y={300} f="mono" s={22} ls={2.4}>{`READY ${ready}`}</L>
      <Rule x1={36} y1={350} x2={776} y2={350} c={LABEL_INK} w={3} />
      {lines.slice(0, 3).map((l, i) => (
        <g key={i}>
          <L x={36} y={398 + i * 46} f="mono" s={26} ls={2.4}>
            {l.qty}
          </L>
          <L x={82} y={398 + i * 46} f="text" s={30} w={600}>
            {l.name}
          </L>
          {l.note && (
            <L x={776} y={398 + i * 46} a="end" f="text" s={24}>
              {l.note}
            </L>
          )}
        </g>
      ))}
      <Rule x1={36} y1={537} x2={776} y2={537} c={LABEL_INK} w={2} />
      <L x={36} y={575} f="mono" s={20} ls={2.4}>{`STICK ACROSS THE FOLD · SEALED ${sealed}`}</L>
    </LabelFrame>
  );
}

/** A kitchen ticket, 4 × 3 (section 4). */
export function KitchenTicket({ where, service, at, lines, ticket, sentBy }: { where: string; service: string; at: string; lines: LabelLine[]; ticket: number; sentBy: string }) {
  const L = (p: Parameters<typeof T>[0]) => <T fill={LABEL_INK} {...p} />;
  let y = 176;
  const rows = lines.slice(0, 3).map((l, i) => {
    const top = y;
    y += l.note ? 96 : 66;
    return (
      <g key={i}>
        <L x={36} y={top} f="disp" s={44} w={800}>
          {l.qty}
        </L>
        <L x={98} y={top} f="disp" s={44} w={800}>
          {l.name}
        </L>
        {l.note && (
          <L x={100} y={top + 34} f="mono" s={22} ls={2.4}>
            {l.note.toUpperCase()}
          </L>
        )}
        <Rule x1={36} y1={top + (l.note ? 52 : 22)} x2={776} y2={top + (l.note ? 52 : 22)} c={LABEL_INK} />
      </g>
    );
  });
  return (
    <LabelFrame label={`Kitchen ticket for ${where.toLowerCase()}, 4 by 3 inches`}>
      <rect x={0} y={0} width={812} height={104} rx={24} fill={LABEL_INK} />
      <rect x={0} y={60} width={812} height={44} fill={LABEL_INK} />
      <T x={36} y={72} f="disp" s={52} w={800} fill={LABEL_PAPER}>
        {where}
      </T>
      <T x={776} y={68} a="end" f="mono" s={22} ls={2.4} fill={LABEL_PAPER}>{`${service} · ${at}`}</T>
      {rows}
      <L x={36} y={579} f="mono" s={20} ls={2.4}>{`TICKET ${ticket} · SENT BY ${sentBy.toUpperCase()}`}</L>
      <L x={776} y={579} a="end" f="mono" s={20} ls={2.4}>
        STICK ON THE RAIL
      </L>
    </LabelFrame>
  );
}
