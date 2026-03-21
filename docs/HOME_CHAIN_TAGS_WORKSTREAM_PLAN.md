# Home Chain Tags Workstream Plan

Date created: March 21, 2026  
Companion to: [HOME_CHAIN_30_60_90_EXECUTION_PLAN.md](/Users/kyngkai909/Documents/GitHub/Protocol-Contracts/docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md)  
Scope: RFID/NFC/microchip/tag rails for physical item identity, provenance, resale economics, and security.

## Start and Sequencing

1. Start after Gate A in the home-chain execution plan.
2. Execute in parallel with Phase 1 and Phase 2 chain/protocol tasks.
3. Keep this workstream independent from mainnet go/no-go unless explicitly promoted.

## Objectives

1. Represent physical items onchain using secure tag identity.
2. Enable manufacturer controls and resale revenue policies.
3. Provide retail/security signals (e.g., stolen/compromised tag states).
4. Support analytics and engagement without overloading onchain storage.

## Principles

1. Keep OP chain configuration standard; differentiate at protocol/app/tag layers.
2. Store high-frequency scan telemetry offchain; anchor integrity proofs onchain.
3. Treat hardware trust and key lifecycle as first-class security concerns.

## Status Legend

1. `Not Started`
2. `In Progress`
3. `Blocked`
4. `Done`

## Owner Roles

1. `Protocol Eng` - Contracts and data model
2. `Backend Eng` - Ingestion, verification APIs, analytics pipeline
3. `App Eng` - Tag UX, scanning flows, dashboards
4. `Infra/Ops` - Availability, observability, runbooks
5. `Security` - Hardware trust model, key mgmt, anti-clone controls
6. `Product/PM` - Pilot design, customer discovery, GTM packaging

## Tracker

| ID | Window | Task | Owner | Status | Dependencies | Definition of Done |
|---|---|---|---|---|---|---|
| TAG-001 | Phase 1 | Define MVP tag product spec (hobbyist, SMB, enterprise tiers) | Product/PM | Not Started | Gate A | Spec approved with pricing assumptions and pilot KPI targets |
| TAG-002 | Phase 1 | Select initial hardware vendor(s) and provisioning model | Product/PM + Security | Not Started | TAG-001 | Vendor decision memo includes chip capabilities, key model, MOQ, lead times |
| TAG-003 | Phase 1 | Define onchain data model (`ItemRegistry`, `ManufacturerRegistry`) | Protocol Eng | Not Started | TAG-001 | Contract interface draft approved with upgrade and role model |
| TAG-004 | Phase 1 | Define attestation protocol for tag authenticity | Security + Protocol Eng | Not Started | TAG-002, TAG-003 | Challenge-response and nonce rules documented and reviewed |
| TAG-005 | Phase 1 | Build ingestion API for scan events and verification checks | Backend Eng | Not Started | TAG-004 | API deployed with auth, rate limits, and audit logging |
| TAG-006 | Phase 1 | Implement offchain event storage and periodic integrity commitments | Backend Eng + Protocol Eng | Not Started | TAG-005 | Merkle/hash commitment job writes verifiable anchors onchain |
| TAG-007 | Phase 1 | Build minimal manufacturer console for item/tag lifecycle | App Eng | Not Started | TAG-003, TAG-005 | Create/activate/revoke flows usable by pilot manufacturer |
| TAG-008 | Phase 1 | Implement resale policy prototype (royalties/revenue share) | Protocol Eng | Not Started | TAG-003 | Policy module supports pilot scenarios and emits auditable events |
| TAG-009 | Phase 1 | Implement security state flags (lost/stolen/compromised/replaced) | Protocol Eng + App Eng | Not Started | TAG-003 | Flag lifecycle and verification UX complete for pilot |
| TAG-010 | Phase 2 | Pilot #1 with one manufacturer and real tagged inventory | Product/PM + App Eng | Not Started | TAG-007, TAG-008, TAG-009 | Pilot executes end-to-end with signed feedback report |
| TAG-011 | Phase 2 | Define anti-clone detection and key rotation procedures | Security + Backend Eng | Not Started | TAG-004, TAG-010 | Incident playbook and operational controls documented and tested |
| TAG-012 | Phase 2 | Add analytics dashboard (post-sale movement and engagement signals) | Backend Eng + App Eng | Not Started | TAG-006, TAG-010 | Dashboard live with agreed KPI set for pilot users |
| TAG-013 | Phase 2 | Define legal/compliance posture for item-level tracking data | Product/PM + Security | Not Started | TAG-010 | Data retention, consent, and privacy controls documented |
| TAG-014 | Phase 2 | Publish v1 commercial packaging and implementation guide | Product/PM | Not Started | TAG-010, TAG-012 | Internal GTM package approved for early customers |
| TAG-015 | Phase 2 | Production readiness review for tags workstream | Leadership + Security + Infra/Ops | Not Started | TAG-011, TAG-013, TAG-014 | Go/no-go memo signed with risks and launch constraints |

## Integration Points with Home Chain Plan

1. Use HC chain readiness Gate A as entry criterion.
2. Reuse HC monitoring/incident systems for tag APIs and commitments.
3. Keep TAG deployments within the same dual-chain deployment discipline until production cutover.

