import type { OnboardingApi } from '@clear/member-kit/onboarding/submit';
import type {
  ChargeReward,
  IdentityCode,
  Joined,
  Membership,
  MyShops,
  Partners,
  Person,
  PublicPayStarted,
  PublicShopApp,
  RewardClaim,
  RewardsMe,
  ShopActivity,
  ShopBill,
  ShopPaid,
} from '@clear/merchant-contracts';

/**
 * A Clear charge as the approve sheet shows it (section 9's last frame): the shop asking, its lines,
 * the reward already on it, and what it earns. Read from the Clear app's own charge route.
 */
export interface ChargeView {
  code: string;
  shopName: string;
  table: string | null;
  amountCents: number;
  lines: Array<{ name: string; quantity: number; lineCents: number }>;
  taxCents: number;
  reward: (ChargeReward & { amountCents: number }) | null;
  earnsPoints: number | null;
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled';
}

/** What a screen can read and do. The preview reads a seeded mock; the live app, the API. */
export interface RewardsData {
  shop(slug: string): Promise<PublicShopApp>;
  me(slug: string): Promise<RewardsMe>;
  /** Their Clear balance, Spendable; null without Clear. Read as the Clear app reads it. */
  balanceCents(): Promise<number | null>;
  person(): Promise<Person | null>;
  createPerson(firstName: string): Promise<Person>;
  deletePerson(): Promise<void>;
  identityCode(): Promise<IdentityCode>;
  myShops(): Promise<MyShops>;
  partners(near: { lat: number; lng: number } | null): Promise<Partners>;
  join(slug: string, input: { texts: 'codes' | 'codes_and_offers'; orderId?: string | null; ref?: string | null }): Promise<Joined>;
  updateMembership(slug: string, input: { texts?: 'codes' | 'codes_and_offers'; birthMonth?: number | null }): Promise<Membership>;
  leave(slug: string): Promise<void>;
  claim(slug: string, rewardId: string): Promise<RewardClaim>;
  activity(slug: string): Promise<ShopActivity>;
  bill(slug: string, pointCode: string): Promise<ShopBill>;
  /** Whose a Point is, by its shop's app address; null when the shop has no app. */
  pointShop(pointCode: string): Promise<string | null>;
  pay(slug: string, pointCode: string, input: { method: 'clear' | 'card'; rewardId: string | null; idempotencyKey: string }): Promise<PublicPayStarted>;
  paid(slug: string, orderId: string): Promise<ShopPaid>;
  charge(code: string): Promise<ChargeView>;
  /** The Clear app's onboarding calls (packages/member-kit `submitClearOnboarding`), for Set up Clear. */
  onboarding: OnboardingApi;
  /** Pay now from the balance, or over time; resolves when the charge is approved. Returns the order it paid, when the charge is an order's. */
  approve(code: string, mode: 'now' | 'over_time'): Promise<{ orderId: string | null }>;
}

/** The consent line on the Join screen, by version, so a membership records which one was shown. */
export const CONSENT_VERSION = 'join-2026-10';
