import { NETWORK_MARKS } from '@/assets/brand/networkMarks';

/**
 * The card network's mark -- Visa's logo rather than the word -- from the one asset file, so the
 * licensed artwork replaces it in one place (assets/brand/networkMarks.ts).
 *
 * Drawn in `currentColor`, so it takes the card face's ink: white on the dark faces, which is one of
 * the network's approved colourways. An unrecognised network falls back to its name as text rather
 * than showing another network's mark.
 */
export default function NetworkMark({ network, className }: { network: string; className?: string }) {
  const mark = NETWORK_MARKS[network] ?? NETWORK_MARKS[network?.toUpperCase?.() ?? ''];
  if (!mark) return <span className="c-cmeta">{network}</span>;
  return (
    <svg viewBox={mark.viewBox} className={className} role="img" aria-label={mark.label} focusable="false">
      <path fill="currentColor" d={mark.path} />
    </svg>
  );
}
