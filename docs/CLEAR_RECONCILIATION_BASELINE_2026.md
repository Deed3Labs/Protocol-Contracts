# CLEAR Reconciliation Baseline (2026)

Purpose: unify repository implementation, current CLEAR product narrative, and CLEAR documentation into one decision-ready baseline for legal, investor, and product communication.

Date: March 1, 2026

---

## 1) Source Hierarchy (Authoritative Order)

Use this precedence for all external communication and internal planning:

1. Current repository code + tests + deployment artifacts (`Protocol-Contracts`) as implementation truth.
2. Current CLEAR narrative and product definitions provided by founders.
3. CLEAR documentation and organizational references from `docs.deedprotocol.org` and Deed3 posts.

Rule:

- If a mismatch appears between sources, external communication follows current CLEAR policy language and current repository implementation status.

---

## 2) Canonical Vocabulary

### Platform and product names

1. `CLEAR` = integrated platform identity.
2. `T-Deeds` = tokenized-deed contract stack used for on-chain RWA representation.
3. `Clear Savings (ESA)` = member deposit and eligibility pathway.
4. `Clear Equity (ELPA)` = residency + equity accrual framework.
5. `Clear USD ($CLRUSD)` = protocol settlement token.
6. `Clear Assurance` = collateral protection/maintenance operating layer.
7. `Clear Credit` = credit and servicing primitive layer.
8. `DeedExchange`, `UPREIT`, `REIT` materials = institutional module references.

---

## 3) Canonical Legal-Operational Architecture

### Confirmed operating model

1. Hybrid legal model: on-chain state + off-chain enforceable agreements.
2. Property wrapper standard: each acquired property is held in an individual trust.
3. Each trust has a designated trustee and trust protector.
4. KYC/KYB posture for participants and entities.
5. Formal dispute-resolution workflow.
6. Third-party legal/property professionals where required.

### Current legal package required for external diligence

1. Current entity chart with jurisdiction, ownership, and control rights.
2. Current ELPA form + disclosure set.
3. Trust administration documents (formation, trustee authority, trust protector authority, transfer/assumption flow).
4. Compliance memo set (consumer finance, real estate, securities/tax, transferability).
5. Current fee schedule and member terms.

---

## 4) Technical-to-Business Mapping

### Live in repository now

1. `ClearUSD` token implementation.
2. `ESADepositVault` 1:1 mint/redeem implementation.
3. Reserve/oracle/token-registry stack.
4. Credit primitive stack.
5. Core asset/validator/fund-manager stack.
6. Partial settlement implementation (`ClaimEscrow`) with test drift.

### Product layers requiring further codification

1. Dedicated ELPA lifecycle smart-contract system.
2. End-to-end trust administration automation (beyond current T-Deeds beneficiary and transfer-state handling).
3. End-to-end assurance operations rails encoded as protocol state machine.
4. Full institutional REIT/UPREIT module.

---

## 5) Reconciliation Matrix

| Topic | CLEAR Stack Context | Current Repo / Current CLEAR | Reconciled Position |
|---|---|---|---|
| Brand | CLEAR platform naming conventions | CLEAR market narrative | Use unified CLEAR language across external and internal materials |
| Ownership instrument | T-Deeds-centered substrate | CLEAR ELPA + ESA + CLRUSD product framing | T-Deeds handles ownership/beneficiary state; ELPA is the residency and legal layer |
| Property wrappers | Trust/LLC patterns documented | CLEAR confirms trust-centered structure | Canonical model is one property per trust with trustee + trust protector |
| Fee model | Fee pages in docs reference platform charges | Current contracts expose commission/royalty controls; no unified consumer fee table in repo | Publish one current CLEAR fee policy for all channels |
| Stable-value token | REUSD appears in some materials | Repo implements CLRUSD | CLRUSD is canonical across product docs |
| 1031/721-UPREIT | Institutional structuring concepts documented | Not implemented as production module in current repo | Treat as institutional expansion module with explicit scope/timing |
| Corporate entities | Deed3 entity architecture references exist | CLEAR co-op/neobank framing + org chart context provided | Publish a dated current entity pack and map all operating roles |
| Settlement readiness | End-to-end settlement concept documented | ClaimEscrow tests partially failing | Mark settlement as functional with hardening in progress |

---

## 6) Investor Messaging Guardrails

Use:

1. “Asset-backed, member-aligned ownership pathway.”
2. “Hybrid legal + protocol architecture.”
3. “Implemented savings/settlement/credit rails with phased legal-product completion.”

Avoid without qualification:

1. Guaranteed returns or guaranteed liquidity language.
2. Presenting 1031/721-UPREIT as current production baseline.
3. Presenting non-current fee tables as active policy.

---

## 7) Member Messaging Guardrails

Use:

1. “CLEAR is building a path from renting to ownership.”
2. “Some infrastructure is live now; some parts are still being completed.”
3. “Legal rights and fees are governed by your signed current agreement set.”

Avoid:

1. Promising universal outcomes without contract-specific terms.
2. Mixing internal protocol terminology into onboarding without plain-language definitions.

---

## 8) Remaining Founder Confirmations

Please confirm these to finalize reconciliation:

1. Canonical current entity names and jurisdictions.
2. Current production fee schedule for member-facing and investor-facing flows.
3. Confirmation that `CLRUSD` is the only active settlement token name across all channels.
4. 1031/721-UPREIT disclosure posture for near-term investor materials (active module vs expansion module).
5. Jurisdictions for first legal ELPA rollout (state-by-state launch order).
6. Required licensing/compliance posture for “depositor-owned neobank/financial co-op” wording.
7. Official role of the fund/entity architecture in your diagram for phase sequencing (consumer baseline vs institutional expansion layer).

---

## 9) Primary External Sources Used for Reconciliation

1. [CLEAR Docs](https://docs.deedprotocol.org/)
2. [Corporate Structure](https://docs.deedprotocol.org/legal-framework/corporate-structure)
3. [Property Wrappers](https://docs.deedprotocol.org/legal-framework/property-wrappers)
4. [Nominee Trust Structure](https://docs.deedprotocol.org/legal-framework/property-wrappers/nominee-trust-structure)
5. [Limited Liability Company Wrapper](https://docs.deedprotocol.org/legal-framework/property-wrappers/limited-liability-company)
6. [Identity Verification](https://docs.deedprotocol.org/legal-framework/identity-verification)
7. [Dispute Resolution](https://docs.deedprotocol.org/legal-framework/dispute-resolution)
8. [Third-Party Services](https://docs.deedprotocol.org/legal-framework/third-party-services)
9. [Traditional Legal Agreements](https://docs.deedprotocol.org/legal-framework/traditional-legal-agreements)
10. [Fees & Service Charges](https://docs.deedprotocol.org/general-information/fees-and-service-charges)
11. [DeedExchange Post](https://github.com/Deed3Labs/Posts/blob/main/DeedExchange.md)
12. [REIT Post](https://github.com/Deed3Labs/Posts/blob/main/REIT.md)
