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
5. Enable manufacturer-as-distributor operations across own stores and partner retailers.

## Principles

1. Keep OP chain configuration standard; differentiate at protocol/app/tag layers.
2. Store high-frequency scan telemetry offchain; anchor integrity proofs onchain.
3. Treat hardware trust and key lifecycle as first-class security concerns.

## Initial Hardware Baseline (ARX)

1. Initial hardware provider for MVP and pilot is `ARX HaLo`.
2. Initial scan/auth integration uses `libHaLo` in browser/mobile flows.
3. ERS can be used for enrollment and resolution in pilot, but protocol design must not hard-depend on ERS uptime or permissioning.
4. A provider abstraction is mandatory so `arx_halo` and future `internal_v1` hardware share the same backend and contract interfaces.
5. Physical integration constraints must be tested before production batches (readability depth tolerance, material compatibility, anti-tamper behavior).
6. Pilot assumes small-volume commercial procurement first; enterprise pricing and terms are required before scale.

## Manufacturer Distribution Controls (Core Intent)

1. Track distributed inventory state by partner/store location (consignment, wholesale, direct retail).
2. Give manufacturers precise visibility into where tagged inventory sits after distribution.
3. Support contract-aware operations for partner channels (onchain policies and offchain legal terms).
4. Enable operational automations such as low-stock triggers, replenishment suggestions, and restock workflows.
5. Keep this module usable for hobbyists first, then scale to SMB and enterprise channel complexity.

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
| TAG-002 | Phase 1 | Finalize ARX pilot commercial and technical package (MOQ, lead time, provisioning, legal terms) | Product/PM + Security | Not Started | TAG-001 | Signed pilot procurement plan and technical acceptance checklist are approved |
| TAG-003 | Phase 1 | Define provider abstraction + onchain model (`ItemRegistry`, `ManufacturerRegistry`, provider enum) | Protocol Eng + Backend Eng | Not Started | TAG-001 | Interface supports `arx_halo` now and `internal_v1` later without schema redesign |
| TAG-004 | Phase 1 | Define ARX attestation protocol mapping (challenge, nonce, domain separation, replay controls) | Security + Protocol Eng | Not Started | TAG-002, TAG-003 | Verification spec and adversarial test cases are reviewed and signed off |
| TAG-005 | Phase 1 | Implement ARX verifier adapter service (libHaLo payload validation + normalization) | Backend Eng | Not Started | TAG-004 | Adapter verifies real chip signatures and returns canonical verification objects |
| TAG-006 | Phase 1 | Build ingestion API for scan events and verification checks | Backend Eng | Not Started | TAG-005 | API deployed with auth, rate limits, audit logging, and provider abstraction support |
| TAG-007 | Phase 1 | Implement offchain event storage and periodic integrity commitments | Backend Eng + Protocol Eng | Not Started | TAG-006 | Merkle/hash commitment job writes verifiable anchors onchain |
| TAG-008 | Phase 1 | Build minimal manufacturer console for item/tag lifecycle | App Eng | Not Started | TAG-003, TAG-006 | Create/activate/revoke/replace flows usable by pilot manufacturer |
| TAG-009 | Phase 1 | Implement resale policy prototype (royalties/revenue share) | Protocol Eng | Not Started | TAG-003 | Policy module supports pilot scenarios and emits auditable events |
| TAG-010 | Phase 1 | Implement security state flags (lost/stolen/compromised/replaced) | Protocol Eng + App Eng | Not Started | TAG-003 | Flag lifecycle and verification UX complete for pilot |
| TAG-011 | Phase 2 | Pilot #1 with one manufacturer and real ARX-tagged inventory | Product/PM + App Eng | Not Started | TAG-008, TAG-009, TAG-010 | Pilot executes end-to-end with signed feedback report and incident log |
| TAG-012 | Phase 2 | Define anti-clone, replacement, and key rotation procedures | Security + Backend Eng | Not Started | TAG-004, TAG-011 | Incident playbook and operational controls documented and tested |
| TAG-013 | Phase 2 | Add analytics dashboard (post-sale movement and engagement signals) | Backend Eng + App Eng | Not Started | TAG-007, TAG-011 | Dashboard live with agreed KPI set for pilot users |
| TAG-014 | Phase 2 | Define legal/compliance posture for item-level tracking data | Product/PM + Security | Not Started | TAG-011 | Data retention, consent, and privacy controls documented |
| TAG-015 | Phase 2 | Publish v1 ARX-based commercial packaging and implementation guide | Product/PM | Not Started | TAG-011, TAG-013, TAG-014 | Internal GTM package approved for early customers |
| TAG-016 | Post-Phase 2 | Define in-house hardware migration path and compatibility plan | Product/PM + Protocol Eng + Security | Not Started | TAG-015 | Migration blueprint includes compatibility matrix, phased cutover, and rollback plan |
| TAG-017 | Phase 2 | Define geofencing policy model for official transfers (region/radius/store) | Product/PM + Protocol Eng + Security | Not Started | TAG-010, TAG-014 | Policy spec approved with threat model and abuse cases |
| TAG-018 | Phase 2 | Implement geofence policy contract/module (`GeoTransferPolicy`) | Protocol Eng | Not Started | TAG-017 | Policy checks are onchain-verifiable with role-based policy management |
| TAG-019 | Phase 2 | Build verifier attestation service for geofence proofs | Backend Eng + Security | Not Started | TAG-017 | EIP-712 attestation flow implemented with expiry, nonce, replay protection, and signer rotation |
| TAG-020 | Phase 2 | Integrate app UX and pilot rollout (soft then hard enforcement) | App Eng + Product/PM | Not Started | TAG-018, TAG-019 | Pilot supports warning mode first, then enforce mode with documented override/dispute path |
| TAG-021 | Phase 2 | Define manufacturer distribution state model (owner, distributor, retailer, location, stock state) | Protocol Eng + Backend Eng | Not Started | TAG-003, TAG-011 | Canonical inventory/distribution schema approved for app, API, and contract use |
| TAG-022 | Phase 2 | Implement consignment/wholesale policy templates and contract hooks | Product/PM + Protocol Eng + Security | Not Started | TAG-021 | Template set supports pilot deal types with auditable policy references |
| TAG-023 | Phase 2 | Build partner inventory visibility dashboard | App Eng + Backend Eng | Not Started | TAG-021 | Manufacturers can view by-partner/by-store stock and movement snapshots |
| TAG-024 | Phase 2 | Implement low-stock and auto-replenishment workflow | Backend Eng + Product/PM | Not Started | TAG-023 | Triggered refill recommendations and workflow actions are live for pilot partners |

## Integration Points with Home Chain Plan

1. Use HC chain readiness Gate A as entry criterion.
2. Reuse HC monitoring/incident systems for tag APIs and commitments.
3. Keep TAG deployments within the same dual-chain deployment discipline until production cutover.
4. Treat ARX integration as initial provider implementation, not a permanent protocol dependency.

## Geofencing Guardrails

1. Geofencing applies only to `official transfer` and `official resale` paths, not physical possession itself.
2. Never store precise user latitude/longitude onchain; store coarse zone/store identifiers or hashed geospatial claims.
3. Require short-lived verifier attestations with nonce + expiry to reduce replay and spoofing risk.
4. Include emergency/manual override controls for customer support, disputes, and lawful exceptions.
