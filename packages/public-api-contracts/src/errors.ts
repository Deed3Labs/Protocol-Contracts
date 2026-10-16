import { z } from 'zod';

/**
 * Errors. Every failed `/v1` request answers `{ error: { type, code, message, param? } }`. `type` and
 * `code` are stable and safe to branch on; `message` is for people and may be reworded. Codes are only
 * ever added.
 */

export const ERROR_TYPES = [
  'invalid_request', // the request is wrong: fix it and send it again
  'authentication', // no key, or a key that isn't one
  'permission', // a real key that can't do this (a publishable key, a site not on the list)
  'not_found',
  'conflict', // the object's state doesn't allow it, or an idempotency key was reused
  'rate_limit',
  'api', // Clear's fault; safe to retry with the same idempotency key
] as const;
export const ErrorType = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorType>;

/** Each code, its type and its HTTP status. */
export const ERROR_CODES = {
  parameter_missing: { type: 'invalid_request', status: 400 },
  parameter_invalid: { type: 'invalid_request', status: 400 },
  parameter_unknown: { type: 'invalid_request', status: 400 },
  amount_too_small: { type: 'invalid_request', status: 400 },
  amount_too_large: { type: 'invalid_request', status: 400 },
  lines_exceed_amount: { type: 'invalid_request', status: 400 },
  metadata_invalid: { type: 'invalid_request', status: 400 },
  quantity_not_allowed: { type: 'invalid_request', status: 400 },
  partial_refund_unsupported: { type: 'invalid_request', status: 400 },
  refund_exceeds_payment: { type: 'invalid_request', status: 400 },
  webhook_url_invalid: { type: 'invalid_request', status: 400 },
  idempotency_key_required: { type: 'invalid_request', status: 400 },
  version_unknown: { type: 'invalid_request', status: 400 },
  key_missing: { type: 'authentication', status: 401 },
  key_invalid: { type: 'authentication', status: 401 },
  key_expired: { type: 'authentication', status: 401 },
  publishable_key_not_allowed: { type: 'permission', status: 403 },
  origin_not_allowed: { type: 'permission', status: 403 },
  method_unavailable: { type: 'permission', status: 403 },
  payment_not_found: { type: 'not_found', status: 404 },
  price_not_found: { type: 'not_found', status: 404 },
  payment_link_not_found: { type: 'not_found', status: 404 },
  refund_not_found: { type: 'not_found', status: 404 },
  webhook_endpoint_not_found: { type: 'not_found', status: 404 },
  route_not_found: { type: 'not_found', status: 404 },
  idempotency_key_reused: { type: 'conflict', status: 409 },
  reference_taken: { type: 'conflict', status: 409 },
  price_inactive: { type: 'conflict', status: 409 },
  payment_link_inactive: { type: 'conflict', status: 409 },
  payment_link_expired: { type: 'conflict', status: 409 },
  payment_not_cancelable: { type: 'conflict', status: 409 },
  payment_not_refundable: { type: 'conflict', status: 409 },
  rate_limited: { type: 'rate_limit', status: 429 },
  internal_error: { type: 'api', status: 500 },
} as const satisfies Record<string, { type: ErrorType; status: number }>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];
export const ErrorCode = z.enum(ERROR_CODE_LIST as [ErrorCode, ...ErrorCode[]]);

export const ApiError = z.object({
  type: ErrorType,
  code: ErrorCode,
  message: z.string(),
  /** The request field at fault, as a dotted path: `lines.1.amount`. */
  param: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorResponse = z.object({ error: ApiError });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const apiError = (code: ErrorCode, message: string, param?: string): ApiError => ({
  type: ERROR_CODES[code].type,
  code,
  message,
  ...(param ? { param } : {}),
});

/**
 * A request that fails its schema, as the error to send: the first issue, with its field. A schema
 * names its own code for a rule (`lines_exceed_amount`) through the issue's `params.code`.
 */
export function fromZodError(err: z.ZodError): ApiError {
  const issue = err.issues[0];
  const param = issue?.path.length ? issue.path.join('.') : undefined;
  const named = (issue as { params?: { code?: string } } | undefined)?.params?.code;
  if (named && named in ERROR_CODES) return apiError(named as ErrorCode, issue!.message, param);
  if (issue?.code === 'unrecognized_keys') {
    const key = issue.keys[0];
    return apiError('parameter_unknown', `Unknown parameter: ${key}`, [...issue.path, key].join('.'));
  }
  const missing = issue?.code === 'invalid_type' && /received undefined/.test(issue.message);
  return apiError(missing ? 'parameter_missing' : 'parameter_invalid', issue?.message ?? 'The request is invalid', param);
}
