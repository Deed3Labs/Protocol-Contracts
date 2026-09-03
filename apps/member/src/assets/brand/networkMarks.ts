/**
 * Card-network brand marks — one file, so replacing one is a file swap and not a code change.
 *
 * ## Provenance, and what has to change before print
 *
 * The Visa path below is simple-icons' (CC0). The mark it draws is Visa's registered trademark, and
 * simple-icons is explicit that its licence covers the file and not the trademark.
 *
 * That is the correct asset for what this app does: render a picture of a member's card on screen.
 * It is NOT the asset for card art. Manufactured plastic has to carry Visa's official Brand Mark at
 * their specified clear space, minimum size and approved colourway, and that file comes from the
 * issuer program — Lithic — not from npm.
 *
 * Nothing in this repo produces print artwork, so the two do not currently meet. The reason this is
 * one exported constant rather than a path inlined in a component is so that when they do, the
 * licensed file replaces this value and every surface picks it up at once.
 */

export interface NetworkMark {
  /** SVG path data, drawn against `viewBox`. */
  path: string;
  viewBox: string;
  label: string;
}

/*
 * The viewBox crops to the mark, not to the icon grid it was drawn on.
 *
 * simple-icons draws every icon inside 0 0 24 24 so a set of them line up. The Visa wordmark only
 * occupies y≈8.26–15.76 of that box — under a third of its height — so sizing the <svg> to 18px
 * rendered a mark about 5px tall, which is what "the Visa logo is really small" was. Cropping to
 * the ink means the height you ask for is the height you get.
 */
export const VISA: NetworkMark = {
  path: 'M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z',
  viewBox: '0 8.2 24 7.6',
  label: 'Visa',
};

/** By the network name our card records use. Unknown networks render no mark rather than a wrong one. */
export const NETWORK_MARKS: Record<string, NetworkMark> = {
  VISA,
  Visa: VISA,
  visa: VISA,
};
