import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  formatSignatureHeader,
  parseSignatureHeader,
  SIGNATURE_TOLERANCE_SECONDS,
  signedPayload,
  timestampFresh,
  type Event,
} from '@clear/public-api-contracts';
import { ClearSignatureError } from './errors';

/** The raw request body, exactly as it arrived: a Buffer (`express.raw()`), bytes, or a string. */
export type RawBody = string | Uint8Array;

export type VerifyOptions = {
  /** How far the signature's time may be from now. Five minutes unless you say otherwise. */
  toleranceSeconds?: number;
  /** "Now", for tests: a Date or unix seconds. */
  now?: Date | number;
};

const hmacHex = (secret: string, payload: string) => createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

const unixSeconds = (now: Date | number | undefined) =>
  now === undefined ? Math.floor(Date.now() / 1000) : now instanceof Date ? Math.floor(now.getTime() / 1000) : Math.floor(now);

function bodyText(rawBody: unknown): string {
  if (typeof rawBody === 'string') return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength).toString('utf8');
  throw new ClearSignatureError(
    rawBody && typeof rawBody === 'object'
      ? 'The body was already parsed. Verify the raw body: use express.raw({ type: "*/*" }) on this route, not express.json().'
      : 'There is no body to verify.',
  );
}

export class Webhooks {
  readonly #secret: () => string | undefined;

  constructor(secret: () => string | undefined) {
    this.#secret = secret;
  }

  /**
   * Checks a delivery's `Clear-Signature` and returns its event. Throws `ClearSignatureError` when it
   * doesn't check out; answer that with a 400 and don't act on it.
   *
   * The secret is the endpoint's `whsec_…`: this argument, else the client's `webhookSecret` option,
   * else `CLEAR_WEBHOOK_SECRET`.
   */
  verify(rawBody: RawBody, signatureHeader: string | string[] | null | undefined, secret?: string, options: VerifyOptions = {}): Event {
    const header = Array.isArray(signatureHeader) ? signatureHeader.join(',') : signatureHeader;
    if (!header) throw new ClearSignatureError('No Clear-Signature header. Only Clear signs these deliveries; refuse anything without one.');

    const key = secret ?? this.#secret();
    if (!key) {
      throw new ClearSignatureError(
        "No webhook secret to check with. Pass the endpoint's whsec_… secret, or set webhookSecret or CLEAR_WEBHOOK_SECRET.",
      );
    }

    const parsed = parseSignatureHeader(header);
    if (!parsed) throw new ClearSignatureError('The Clear-Signature header is not one Clear sends (t=…,v1=…).');

    const now = unixSeconds(options.now);
    const tolerance = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
    // `timestampFresh` is the contracts' five minutes; a tolerance of your own is checked the same way.
    const fresh = tolerance === SIGNATURE_TOLERANCE_SECONDS ? timestampFresh(parsed.timestamp, now) : Math.abs(now - parsed.timestamp) <= tolerance;
    if (!fresh) {
      throw new ClearSignatureError(`The signature's time is more than ${tolerance} seconds from now. Check this server's clock, or it's a replay.`);
    }

    const text = bodyText(rawBody);
    const expected = Buffer.from(hmacHex(key, signedPayload(parsed.timestamp, text)), 'hex');
    const matches = parsed.signatures.some((sig) => {
      const given = Buffer.from(sig, 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!matches) {
      throw new ClearSignatureError(
        "No signature matches. Check it's this endpoint's secret and that the body is the raw bytes Clear sent, not re-serialized JSON.",
      );
    }

    try {
      return JSON.parse(text) as Event;
    } catch {
      throw new ClearSignatureError('The body is signed but is not JSON.');
    }
  }

  /**
   * A `Clear-Signature` header for `payload`, as Clear would send it. For testing your own handler:
   * post the same payload string with this header.
   */
  sign(payload: string | object, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return formatSignatureHeader(timestamp, [hmacHex(secret, signedPayload(timestamp, text))]);
  }
}
