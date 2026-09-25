import { z } from 'zod';

/**
 * Money is integer cents, everywhere. No floats anywhere money is stored or computed
 * (card-processing prompt, principle 1). A schema that accepts 12.5 is a bug in the schema.
 */
export const Cents = z.number().int().safe();
export const NonNegativeCents = Cents.min(0);
export const PositiveCents = Cents.min(1);

/** A shop is its wallet address, as everywhere else in the merchant API. */
export const ShopId = z.string().min(1);

/** Server-generated ids: `ord_…`, `tnd_…`, `stf_…`. Opaque to the app. */
export const Id = z.string().min(1);

/** ISO 8601, with a zone. */
export const Timestamp = z.iso.datetime({ offset: true });
/** A business date in the shop's own time zone: `2026-09-22`. */
export const BusinessDate = z.iso.date();

/**
 * Every money-moving call carries one. A retry with the same key never charges, refunds, captures
 * or posts twice (principle 3).
 */
export const IdempotencyKey = z.string().min(8).max(200);

export const ROLES = ['counter', 'manager', 'owner'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export type Cents = z.infer<typeof Cents>;
