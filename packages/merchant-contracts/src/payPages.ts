import { z } from 'zod';
import { BusinessDate, Id, NonNegativeCents, PositiveCents, Timestamp } from './common';
import { Hex } from './rewards';

/**
 * What `pay.useclear.org` asks the API (pay spec §2–§5): the modal at `/m/:session` and the link page
 * at `/l/:slug`, which share their steps. These routes are Clear's own page talking to Clear, not the
 * public API, so they aren't versioned with `/v1`; nothing here is ever sent to the shop's page.
 *
 * The frame signs a person in with a code or with the approval page, and gets a payment-scoped token
 * (`X-Pay-Session`): good for this payment only, for 30 minutes, kept in memory. There's no cookie.
 */

// ---- What the frame shows ------------------------------------------------------------------------

/** The shop as the modal's header draws it: its logo, its name and the amount. */
export const PayShop = z.object({
  name: z.string(),
  /** "MC": the shop's initials when it has no logo. */
  initials: z.string().max(3),
  logoUrl: z.string().nullable(),
  /** Checked for contrast; null when it failed and Clear's ink is used. */
  accent: Hex.nullable(),
});
export type PayShop = z.infer<typeof PayShop>;

export const PayOrder = z.object({
  lines: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1), lineCents: NonNegativeCents })),
  subtotalCents: NonNegativeCents,
  taxCents: NonNegativeCents,
  totalCents: PositiveCents,
  /** The member screen's one line: "Taco tray for 12, 2 × Agua fresca". */
  summary: z.string(),
});
export type PayOrder = z.infer<typeof PayOrder>;

export const PAY_STATES = ['open', 'paid', 'expired', 'canceled'] as const;

/** `GET /api/checkout/:session`: what the modal opens on. */
export const PaySession = z.object({
  id: Id,
  livemode: z.boolean(),
  shop: PayShop,
  order: PayOrder,
  /** Card only when the shop's card processor is connected and the page allows it. */
  methods: z.object({ clear: z.boolean(), card: z.boolean() }),
  /** Over time is offered (the shop allows it, the order is $50 or more, and it's on in this mode). */
  overTime: z.boolean(),
  /** "micasatacos.com": for "Done. Go back to micasatacos.com". Null on the link page. */
  shopHost: z.string().nullable(),
  /** The link page's note and expiry; null in the modal. */
  link: z.object({ note: z.string().nullable(), expiresAt: Timestamp.nullable() }).nullable(),
  state: z.enum(PAY_STATES),
  expiresAt: Timestamp,
});
export type PaySession = z.infer<typeof PaySession>;

/**
 * `GET /api/l/:slug`: the link page, before anyone has started paying. Paying starts a session
 * (`POST /api/l/:slug/session`), which makes the link's order; the page then uses the session's routes.
 */
export const PublicLink = z.object({
  slug: z.string(),
  shop: PayShop,
  order: PayOrder,
  note: z.string().nullable(),
  expiresAt: Timestamp.nullable(),
  state: z.enum(['open', 'expired', 'inactive']),
  methods: z.object({ clear: z.boolean(), card: z.boolean() }),
});
export type PublicLink = z.infer<typeof PublicLink>;
export const LinkSessionStarted = z.object({ session: Id });

// ---- Signing in ----------------------------------------------------------------------------------

/**
 * `POST /api/checkout/:session/contact`. Whatever was typed, everyone gets the same answer and the same
 * screen ("Check your phone" or "Check your email"): a code, and a link to the approval page. Whether
 * the number has a Clear account is never in the answer.
 */
export const PayContact = z.object({ contact: z.string().trim().min(3).max(254) });
export const ContactSent = z.object({
  channel: z.enum(['phone', 'email']),
  /** "(909) •••-0188", "s•••@gmail.com". */
  to: z.string(),
  resendInSeconds: z.number().int().min(0),
});
export type ContactSent = z.infer<typeof ContactSent>;

/**
 * `POST /api/checkout/:session/code`. Six digits; five tries; ten minutes. The token is for this payment
 * only. A member gets their first name; a contact on no account is "new" ("(909) 555-0188 is confirmed").
 */
export const PayCode = z.object({ code: z.string().regex(/^\d{6}$/, 'The code is six digits') });
export const CodeVerified = z.object({
  token: z.string(),
  person: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('member'), firstName: z.string() }),
    z.object({ kind: z.literal('new'), contact: z.string() }),
  ]),
});
export type CodeVerified = z.infer<typeof CodeVerified>;

/**
 * `GET /api/checkout/:session/status`, polled every 3 seconds while a screen waits: for the texted link,
 * the approval window, the join window or a card.
 */
