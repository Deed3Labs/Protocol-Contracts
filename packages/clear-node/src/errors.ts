import type { ErrorCode, ErrorType } from '@clear/public-api-contracts';

/**
 * Every failed request throws a `ClearError`. `type` and `code` are Clear's, stable and safe to branch
 * on (`err.code === 'reference_taken'`); `message` is for people. `connection_error` is the SDK's own
 * code, for a request that never got an answer from Clear (after its retries).
 */
export type ClearErrorCode = ErrorCode | 'connection_error';

export class ClearError extends Error {
  readonly type: ErrorType;
  readonly code: ClearErrorCode;
  /** The request field at fault, as a dotted path: `lines.1.amount`. */
  readonly param: string | undefined;
  /** The HTTP status, or null when there was no answer (or the error came before a request). */
  readonly status: number | null;
  /** Clear's `Request-Id` for the request, when it answered with one. Quote it when you write to us. */
  readonly requestId: string | null;

  constructor(fields: {
    type: ErrorType;
    code: ClearErrorCode;
    message: string;
    param?: string;
    status?: number | null;
    requestId?: string | null;
    cause?: unknown;
  }) {
    super(fields.message, fields.cause === undefined ? undefined : { cause: fields.cause });
    this.name = 'ClearError';
    this.type = fields.type;
    this.code = fields.code;
    this.param = fields.param;
    this.status = fields.status ?? null;
    this.requestId = fields.requestId ?? null;
  }
}

/** A webhook whose signature doesn't check out. Answer it with a 400 and don't act on it. */
export class ClearSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClearSignatureError';
  }
}
