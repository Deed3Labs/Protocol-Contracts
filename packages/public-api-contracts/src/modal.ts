import { z } from 'zod';
import { HttpsUrl, Livemode, ModalSessionId, PaymentId, PaymentMethod, PriceId, Reference, Timestamp } from './common';
import { Quantity } from './prices';

/**
 * The modal: Clear's page at `pay.useclear.org/m/:session`, in an iframe over the shop's page.
 *
 * The script makes a modal session with the publishable key, from one of the shop's allowed websites
 * (the API checks `Origin`). The session carries everything the frame needs, including the shop's
 * accent and logo, so **the page never sends the frame anything**: the frame trusts the session, not
 * the page. The frame answers the page with the messages below and nothing else.
 */

/** What the shop may set. Everything else in the modal is Clear's, so a fake is easier to spot. */
const ModalOptions = {
  /** `#B4532A`: buttons and links. Checked for contrast; Clear's ink is used when it fails. */
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  logo: HttpsUrl.optional(),
  /** BCP 47. The modal speaks English until another locale is built, whatever this says. */
  locale: z.string().min(2).max(35).optional(),
  /** Both, unless the shop asks for one. Card is offered only when the shop's card processor is connected. */
  methods: z.array(PaymentMethod).min(1).optional(),
  /** Fills in "Email or phone". */
  email: z.email().max(254).optional(),
};

/**
 * `POST /v1/modal_sessions`, with the publishable key, from an allowed website. A price and a
 * quantity, or a payment's client secret, and the options above.
 */
export const CreateModalSession = z.union([
  z.strictObject({ price: PriceId, quantity: Quantity.default(1), ...ModalOptions }),
  z.strictObject({ payment: z.string().min(1).max(200), ...ModalOptions }),
]);
export type CreateModalSession = z.input<typeof CreateModalSession>;

export const ModalSession = z.object({
  id: ModalSessionId,
  object: z.literal('modal_session'),
  livemode: Livemode,
  /** What the iframe loads. */
  url: HttpsUrl,
  expiresAt: Timestamp,
});
export type ModalSession = z.infer<typeof ModalSession>;

// ---- The postMessage protocol -------------------------------------------------------------------------

/**
 * Every message is `{ protocol: 'clear.v1', type, …payload }`, from the frame to the page only.
 *
 * - The frame posts to the exact origin that made the session (never `*`), so another page can't
 *   listen in.
 * - The script accepts a message only when `event.origin` is `https://pay.useclear.org` and
 *   `event.source` is its own iframe's window, and only if it parses below. Anything else is ignored.
 * - Each message is strict: one with a field it doesn't list fails to parse, so nothing else (a
 *   phone, an email, a code, a name, a balance, a term) can ride along by mistake.
 */
export const PROTOCOL = 'clear.v1';
export const PAY_ORIGIN = 'https://pay.useclear.org';

const message = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ protocol: z.literal(PROTOCOL), type: z.literal(type), ...shape });

export const MODAL_ERROR_CODES = [
  'session_expired', // the session ran out before it was paid; the script can start another
  'origin_not_allowed', // the page isn't one of the shop's allowed websites
  'unavailable', // Clear couldn't open the modal; the page should offer its other ways to pay
] as const;

/** The frame has drawn its first screen; the script hides its own loading state. */
export const ReadyMessage = message('ready', {});
/** The frame's content height, in CSS pixels: the bottom sheet takes it, up to the viewport. */
export const ResizeMessage = message('resize', { height: z.number().int().min(0).max(10_000) });
/**
 * Paid. Exactly the payment's id, status and reference, which is all `onSuccess` gets. The shop's
 * server fulfils from the `payment.succeeded` webhook, not from this.
 */
export const SuccessMessage = message('success', {
  id: PaymentId,
  status: z.enum(['succeeded', 'processing']),
  reference: Reference.nullable(),
});
/** Closed without paying: Close, Esc, or "Back to the shop" before paying. */
export const CancelMessage = message('cancel', {});
export const ErrorMessage = message('error', { code: z.enum(MODAL_ERROR_CODES), message: z.string().max(200) });

export const ModalMessage = z.discriminatedUnion('type', [ReadyMessage, ResizeMessage, SuccessMessage, CancelMessage, ErrorMessage]);
export type ModalMessage = z.infer<typeof ModalMessage>;

/** What `onSuccess` is called with. */
export type ModalResult = Pick<z.infer<typeof SuccessMessage>, 'id' | 'status' | 'reference'>;