export const PayStatus = z.object({
  state: z.enum(['waiting', 'paid', 'expired', 'canceled']),
  paid: z.lazy(() => PaidView).nullable(),
});
export type PayStatus = z.infer<typeof PayStatus>;

// ---- The member's screen -------------------------------------------------------------------------

/**
 * `GET /api/checkout/:session/member` (token): "Hi Sofia", the choices and their figures. Splits come from
 * the member's terms through `@clear/domain` (`splitsOffered`, `splitQuote`); the shop never sees this.
 */
export const MemberQuote = z.object({
  firstName: z.string(),
  totalCents: PositiveCents,
  canPayNow: z.boolean(),
  /** Empty when over time isn't offered (the flag, the shop, the minimum or the member's terms). */
  splits: z.array(
    z.object({
      installments: z.number().int().min(1),
      perCycleCents: PositiveCents,
      carryCents: NonNegativeCents,
      totalCents: PositiveCents,
      /** "2% a cycle". */
      ratePerCycleBps: z.number().int().min(0),
    }),
  ),
  /** "Chase •••• 4471"; null when no bank is linked. */
  clearsFrom: z.string().nullable(),
  /** "Earns 256 points at Mi Casa · 1.5× for paying with Clear"; null when the shop has no app or they haven't joined. */
  points: z
    .object({ earns: z.number().int().min(0), shopName: z.string(), multiplierLabel: z.string().nullable(), before: z.number().int(), after: z.number().int() })
    .nullable(),
});
export type MemberQuote = z.infer<typeof MemberQuote>;

/**
 * `POST /api/checkout/:session/approve` (token, and `X-Step-Up` when the member has a passkey): over time,
 * in the frame. The server opens the plan, as it does when the Clear app approves.
 */
export const ApproveOverTime = z.object({ installments: z.number().int().min(2), idempotencyKey: z.string().min(8).max(200) });

/**
 * `POST /api/checkout/:session/approval`: the approval page's address, which the frame opens with
 * `window.open`. On a phone it's "Approve with Clear"; from the member's screen, it's Pay now, which
 * the member's own wallet signs there.
 */
export const ApprovalPage = z.object({ url: z.string().url() });

/** "You're all set": how it was paid, the first cycle when it's split, the points. */
export const PaidView = z.object({
  method: z.enum(['clear', 'card']),
  installments: z.number().int().min(1).nullable(),
  /** "The first of 4 cycles, $48.65, clears Nov 1." Null when paid in full. */
  firstCycle: z.object({ amountCents: PositiveCents, on: BusinessDate }).nullable(),
  points: z.object({ earned: z.number().int().min(0), now: z.number().int().min(0) }).nullable(),
  /** "In Clear and by email". */
  receipt: z.string(),
});
export type PaidView = z.infer<typeof PaidView>;

// ---- Joining (§3) ----------------------------------------------------------------------------------

/**
 * `POST /api/checkout/:session/join` (token, a new person): step 1's basics, kept on the session, encrypted,
 * for 30 minutes. Never an SSN: that's step 2, in Clear's own window.
 */
export const JoinBasics = z.object({
  legalName: z.string().trim().min(2).max(120),
  dateOfBirth: z.iso.date(),
  zip: z.string().regex(/^\d{5}$/, 'A ZIP is five digits'),
  street: z.string().trim().min(3).max(200),
});
/** Step 2: the window's address (single use, 15 minutes), also drawn as a QR on a computer. */
export const JoinHandoff = z.object({ url: z.string().url(), expiresAt: Timestamp });
/** `GET /api/checkout/:session/join`: polled while the window is open. */
export const JoinState = z.object({ state: z.enum(['waiting', 'done', 'failed', 'expired']) });

// ---- Card (§3) ------------------------------------------------------------------------------------

/**
 * `POST /api/checkout/:session/card`: a PaymentIntent on the shop's own connected account, for Stripe's
 * fields in the frame. The amount is the order's; Clear's fee is set on the server.
 */
export const CardStarted = z.object({
  clientSecret: z.string(),
  /** The connected account (`acct_…`), for Stripe.js's `stripeAccount`. */
  stripeAccount: z.string(),
  /** Clear's platform publishable key for this mode. */
  publishableKey: z.string(),
  amountCents: PositiveCents,
});
export type CardStarted = z.infer<typeof CardStarted>;

/** The approval page's view of a payment it approves (`app.useclear.org/approve/:id`). */
export const ApprovalView = z.object({
  id: Id,
  shop: PayShop,
  order: PayOrder,
  /** "MI CASA TACOS IS ASKING · ONLINE". */
  channel: z.enum(['online', 'link']),
  /** The shop's allowed website to go back to, when the payment came from one. */
  returnUrl: z.string().url().nullable(),
  chargeCode: z.string(),
});
export type ApprovalView = z.infer<typeof ApprovalView>;
