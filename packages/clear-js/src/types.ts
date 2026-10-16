/** What `onSuccess` gets: the payment's id, status and reference, and nothing else. */
export interface PaymentResult {
  id: string;
  status: 'succeeded' | 'processing';
  reference: string | null;
}

/**
 * What `onError` gets. `code` is the API's error code (`origin_not_allowed`, `price_not_found`…), the
 * frame's (`session_expired`, `origin_not_allowed`, `unavailable`), or the script's own:
 * `insecure_page`, `invalid_options`, `network_error`, `invalid_response`.
 */
export interface ClearError {
  code: string;
  message: string;
}

export type PaymentMethod = 'clear' | 'card';

/** What to pay for: a price from the merchant app, or a payment the shop's server made. */
export type PayTarget = { price: string; quantity?: number } | { payment: string };

/** What the shop may set. These travel in the modal session; the page never sends the frame anything. */
export interface ModalOptions {
  /** `#B4532A`: buttons and links. Clear's ink is used when it fails a contrast check. */
  accent?: string;
  /** An https URL. */
  logo?: string;
  /** BCP 47. */
  locale?: string;
  /** Both unless you pick one. */
  methods?: PaymentMethod[];
  /** Fills in "Email or phone". */
  email?: string;
}

export interface Callbacks {
  onSuccess?: (payment: PaymentResult) => void;
  onCancel?: () => void;
  onError?: (error: ClearError) => void;
}

export type AttachOptions = ModalOptions & Callbacks;

/** The options for `Clear(key, options)`. */
export interface ClearConfig {
  /** `https://api.useclear.org` unless you say. */
  apiBase?: string;
  /** `https://pay.useclear.org`. Another origin only with a test key, for local development. */
  payOrigin?: string;
}

export interface Attachment {
  /** Stops listening for clicks. An open modal stays open. */
  detach(): void;
  /** Opens the modal as a click would. Does nothing while one is open. */
  open(): void;
}

export type Target = string | Element | ArrayLike<Element>;

export interface ClearInstance {
  readonly mode: 'test' | 'live';
  attach(target: Target, options: PayTarget & AttachOptions): Attachment;
  attach(target: Target, pay: PayTarget, options?: AttachOptions): Attachment;
}
