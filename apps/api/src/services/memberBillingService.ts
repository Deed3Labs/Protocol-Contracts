import crypto from 'crypto';
import { memberBillingStore, type MemberBillingPlan, type MemberBillingSummary } from './memberBillingStore.js';
import { memberStore, type MemberMembershipPlan, type MemberRecord } from './memberStore.js';
import { membershipRegistryService } from './membershipRegistryService.js';

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  customer?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | null;
  mode?: 'payment' | 'subscription';
  status?: string | null;
  payment_status?: string | null;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string | undefined> | null;
};

type StripeSubscription = {
  id: string;
  customer?: string | null;
  status?: string;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  latest_invoice?: string | null;
  metadata?: Record<string, string | undefined> | null;
};

type StripeInvoice = {
  id: string;
  customer?: string | null;
  subscription?: string | null;
  payment_intent?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  metadata?: Record<string, string | undefined> | null;
};

type StripeEvent = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

function stripeSecretKey(): string {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

function stripeWebhookSecret(): string {
  return (process.env.STRIPE_MEMBERSHIP_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

function priceIdForPlan(plan: MemberBillingPlan): string {
  if (plan === 'LIFETIME') {
    return (process.env.STRIPE_LIFETIME_MEMBERSHIP_PRICE_ID || '').trim();
  }
  return (process.env.STRIPE_YEARLY_MEMBERSHIP_PRICE_ID || '').trim();
}

function assertStripePriceId(value: string, plan: MemberBillingPlan): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Stripe price is not configured for ${plan}`);
  }

  if (trimmed.startsWith('prod_')) {
    throw new Error(
      `Stripe ${plan.toLowerCase()} membership value must be a Price ID (price_...), not a Product ID (prod_...)`
    );
  }

  if (!trimmed.startsWith('price_')) {
    throw new Error(
      `Stripe ${plan.toLowerCase()} membership value must be a Price ID starting with price_`
    );
  }

  return trimmed;
}

function normalizePlan(plan: MemberMembershipPlan | string | null | undefined): MemberBillingPlan | null {
  const normalized = (plan || '').trim().toUpperCase();
  if (normalized === 'YEARLY' || normalized === 'LIFETIME') {
    return normalized;
  }
  return null;
}

function parsePositiveInt(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assertHttpUrl(value: string, fieldName: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${fieldName} must use http or https`);
  }

  return url.toString();
}

async function stripeRequestJson<T>(
  path: string,
  init: RequestInit & { formData?: URLSearchParams } = {}
): Promise<T> {
  const secretKey = stripeSecretKey();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${secretKey}`);
  if (init.formData) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  } else if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers,
    body: init.formData ? init.formData.toString() : init.body,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = data as { error?: { message?: unknown } } | null;
    const message =
      typeof errorPayload?.error?.message === 'string'
        ? errorPayload.error.message
        : `Stripe request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string): StripeEvent {
  const secret = stripeWebhookSecret();
  if (!secret) {
    throw new Error('Stripe webhook secret is not configured');
  }

  const parts = signatureHeader.split(',').map((entry) => entry.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    throw new Error('Missing Stripe signature components');
  }

  const timestampMs = Number.parseInt(timestamp, 10) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_TOLERANCE_MS) {
    throw new Error('Stripe webhook timestamp is outside the accepted tolerance');
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const isValid = signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  });

  if (!isValid) {
    throw new Error('Stripe webhook signature verification failed');
  }

  return JSON.parse(rawBody.toString('utf8')) as StripeEvent;
}

async function fetchStripeSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return stripeRequestJson<StripeSubscription>(`/subscriptions/${subscriptionId}`);
}

async function fetchOrCreateStripeCustomer(input: {
  memberId: number;
  email?: string | null;
  name?: string | null;
}): Promise<string> {
  const existingCustomer = await memberBillingStore.getCustomerByMemberId(input.memberId);
  if (existingCustomer) {
    return existingCustomer.stripeCustomerId;
  }

  const formData = new URLSearchParams();
  if (input.email) {
    formData.set('email', input.email);
  }
  if (input.name) {
    formData.set('name', input.name);
  }
  formData.set('metadata[memberId]', String(input.memberId));

  const customer = await stripeRequestJson<{ id: string; email?: string | null }>('/customers', {
    method: 'POST',
    formData,
  });

  await memberBillingStore.upsertCustomer({
    memberId: input.memberId,
    stripeCustomerId: customer.id,
    email: customer.email ?? input.email ?? null,
  });

  return customer.id;
}

function memberIdFromMetadata(metadata: Record<string, string | undefined> | null | undefined): number | null {
  return parsePositiveInt(metadata?.memberId);
}

function planFromMetadata(metadata: Record<string, string | undefined> | null | undefined): MemberBillingPlan | null {
  return normalizePlan(metadata?.plan);
}

export class MemberBillingService {
  isConfigured(): boolean {
    return Boolean(
      stripeSecretKey()
      && priceIdForPlan('YEARLY')
      && priceIdForPlan('LIFETIME')
      && memberBillingStore.isConfigured()
    );
  }

