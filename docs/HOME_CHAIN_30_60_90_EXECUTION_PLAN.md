# Home Chain 30/60/90 Execution Plan

Date created: March 21, 2026  
Branch: `codex/home-chain-execution-plan`  
Scope: Run protocol development and OP Stack home-chain testnet development in parallel, then decide mainnet go/no-go.

## Objectives

1. Launch and operate a standard OP Stack home testnet.
2. Run dual-chain protocol deployments (Base Sepolia + home testnet) with parity checks.
3. Reach a mainnet readiness decision with explicit risk acceptance and rollback plans.

## Timeline

1. Phase 0 (Days 0-30): March 23, 2026 - April 20, 2026
2. Phase 1 (Days 31-60): April 21, 2026 - May 20, 2026
3. Phase 2 (Days 61-90): May 21, 2026 - June 20, 2026

## Status Legend

1. `Not Started`
2. `In Progress`
3. `Blocked`
4. `Done`

## Owner Roles

1. `Protocol Eng` - Smart contracts, deploy scripts, upgrade paths
2. `App Eng` - Frontend chain support and UX
3. `Backend Eng` - Services, relayers, RPC paths, event systems
4. `Infra/Ops` - Chain operations, monitoring, incident response
5. `Security` - Audits, key mgmt, controls, threat model
6. `Product/PM` - Prioritization, launch criteria, partner coordination

## Master Tracker

| ID | Phase | Task | Owner | Status | Dependencies | Definition of Done |
|---|---|---|---|---|---|---|
| HC-001 | 0 | Select RaaS provider and freeze standard-chain config | Product/PM + Infra/Ops | Not Started | None | Signed provider decision, chain config doc approved, no non-standard deviations without written exception |
| HC-002 | 0 | Bring up home testnet (RPC, explorer, faucet, bridge UI) | Infra/Ops | Not Started | HC-001 | Public endpoints live, internal runbook written, team can bridge/fund/test wallets end-to-end |
| HC-003 | 0 | Create canonical chain manifest consumed by deploy/app/server | Protocol Eng + Backend Eng | Not Started | HC-001 | Single config source exists and is imported by deployment scripts and both app/server configs |
| HC-004 | 0 | Add home testnet network to Hardhat and deploy tooling | Protocol Eng | Not Started | HC-003 | Hardhat commands run against home testnet with no manual code edits |
| HC-005 | 0 | Remove Base-only guards in deployment scripts | Protocol Eng | Not Started | HC-004 | Deploy scripts are chain-parameterized; no `8453/84532` hard fail branches for target flows |
| HC-006 | 0 | Add home testnet to frontend network config and wallet switching | App Eng | Not Started | HC-003 | User can connect wallet, read balances/NFTs, and execute transactions on home testnet |
| HC-007 | 0 | Add home testnet to backend RPC, contract maps, listeners | Backend Eng | Not Started | HC-003 | Backend reads/writes and events work on home testnet with health checks passing |
| HC-008 | 0 | Fix failing tests and restore green CI baseline | Protocol Eng | Not Started | None | CI green on branch; known failing suite in `SavingsIntentFactory.spec.ts` is fixed |
| HC-009 | 0 | Implement dual-chain deployment pipeline and smoke tests | Protocol Eng + Backend Eng | Not Started | HC-004, HC-005, HC-008 | One command/pipeline deploys to Base Sepolia and home testnet, with automated post-deploy checks |
| HC-010 | 0 | Establish dual-chain parity checklist for critical flows | Product/PM + Protocol Eng | Not Started | HC-009 | Checklist approved and first parity report published |
| HC-011 | 1 | Stand up metrics/alerts for sequencer, proposer, batcher, challenger, RPC | Infra/Ops | Not Started | HC-002 | Alerting dashboard live, critical alerts tested, on-call routing confirmed |
| HC-012 | 1 | Publish incident response runbooks | Infra/Ops + Backend Eng | Not Started | HC-011 | Runbooks for sequencer outage, RPC degradation, bridge issue, rollback are versioned in repo/docs |
| HC-013 | 1 | Define and execute failover drill (tabletop + live) | Infra/Ops | Not Started | HC-012 | Drill completed with timeline, actions, and postmortem items tracked |
| HC-014 | 1 | Migrate privileged roles to multisig/timelock policy | Security + Protocol Eng | Not Started | HC-005 | Admin roles inventory complete and controls migrated or exception-approved |
| HC-015 | 1 | Build external dependency matrix (bridge, CCIP, fiat rails, indexers) | Product/PM + Backend Eng | Not Started | HC-002 | Matrix with support status, owner contacts, and launch blockers is complete |
| HC-016 | 1 | Run controlled pilot traffic on home testnet | Product/PM + App Eng | Not Started | HC-010, HC-011 | Pilot cohort completes scripted flows; all Sev-1/Sev-2 issues triaged |
| HC-017 | 1 | Define gas sponsorship policy and abuse controls | Backend Eng + Security | Not Started | HC-016 | Gasless policy doc approved; rate limits and abuse detection in place |
| HC-018 | 2 | Complete contract + ops security review | Security + Protocol Eng + Infra/Ops | Not Started | HC-014, HC-017 | Security findings triaged with remediation owners and due dates |
| HC-019 | 2 | Run game days for outage, latency spike, bridge delay, bad config rollback | Infra/Ops + Backend Eng | Not Started | HC-013 | All planned scenarios executed with postmortems and measured recovery times |
| HC-020 | 2 | Finalize production migration strategy (home-chain-first + multichain fallback) | Product/PM + Protocol Eng | Not Started | HC-015, HC-016, HC-019 | Signed migration plan includes module cutover order and explicit rollback triggers |
| HC-021 | 2 | Define launch SLOs and public reliability communication plan | Product/PM + Infra/Ops | Not Started | HC-019 | SLOs approved and comms templates ready for incident and maintenance updates |
| HC-022 | 2 | Conduct go/no-go review for mainnet home chain | Leadership + Security + Infra/Ops | Not Started | HC-018, HC-020, HC-021 | Decision memo signed with accepted risks, deferred risks, and launch date or hold decision |

## Repo-Specific File Targets (Initial)

1. `hardhat.config.ts`
2. `deploy/07_deploy_TokenRegistry.ts`
3. `deploy/09_deploy_AssuranceOracle.ts`
4. `deploy/11_deploy_ClaimEscrow.ts`
5. `deploy/deploy_burner_bonds.ts`
6. `app/src/config/networks.ts`
7. `app/server/src/utils/rpc.ts`
8. `app/server/src/config/contracts.ts`
9. `app/server/src/services/eventListenerService.ts`
10. `app/server/src/services/sendCryptoService.ts`
11. `app/server/src/services/membershipRegistryService.ts`
12. `test/peripherals/SavingsIntentFactory.spec.ts`

## Weekly Operating Cadence

1. Monday: 30-minute execution review (status, blockers, dependency risks).
2. Wednesday: reliability/ops check-in (alerts, incidents, drift, failover readiness).
3. Friday: leadership snapshot (phase progress, open blockers, risk trend, next-week targets).

## Decision Gates

1. Gate A (end of Phase 0): Dual-chain deploy and parity are repeatable.
2. Gate B (end of Phase 1): Monitoring, runbooks, and failover drills are operational.
3. Gate C (end of Phase 2): Security and launch controls satisfy go/no-go criteria.

