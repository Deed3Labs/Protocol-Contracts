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
