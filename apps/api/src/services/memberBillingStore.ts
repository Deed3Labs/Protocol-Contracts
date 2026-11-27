import type { Pool } from 'pg';
import { getPostgresPool } from '../config/postgres.js';

export type MemberBillingMode = 'payment' | 'subscription';
export type MemberBillingPlan = 'YEARLY' | 'LIFETIME';

export interface MemberBillingCustomer {
  memberId: number;
  stripeCustomerId: string;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberBillingCheckoutSession {
  memberId: number;
  stripeSessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: MemberBillingPlan;
  mode: MemberBillingMode;
  status: string | null;
  paymentStatus: string | null;
  checkoutUrl: string | null;
  createdAt: Date;
  completedAt: Date | null;
  payload: unknown;
}

export interface MemberBillingSubscription {
  memberId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  plan: MemberBillingPlan;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastInvoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberBillingPayment {
  id: number;
  memberId: number;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeCheckoutSessionId: string | null;
  plan: MemberBillingPlan;
  amountTotal: number | null;
  currency: string | null;
  status: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberBillingSummary {
  customer: MemberBillingCustomer | null;
  latestCheckoutSession: MemberBillingCheckoutSession | null;
  subscription: MemberBillingSubscription | null;
  latestPayment: MemberBillingPayment | null;
}

const TABLE_CUSTOMERS = 'member_billing_customers';
const TABLE_CHECKOUT_SESSIONS = 'member_billing_checkout_sessions';
const TABLE_SUBSCRIPTIONS = 'member_billing_subscriptions';
const TABLE_PAYMENTS = 'member_billing_payments';
const TABLE_EVENTS = 'stripe_membership_webhook_events';

type BillingCustomerRow = {
  member_id: string | number;
  stripe_customer_id: string;
  email: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BillingCheckoutSessionRow = {
  member_id: string | number;
  stripe_session_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: MemberBillingPlan;
  mode: MemberBillingMode;
  status: string | null;
  payment_status: string | null;
  checkout_url: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  payload: unknown;
};

type BillingSubscriptionRow = {
  member_id: string | number;
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  plan: MemberBillingPlan;
  status: string;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
  last_invoice_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BillingPaymentRow = {
  id: string | number;
  member_id: string | number;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  stripe_checkout_session_id: string | null;
  plan: MemberBillingPlan;
  amount_total: string | number | null;
  currency: string | null;
  status: string;
  payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function mapCustomer(row: BillingCustomerRow): MemberBillingCustomer {
  return {
    memberId: parseNumber(row.member_id) ?? 0,
    stripeCustomerId: row.stripe_customer_id,
    email: row.email,
    createdAt: parseDate(row.created_at) ?? new Date(0),
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

function mapCheckoutSession(row: BillingCheckoutSessionRow): MemberBillingCheckoutSession {
  return {
    memberId: parseNumber(row.member_id) ?? 0,
    stripeSessionId: row.stripe_session_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    plan: row.plan,
    mode: row.mode,
    status: row.status,
    paymentStatus: row.payment_status,
    checkoutUrl: row.checkout_url,
    createdAt: parseDate(row.created_at) ?? new Date(0),
    completedAt: parseDate(row.completed_at),
    payload: row.payload,
  };
}

function mapSubscription(row: BillingSubscriptionRow): MemberBillingSubscription {
  return {
    memberId: parseNumber(row.member_id) ?? 0,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: parseDate(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    lastInvoiceId: row.last_invoice_id,
    createdAt: parseDate(row.created_at) ?? new Date(0),
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

function mapPayment(row: BillingPaymentRow): MemberBillingPayment {
  return {
    id: parseNumber(row.id) ?? 0,
    memberId: parseNumber(row.member_id) ?? 0,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    plan: row.plan,
    amountTotal: parseNumber(row.amount_total),
    currency: row.currency,
    status: row.status,
    payload: row.payload,
    createdAt: parseDate(row.created_at) ?? new Date(0),
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

export class MemberBillingStore {
  private schemaReadyPromise: Promise<void> | null = null;

  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  }

  async ensureReady(): Promise<void> {
    if (!getPostgresPool()) {
      throw new Error('Postgres is not configured. Set DATABASE_URL for membership billing.');
    }
    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.ensureSchema();
    }
    return this.schemaReadyPromise;
  }

  async getCustomerByMemberId(memberId: number): Promise<MemberBillingCustomer | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCustomerRow>(
      `SELECT * FROM ${TABLE_CUSTOMERS} WHERE member_id = $1 LIMIT 1`,
      [memberId]
    );
    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }

  async getCustomerByStripeCustomerId(stripeCustomerId: string): Promise<MemberBillingCustomer | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCustomerRow>(
      `SELECT * FROM ${TABLE_CUSTOMERS} WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId]
    );
    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }

  async upsertCustomer(input: {
    memberId: number;
    stripeCustomerId: string;
    email?: string | null;
  }): Promise<MemberBillingCustomer> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCustomerRow>(
      `
      INSERT INTO ${TABLE_CUSTOMERS} (
        member_id,
        stripe_customer_id,
        email
      ) VALUES ($1,$2,$3)
      ON CONFLICT (member_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        email = EXCLUDED.email,
        updated_at = NOW()
      RETURNING *
      `,
      [input.memberId, input.stripeCustomerId, input.email ?? null]
    );
    return mapCustomer(result.rows[0]);
  }

  async upsertCheckoutSession(input: {
    memberId: number;
    stripeSessionId: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    plan: MemberBillingPlan;
    mode: MemberBillingMode;
    status?: string | null;
    paymentStatus?: string | null;
    checkoutUrl?: string | null;
    payload?: unknown;
  }): Promise<MemberBillingCheckoutSession> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCheckoutSessionRow>(
      `
      INSERT INTO ${TABLE_CHECKOUT_SESSIONS} (
        member_id,
        stripe_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        plan,
        mode,
        status,
        payment_status,
        checkout_url,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (stripe_session_id)
      DO UPDATE SET
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, ${TABLE_CHECKOUT_SESSIONS}.stripe_customer_id),
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, ${TABLE_CHECKOUT_SESSIONS}.stripe_subscription_id),
        status = EXCLUDED.status,
        payment_status = EXCLUDED.payment_status,
        checkout_url = COALESCE(EXCLUDED.checkout_url, ${TABLE_CHECKOUT_SESSIONS}.checkout_url),
        payload = COALESCE(EXCLUDED.payload, ${TABLE_CHECKOUT_SESSIONS}.payload),
        completed_at = CASE
          WHEN EXCLUDED.status = 'complete' OR EXCLUDED.payment_status = 'paid' THEN NOW()
          ELSE ${TABLE_CHECKOUT_SESSIONS}.completed_at
        END
      RETURNING *
      `,
      [
        input.memberId,
        input.stripeSessionId,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.plan,
        input.mode,
        input.status ?? null,
        input.paymentStatus ?? null,
        input.checkoutUrl ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
      ]
    );
    return mapCheckoutSession(result.rows[0]);
  }

  async getCheckoutSessionByStripeSessionId(stripeSessionId: string): Promise<MemberBillingCheckoutSession | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCheckoutSessionRow>(
      `SELECT * FROM ${TABLE_CHECKOUT_SESSIONS} WHERE stripe_session_id = $1 LIMIT 1`,
      [stripeSessionId]
    );
    return result.rows[0] ? mapCheckoutSession(result.rows[0]) : null;
  }

  async upsertSubscription(input: {
    memberId: number;
    stripeSubscriptionId: string;
    stripeCustomerId?: string | null;
    plan: MemberBillingPlan;
    status: string;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
    lastInvoiceId?: string | null;
  }): Promise<MemberBillingSubscription> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingSubscriptionRow>(
      `
      INSERT INTO ${TABLE_SUBSCRIPTIONS} (
        member_id,
        stripe_subscription_id,
        stripe_customer_id,
        plan,
        status,
        current_period_end,
        cancel_at_period_end,
        last_invoice_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (stripe_subscription_id)
      DO UPDATE SET
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, ${TABLE_SUBSCRIPTIONS}.stripe_customer_id),
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        last_invoice_id = COALESCE(EXCLUDED.last_invoice_id, ${TABLE_SUBSCRIPTIONS}.last_invoice_id),
        updated_at = NOW()
      RETURNING *
      `,
      [
        input.memberId,
        input.stripeSubscriptionId,
        input.stripeCustomerId ?? null,
        input.plan,
        input.status,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ?? false,
        input.lastInvoiceId ?? null,
      ]
    );
    return mapSubscription(result.rows[0]);
  }

  async getSubscriptionByStripeSubscriptionId(stripeSubscriptionId: string): Promise<MemberBillingSubscription | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingSubscriptionRow>(
      `SELECT * FROM ${TABLE_SUBSCRIPTIONS} WHERE stripe_subscription_id = $1 LIMIT 1`,
      [stripeSubscriptionId]
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async getLatestSubscriptionByMemberId(memberId: number): Promise<MemberBillingSubscription | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingSubscriptionRow>(
      `
      SELECT * FROM ${TABLE_SUBSCRIPTIONS}
      WHERE member_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [memberId]
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async upsertPayment(input: {
    memberId: number;
    stripePaymentIntentId?: string | null;
    stripeInvoiceId?: string | null;
    stripeCheckoutSessionId?: string | null;
    plan: MemberBillingPlan;
    amountTotal?: number | null;
    currency?: string | null;
    status: string;
    payload?: unknown;
  }): Promise<MemberBillingPayment> {
    await this.ensureReady();
    const pool = this.mustPool();
    const conflictColumn = input.stripePaymentIntentId
      ? 'stripe_payment_intent_id'
      : input.stripeInvoiceId
        ? 'stripe_invoice_id'
        : 'stripe_checkout_session_id';
    const conflictValue =
      input.stripePaymentIntentId ??
      input.stripeInvoiceId ??
      input.stripeCheckoutSessionId;

    if (!conflictValue) {
      throw new Error('A Stripe payment, invoice, or checkout session identifier is required');
    }

    const result = await pool.query<BillingPaymentRow>(
      `
      INSERT INTO ${TABLE_PAYMENTS} (
        member_id,
        stripe_payment_intent_id,
        stripe_invoice_id,
        stripe_checkout_session_id,
        plan,
        amount_total,
        currency,
        status,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      ON CONFLICT (${conflictColumn})
      DO UPDATE SET
        plan = EXCLUDED.plan,
        amount_total = EXCLUDED.amount_total,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        payload = COALESCE(EXCLUDED.payload, ${TABLE_PAYMENTS}.payload),
        updated_at = NOW()
      RETURNING *
      `,
      [
        input.memberId,
        input.stripePaymentIntentId ?? null,
        input.stripeInvoiceId ?? null,
        input.stripeCheckoutSessionId ?? null,
        input.plan,
        input.amountTotal ?? null,
        input.currency ?? null,
        input.status,
        input.payload ? JSON.stringify(input.payload) : null,
      ]
    );
    return mapPayment(result.rows[0]);
  }

  async getLatestPaymentByMemberId(memberId: number): Promise<MemberBillingPayment | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingPaymentRow>(
      `
      SELECT * FROM ${TABLE_PAYMENTS}
      WHERE member_id = $1
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [memberId]
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async getBillingSummaryByMemberId(memberId: number): Promise<MemberBillingSummary> {
    await this.ensureReady();
    const [customer, latestCheckoutSession, subscription, latestPayment] = await Promise.all([
      this.getCustomerByMemberId(memberId),
      this.getLatestCheckoutSessionByMemberId(memberId),
      this.getLatestSubscriptionByMemberId(memberId),
      this.getLatestPaymentByMemberId(memberId),
    ]);

    return {
      customer,
      latestCheckoutSession,
      subscription,
      latestPayment,
    };
  }

  async getLatestCheckoutSessionByMemberId(memberId: number): Promise<MemberBillingCheckoutSession | null> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query<BillingCheckoutSessionRow>(
      `
      SELECT * FROM ${TABLE_CHECKOUT_SESSIONS}
      WHERE member_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [memberId]
    );
    return result.rows[0] ? mapCheckoutSession(result.rows[0]) : null;
  }

  async registerWebhookEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean> {
    await this.ensureReady();
    const pool = this.mustPool();
    const result = await pool.query(
      `
      INSERT INTO ${TABLE_EVENTS} (
        stripe_event_id,
        event_type,
        payload
      ) VALUES ($1,$2,$3::jsonb)
      ON CONFLICT (stripe_event_id)
      DO NOTHING
      RETURNING stripe_event_id
      `,
      [eventId, eventType, JSON.stringify(payload ?? null)]
    );

    return (result.rowCount ?? 0) > 0;
  }

  private mustPool(): Pool {
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('Postgres pool is unavailable');
    }
    return pool;
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.mustPool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_CUSTOMERS} (
        member_id BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        stripe_customer_id TEXT NOT NULL UNIQUE,
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_CHECKOUT_SESSIONS} (
        stripe_session_id TEXT PRIMARY KEY,
        member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        plan TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT,
        payment_status TEXT,
        checkout_url TEXT,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${TABLE_CHECKOUT_SESSIONS}_member_id
      ON ${TABLE_CHECKOUT_SESSIONS} (member_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_SUBSCRIPTIONS} (
        stripe_subscription_id TEXT PRIMARY KEY,
        member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        stripe_customer_id TEXT,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        last_invoice_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${TABLE_SUBSCRIPTIONS}_member_id
      ON ${TABLE_SUBSCRIPTIONS} (member_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_PAYMENTS} (
        id BIGSERIAL PRIMARY KEY,
        member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        stripe_payment_intent_id TEXT UNIQUE,
        stripe_invoice_id TEXT UNIQUE,
        stripe_checkout_session_id TEXT UNIQUE,
        plan TEXT NOT NULL,
        amount_total BIGINT,
        currency TEXT,
        status TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${TABLE_PAYMENTS}_member_id
      ON ${TABLE_PAYMENTS} (member_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_EVENTS} (
        stripe_event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }
}

export const memberBillingStore = new MemberBillingStore();
