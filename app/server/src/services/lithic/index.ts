/*
 * The Lithic service boundary. Everything that talks to Lithic goes through here, and nothing in
 * here talks to the chain — the two rails meet in the sweep saga and the reconciler, never inside a
 * request handler. See docs/integrations/lithic-integration-spec.md.
 */
export {
  getLithic,
  requireLithic,
  isConfigured,
  lithicEnvironment,
  resetLithicClient,
  type LithicEnvironment,
} from './lithicClient.js';

export {
  provisionAccountHolder,
  listFinancialAccounts,
  findRoutable,
  type ProvisionWorkflow,
  type ProvisionMemberInput,
  type ProvisionedAccount,
  type MemberFinancialAccount,
} from './accountService.js';

export { lithicStore, type LithicAccountRecord } from './lithicStore.js';

export {
  ensureProvisioned,
  getDepositInstructions,
  type ProvisionKycInput,
  type ProvisionResult,
  type ProvisionStatus,
  type DepositInstructions,
} from './provisioningService.js';

export {
  tierLimits,
  tierAvailability,
  BOND_LTV,
  POOL_LTV,
  INCOME_SHARE,
  type CollateralInputs,
  type TierLimits,
} from './tierLimits.js';

export {
  writeSnapshot,
  refreshSnapshot,
  estimateMonthlyDeposit,
  readLithicCashCents,
  type SnapshotSources,
  type SnapshotResult,
} from './snapshotService.js';

export { authStore, authorize } from './authStore.js';
export { decide, applyDraws, totalAvailable, TIER_ORDER } from './authDecision.js';
export type { AuthDecision, TierAvailability, Draw, AsaResult } from './authDecision.js';

export {
  linkBankAccount,
  listBankAccounts,
  verifyMicroDeposits,
  isUsable,
  type LinkBankInput,
  type LinkedBankAccount,
  type LinkVerification,
} from './bankAccountService.js';

export {
  pullFromBank,
  handleReturn,
  RETURN_WINDOW_DAYS,
  type PullInput,
  type PullResult,
  type SecCode,
} from './achOriginationService.js';

export { pulledFundsStore, type PulledFunds, type PulledFundsStatus } from './pulledFundsStore.js';
