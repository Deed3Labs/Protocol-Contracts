/**
 * The frame's half of the postMessage protocol (`clear.v1`, `@clear/public-api-contracts` modal.ts):
 * it only ever posts, and only to the website that made the session, never `*`. The page gets the
 * payment's id, status and reference, and nothing else.
 */
export const PROTOCOL = 'clear.v1';

export type FrameMessage =
  | { type: 'ready' }
  | { type: 'resize'; height: number }
  | { type: 'success'; id: string; status: 'succeeded' | 'processing'; reference: string | null }
  | { type: 'cancel' }
  | { type: 'error'; code: 'session_expired' | 'origin_not_allowed' | 'unavailable'; message: string };

/** Posts to the session's own website; nowhere when there isn't one, or when this page isn't framed. */
export function post(origin: string | null, message: FrameMessage, target: Window | null = typeof window !== 'undefined' && window.parent !== window ? window.parent : null) {
  if (!origin || !target) return;
  target.postMessage({ protocol: PROTOCOL, ...message }, origin);
}

/**
 * Whether the page that frames this one is the session's website, where the browser says
 * (`location.ancestorOrigins`, Chrome and Safari). The CSP's `frame-ancestors` is what stops other
 * pages; this is the second check.
 */
export function framedBy(origin: string | null, ancestors: { length: number; [i: number]: string } | undefined): boolean {
  if (!origin) return false;
  if (!ancestors || ancestors.length === 0) return true;
  return ancestors[0] === origin;
}

/**
 * The layout the page drew the frame in (`#layout=modal|sheet`, set by `@useclear/js`): a 440px modal
 * is narrower than 640px, so the frame's own width can't say. Null when the page didn't say.
 */
export function layoutFromHash(hash: string): 'modal' | 'sheet' | null {
  const m = /(?:^#|&)layout=(modal|sheet)(?:&|$)/.exec(hash);
  return m ? (m[1] as 'modal' | 'sheet') : null;
}
