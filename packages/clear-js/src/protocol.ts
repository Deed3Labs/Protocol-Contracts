import { MODAL_ERROR_CODES, PAYMENT_ID, PROTOCOL } from './constants';

/**
 * The frame's messages, checked as strictly as the contract's zod schemas (`ModalMessage`): the
 * protocol, a known type, exactly that type's fields and nothing else. `protocol.test.ts` runs the
 * same cases through both.
 */
export type ModalMessage =
  | { protocol: typeof PROTOCOL; type: 'ready' }
  | { protocol: typeof PROTOCOL; type: 'resize'; height: number }
  | { protocol: typeof PROTOCOL; type: 'success'; id: string; status: 'succeeded' | 'processing'; reference: string | null }
  | { protocol: typeof PROTOCOL; type: 'cancel' }
  | { protocol: typeof PROTOCOL; type: 'error'; code: (typeof MODAL_ERROR_CODES)[number]; message: string };

type Check = (v: unknown) => boolean;

const str: Check = (v) => typeof v === 'string';
/** `Reference`: 1–100 characters once trimmed (the contract trims it, so the script does too). */
const reference: Check = (v) => v === null || (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100);

const SHAPES: Record<string, Record<string, Check>> = {
  ready: {},
  resize: { height: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000 },
  success: {
    id: (v) => str(v) && PAYMENT_ID.test(v as string),
    status: (v) => v === 'succeeded' || v === 'processing',
    reference,
  },
  cancel: {},
  error: {
    code: (v) => (MODAL_ERROR_CODES as readonly unknown[]).includes(v),
    message: (v) => str(v) && (v as string).length <= 200,
  },
};

/** The message, or null when it isn't exactly one of the protocol's. */
export function parseMessage(data: unknown): ModalMessage | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return null;
  const d = data as Record<string, unknown>;
  if (d.protocol !== PROTOCOL || typeof d.type !== 'string' || !Object.prototype.hasOwnProperty.call(SHAPES, d.type)) return null;
  const shape = SHAPES[d.type]!;
  const keys = Object.keys(d);
  if (keys.length !== Object.keys(shape).length + 2) return null;
  for (const k of keys) {
    if (k === 'protocol' || k === 'type') continue;
    const check = shape[k];
    if (!Object.prototype.hasOwnProperty.call(shape, k) || !check || !check(d[k])) return null;
  }
  return d as ModalMessage;
}

/** A message event the script acts on: from `payOrigin`, from its own frame's window, and parsing. */
export function acceptMessage(
  event: { origin: string; source: unknown; data: unknown },
  frameWindow: unknown,
  payOrigin: string,
): ModalMessage | null {
  if (event.origin !== payOrigin) return null;
  if (!frameWindow || event.source !== frameWindow) return null;
  return parseMessage(event.data);
}