  isWebhookConfigured(): boolean {
    return Boolean(stripeSecretKey() && stripeWebhookSecret() && memberBillingStore.isConfigured());
  }

  async getMembershipSummaryForMember(memberId: number): Promise<MemberBillingSummary> {
    await memberBillingStore.ensureReady();
    return memberBillingStore.getBillingSummaryByMemberId(memberId);
  }

  async createCheckoutSession(input: {
    member: MemberRecord;
    email?: string | null;
    displayName?: string | null;
    plan: MemberBillingPlan;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    if (!this.isConfigured()) {
      throw new Error(
        'Stripe membership billing is not configured. Set STRIPE_SECRET_KEY, STRIPE_YEARLY_MEMBERSHIP_PRICE_ID, STRIPE_LIFETIME_MEMBERSHIP_PRICE_ID, and DATABASE_URL.'
      );
    }

    const successUrl = assertHttpUrl(input.successUrl, 'successUrl');
    const cancelUrl = assertHttpUrl(input.cancelUrl, 'cancelUrl');
    const customerId = await fetchOrCreateStripeCustomer({
      memberId: input.member.id,
      email: input.email ?? null,
      name: input.displayName ?? null,
    });
    const priceId = assertStripePriceId(priceIdForPlan(input.plan), input.plan);

    const formData = new URLSearchParams();
    const mode = input.plan === 'LIFETIME' ? 'payment' : 'subscription';
    formData.set('mode', mode);
    formData.set('customer', customerId);
    formData.set('success_url', successUrl);
    formData.set('cancel_url', cancelUrl);
    formData.set('line_items[0][price]', priceId);
    formData.set('line_items[0][quantity]', '1');
    formData.set('metadata[memberId]', String(input.member.id));
    formData.set('metadata[plan]', input.plan);
    if (mode === 'subscription') {
      formData.set('subscription_data[metadata][memberId]', String(input.member.id));
      formData.set('subscription_data[metadata][plan]', input.plan);
    }

    const session = await stripeRequestJson<StripeCheckoutSession>('/checkout/sessions', {
      method: 'POST',
      formData,
    });

    await memberStore.updateMembershipStateByMemberId(input.member.id, {
      membershipPlan: input.plan,
      membershipStatus: 'PENDING',
    });

    await memberBillingStore.upsertCheckoutSession({
      memberId: input.member.id,
      stripeSessionId: session.id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: session.subscription ?? null,
      plan: input.plan,
      mode,
      status: session.status ?? null,
      paymentStatus: session.payment_status ?? null,
      checkoutUrl: session.url ?? null,
      payload: session,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  async handleWebhook(rawBody: Buffer, signatureHeader: string): Promise<{ handled: boolean; eventType: string }> {
    if (!this.isWebhookConfigured()) {
      throw new Error('Stripe membership webhook is not configured');
    }

    const event = verifyStripeSignature(rawBody, signatureHeader);
    const isNewEvent = await memberBillingStore.registerWebhookEvent(event.id, event.type, event);
    if (!isNewEvent) {
      return { handled: false, eventType: event.type };
    }

    await this.processEvent(event);
    return { handled: true, eventType: event.type };
  }

  private async processEvent(event: StripeEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.expired':
        await this.processCheckoutSessionEvent(event.data?.object as StripeCheckoutSession | undefined);
        return;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.processSubscriptionEvent(event.data?.object as StripeSubscription | undefined);
        return;
      case 'invoice.paid':
        await this.processInvoicePaid(event.data?.object as StripeInvoice | undefined);
        return;
      default:
        return;
    }
  }

  private async processCheckoutSessionEvent(session: StripeCheckoutSession | undefined): Promise<void> {
    if (!session?.id) return;

    const existingSession = await memberBillingStore.getCheckoutSessionByStripeSessionId(session.id);
    const customer = session.customer
      ? await memberBillingStore.getCustomerByStripeCustomerId(session.customer)
      : null;
    const memberId =
      memberIdFromMetadata(session.metadata)
      ?? existingSession?.memberId
      ?? customer?.memberId
      ?? null;
    const plan =
      planFromMetadata(session.metadata)
      ?? existingSession?.plan
      ?? null;

    if (memberId && session.customer) {
      await memberBillingStore.upsertCustomer({
        memberId,
        stripeCustomerId: session.customer,
        email: session.customer_details?.email ?? customer?.email ?? null,
      });
    }

    if (memberId && plan) {
      await memberBillingStore.upsertCheckoutSession({
        memberId,
        stripeSessionId: session.id,
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: session.subscription ?? null,
        plan,
        mode: session.mode === 'payment' ? 'payment' : 'subscription',
        status: session.status ?? null,
        paymentStatus: session.payment_status ?? null,
        checkoutUrl: session.url ?? null,
        payload: session,
      });

      if (session.payment_intent || session.amount_total || session.payment_status) {
        await memberBillingStore.upsertPayment({
          memberId,
          stripePaymentIntentId: session.payment_intent ?? null,
          stripeCheckoutSessionId: session.id,
          plan,
          amountTotal: session.amount_total ?? null,
          currency: session.currency ?? null,
          status: session.payment_status || session.status || 'pending',
          payload: session,
        });
      }
    }

    if (!memberId || !plan) return;

    if (session.mode === 'payment' && session.payment_status === 'paid') {
      await this.activateMembership(memberId, plan, null);
      return;
    }

    if (session.subscription) {
      const subscription = await fetchStripeSubscription(session.subscription);
      await this.processSubscriptionEvent(subscription);
    }
  }

  private async processSubscriptionEvent(subscription: StripeSubscription | undefined): Promise<void> {
    if (!subscription?.id) return;

    const existingSubscription = await memberBillingStore.getSubscriptionByStripeSubscriptionId(subscription.id);
    const customer = subscription.customer
      ? await memberBillingStore.getCustomerByStripeCustomerId(subscription.customer)
      : null;
    const memberId =
      memberIdFromMetadata(subscription.metadata)
      ?? existingSubscription?.memberId
      ?? customer?.memberId
      ?? null;
    const plan =
      planFromMetadata(subscription.metadata)
      ?? existingSubscription?.plan
      ?? 'YEARLY';

    if (!memberId) return;

    await memberBillingStore.upsertSubscription({
      memberId,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer ?? null,
      plan,
      status: subscription.status || 'unknown',
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      lastInvoiceId: subscription.latest_invoice ?? null,
    });

    if (subscription.status === 'active' || subscription.status === 'trialing') {
      await this.activateMembership(
        memberId,
        plan,
        subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null
      );
      return;
    }

    if (subscription.status === 'past_due' || subscription.status === 'incomplete') {
      await memberStore.updateMembershipStateByMemberId(memberId, {
        membershipPlan: plan,
        membershipStatus: 'PENDING',
      });
      return;
    }

    if (
      subscription.status === 'canceled'
      || subscription.status === 'unpaid'
      || subscription.status === 'incomplete_expired'
    ) {
      await this.deactivateMembership(memberId, plan, 'EXPIRED');
    }
  }

  private async processInvoicePaid(invoice: StripeInvoice | undefined): Promise<void> {
    if (!invoice?.id) return;

    if (invoice.subscription) {
      const subscription = await fetchStripeSubscription(invoice.subscription);
      const customer = invoice.customer
        ? await memberBillingStore.getCustomerByStripeCustomerId(invoice.customer)
        : null;
      const existingSubscription = await memberBillingStore.getSubscriptionByStripeSubscriptionId(invoice.subscription);
      const memberId =
        memberIdFromMetadata(invoice.metadata)
        ?? existingSubscription?.memberId
        ?? customer?.memberId
        ?? null;
      const plan =
        planFromMetadata(invoice.metadata)
        ?? existingSubscription?.plan
        ?? 'YEARLY';

      if (memberId) {
        await memberBillingStore.upsertPayment({
          memberId,
          stripePaymentIntentId: invoice.payment_intent ?? null,
          stripeInvoiceId: invoice.id,
          plan,
          amountTotal: invoice.amount_paid ?? null,
          currency: invoice.currency ?? null,
          status: invoice.status || 'paid',
          payload: invoice,
        });
      }

      await this.processSubscriptionEvent(subscription);
    }
  }

  private async activateMembership(
    memberId: number,
    plan: MemberBillingPlan,
    currentPeriodEnd: Date | null
  ): Promise<void> {
    const member = await memberStore.getMemberById(memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found for membership activation`);
    }

    let registryUpdate:
      | { registryMemberId: number; txHash: string; metadataHash: string; chainId: number }
      | null = null;

    if (membershipRegistryService.isConfigured()) {
      registryUpdate = await membershipRegistryService.activateMembership(member, plan, { currentPeriodEnd });
    }

    await memberStore.updateMembershipStateByMemberId(memberId, {
      membershipPlan: plan,
      membershipStatus: 'ACTIVE',
      membershipRegistryMemberId: registryUpdate?.registryMemberId,
      membershipChainId: registryUpdate?.chainId,
      membershipTxHash: registryUpdate?.txHash,
      membershipSyncedAt: registryUpdate ? new Date() : undefined,
      membershipMetadataHash: registryUpdate?.metadataHash,
    });
  }

  private async deactivateMembership(
    memberId: number,
    plan: MemberBillingPlan,
    status: 'EXPIRED' | 'REVOKED'
  ): Promise<void> {
    const member = await memberStore.getMemberById(memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found for membership deactivation`);
    }

    let revokeTxHash: string | null = null;
    if (membershipRegistryService.isConfigured() && member.membershipRegistryMemberId) {
      const revokeResult = await membershipRegistryService.revokeMembership(member);
      revokeTxHash = revokeResult.txHash;
    }

    await memberStore.updateMembershipStateByMemberId(memberId, {
      membershipPlan: plan,
      membershipStatus: status,
      membershipTxHash: revokeTxHash ?? undefined,
      membershipSyncedAt: revokeTxHash ? new Date() : undefined,
    });
  }
}

export const memberBillingService = new MemberBillingService();
