# Security and Pledge Agreement

**Clear Lending Co., as secured party, each Member who pledges collateral, and Clear Collective LLC as to ESA capital**

Instrument MB-05 · Final draft v1.0 · Prepared November 13, 2026

---

## Completion Checklist

| Item | Where used | Value |
| --- | --- | --- |
| Effective Date (date this Agreement is first published) | Preamble, signature page | [●] |
| Clear Lending Co. California Financing Law licence number | Recital B, Section 10.2 | [●] |
| Clear Lending Co. mailing address for notices | Sections 12.2, 12.7, 13.3 | [●] |
| Email address for legal notices and arbitration opt-outs | Sections 12.2, 12.7, 13.3 | [●] |
| Support email address and phone number | Sections 6.3, 9.2 | [●] |
| Web address of the published CLRUSD system rules | Section 3.2 | [●] |
| BurnerBond token contract address and network | Schedule 1 | [●] |
| Yield pool vault contract address and network | Schedule 1 | [●] |
| Name of Clear's Second Authorized Signer (designated under F-05 Section 6.3) | Section 4.10 | [●] |
| Name and title of Clear Lending Co.'s signing officer | Signature page | [●] |
| Name and title of Clear Collective LLC's signing officer | Signature page | [●] |

---

> **The short version**
>
> - You can back credit from Clear Lending Co. with your **Savings** (CLRUSD), **BurnerBonds** or **yield pool shares**. **Only what you have drawn is locked**, and the lock lifts by itself as you repay.
> - Collateral stays in **your own Smart Account**. It is never lent, re-pledged or used to fund anyone else.
> - Collateral is taken only on **default**, after a notice and **at least ten (10) days** to fix it, and only for the **amount in default**.
> - If pledged Earn positions fall below what you drew against them, you get **72 hours**; then only enough of them is redeemed to close the gap. **Your Savings are never used for that.**
> - **Earned Equity Credits are never taken back.** A default never ends your membership or your vote.
> - A pledged BurnerBond **rolls only if you confirm that roll** on its Roll Notice; otherwise it pays out at maturity.
> - Disputes go to individual arbitration unless you opt out within 30 days (Article 12). If you are a covered member of the military or a dependent, arbitration does not apply to your credit, and you may go to court.

---

This Security and Pledge Agreement (this "**Agreement**") is made between you, the Member who accepts it ("**you**"), and Clear Lending Co., a Wyoming limited liability company ("**Clear Lending**", "**we**" or "**us**"), effective [●] (the "**Effective Date**"). Clear Collective LLC, a Wyoming limited liability company ("**Clear**"), is a party for the purposes stated in Section 1.5 and Article 8.

## Recitals

A. Your capital in Clear is your Equity Savings Account, held as CLRUSD in your own Smart Account under the Equity Savings Account Terms (MB-03).

B. Clear Lending, licensed under the California Financing Law (licence no. [●]), extends credit to Members under the Clear Credit Agreement (MB-04) and the Term Plan Agreement (MB-06). Savings-backed credit is backed by your CLRUSD, and asset-backed credit by your BurnerBonds and yield pool shares.

C. Sections 3.7(a) and 5.6 of the Cooperative Operating Agreement of Clear Collective LLC (C-01) permit those pledges, and Clear recognizes them.

D. This Agreement creates the pledge and limits how it can be enforced, so that no Clear entity holds a general power to move or freeze your assets.

---

## Article 1. About This Agreement

**1.1 Acceptance.** You accept this Agreement by accepting it in the Clear app, or by signing your first pledge with a Wallet Signature, whichever happens first. Your acceptance in the app is your signature. This Agreement is presented to you as a separate document, apart from your card, cash account and credit agreements, and you sign it separately.

**1.2 Master Definitions.** Capitalized terms not defined here have the meanings given in the Cooperative Operating Agreement of Clear Collective LLC (C-01). Terms defined in MB-03, including CLRUSD, ESA capital, Smart Account, Pledge Module, Savings-Backed Drawn, Withdrawable Capital, Undrawn Balance, Objective Default and Exit, have the same meanings here.

**1.3 Defined Terms.** In this Agreement:

- "**Asset-Backed Drawn**" means the principal and accrued carry of asset-backed credit you have drawn and not repaid under MB-04 or MB-06, as recorded on-chain.
- "**Asset-Backed Limit**" means the total Collateral Value (Section 5.1) of your Pledged Earn Positions.
- "**BurnerBond**" means a zero-coupon bond issued by Clear Lending as an ERC-1155 token under its offering documents.
- "**Defaulted Amount**" means the amount of a Secured Obligation that is past due when the grace period under MB-04 or MB-06 ends, as recorded on-chain. It includes the full unpaid balance of a credit only if that balance has become due under MB-04 or MB-06, such as at the end of a term plan or on the closing of your line.
- "**Earn Position**" means a BurnerBond or a Pool Share.
- "**Encumbered CLRUSD**" means the part of your CLRUSD equal to your Savings-Backed Drawn. The rest is your Withdrawable Capital.
- "**Pledged Earn Position**" means an Earn Position you have pledged by Wallet Signature and not released.
- "**Pool Share**" means a share of the yield pool, issued by Clear Lending as an ERC-4626 vault share under its offering documents and its Operating Agreement (L-01), which treats Pool Shares as limited-recourse debt of Clear Lending.
- "**Present Value**" means, for a BurnerBond at any time, its face amount discounted from its maturity date to that time at the yield fixed when it was issued. It rises steadily to the face amount at maturity.
- "**Pool Share Value**" means, for a Pool Share at any time, the amount of USDC the yield pool vault would pay to redeem it at that time, net of any redemption fee, as reported by the vault's own redemption preview function.
- "**Shortfall**" means that your Asset-Backed Drawn exceeds your Asset-Backed Limit.
- "**Wallet Signature**" has the meaning given in the Consent to Electronic Records, Disclosures and Signatures (MB-17).

**1.4 Order of Precedence.** On the pledge and its enforcement, this Agreement controls over every Program Agreement other than C-01. MB-04 and MB-06 control the terms of your credit, including what is a default, subject to Article 6. MB-03 controls everything else about your ESA.

**1.5 Roles.** Clear Lending is the secured party. Clear Financial Co. services your credit and operates the ESA Vault, and may act for Clear Lending and Clear. Clear is a party because your ESA capital is your capital in Clear (Article 8).

**1.6 Partner Members.** A Partner Member may pledge Collateral on the same terms.

## Article 2. The Security Interest

**2.1 Grant.** To secure the Secured Obligations, you grant Clear Lending a security interest in the Collateral, and you pledge the Collateral to Clear Lending, on the terms and subject to the limits of this Agreement.

**2.2 Collateral.** The "**Collateral**" is:

(a) your Encumbered CLRUSD, as it changes from time to time;

(b) your Pledged Earn Positions; and

(c) all proceeds of the items above, but only to the extent they are not released under this Agreement and have not been paid to your Ready to allocate.

**2.3 What Is Not Collateral.** None of the following is Collateral, and Clear Lending has no lien on or right to set off against it:

(a) your Withdrawable Capital;

(b) your Spendable balance and your Ready to allocate, including any USDC paid to it on the maturity of a Pledged Earn Position;

(c) your Equity Credits, Housing Allowance and patronage allocations;

(d) any Earn Position you have not pledged;

(e) any right under a Housing Agreement, any home, and any interest in Land or in property held by Clear Properties Co.; and

(f) any wages, household goods or other property not listed in Section 2.2.

**2.4 Secured Obligations.** The "**Secured Obligations**" are all amounts you owe Clear Lending under MB-04 and MB-06, including principal and carry, subject to Sections 2.5 and 2.6. They do not include any obligation under a Housing Agreement or to any person other than Clear Lending.

**2.5 What Each Kind of Collateral Secures First.**

(a) *Encumbered CLRUSD* secures only your Savings-Backed Drawn. It can never be applied to any other obligation.

(b) *Pledged Earn Positions* secure your Asset-Backed Drawn first and, while they remain pledged, any other Secured Obligation that is a Defaulted Amount.

**2.6 Limits Set by Law.** If a court or regulator treats any Secured Obligation as a retail installment contract or account under California's Unruh Act, or as any other credit for which the law prohibits a security interest in this Collateral, the security interest does not secure that obligation.

**2.7 Separate and Specific Consent.** You grant this security interest by a separate, specific signature. You are not required to grant it to open a cash account, obtain a card or become a Member. You need to grant it only to draw savings-backed or asset-backed credit.

**2.8 Attachment.** The security interest attaches to each item of Collateral when it becomes Collateral: for CLRUSD, when you sign a savings-backed draw; for an Earn Position, when you sign its pledge.

## Article 3. Classification and Perfection

**3.1 How the Parties Classify the Collateral.** The parties agree, for all purposes of this Agreement, that:

(a) CLRUSD is a controllable electronic record under Article 12 of the Uniform Commercial Code where that Article is in effect (in California, Division 12 of the Commercial Code), and a digital asset under Wyoming Statutes Section 34-29-101 et seq. It is not a deposit account, money, a security or investment property;

(b) BurnerBonds are uncertificated securities and investment property under Article 8 and Article 9 of the Uniform Commercial Code, and digital securities under Wyoming Statutes Section 34-29-102, because their offering documents expressly provide that they are securities governed by Article 8; and

(c) Pool Shares are uncertificated securities and investment property on the same basis, because their offering documents so provide.

**3.2 Jurisdiction of CLRUSD.** The published CLRUSD system rules, at [●], state that California is the controllable electronic record's jurisdiction of CLRUSD for purposes of Article 12 of the Uniform Commercial Code, so that Division 12 of the California Commercial Code governs control of CLRUSD, the priority of security interests in it and the rights of qualifying purchasers. This follows the approach of the Deed Protocol trust agreements (PR-01 and PR-02), under which Wyoming law governs the trust and California's Article 12 governs the token. Clear will not change that designation while any pledge under this Agreement is in effect.

**3.3 No Article 8 Election for the ESA.** Clear has not elected, and will not elect, to treat your ESA, your Membership Account or CLRUSD as a security governed by Article 8 of the Uniform Commercial Code.

**3.4 Perfection.** Clear Lending perfects its security interest in all Collateral by filing under Section 3.5, and also as follows:

(a) *CLRUSD.* The Pledge Module, a smart contract created and deployed by or for Clear Lending, restricts transfer and redemption of Encumbered CLRUSD, so that no one can transfer or redeem it except as this Agreement permits. Clear Lending holds no power over your CLRUSD (Section 4.6). To the extent the Pledge Module gives Clear Lending control under California Commercial Code Sections 12105 and 9107.1, or possession or control under Wyoming Statutes Section 34-29-103(e), the security interest is also perfected by that control, but its perfection does not depend on it.

(b) *BurnerBonds.* By control, through Clear Lending's position as issuer and its agreement as issuer, which you consent to here, that it will comply with instructions originated by Clear Lending as secured party under this Agreement without your further consent, under Uniform Commercial Code Section 8-106(c), together with the Pledge Module.

(c) *Pool Shares.* By control, through Clear Lending's position as issuer of the Pool Shares and its agreement as issuer, which you consent to here, that it will comply with instructions originated by Clear Lending as secured party under this Agreement without your further consent, under Uniform Commercial Code Section 8-106(c), together with the Pledge Module.

**3.5 Financing Statement.** You authorize Clear Lending to file a financing statement describing the Collateral in the filing office of the state where you are located under Uniform Commercial Code Section 9-307. Clear Lending will file it promptly after your first savings-backed or asset-backed draw, and in any case within twenty (20) days after that draw. One financing statement covers all Collateral you pledge while it is effective. Clear Lending will file a termination statement within twenty (20) days after your Secured Obligations are paid in full and no Collateral remains pledged, or sooner if the law requires, and will file again under this Section if you later draw against Collateral.

**3.6 Priority.** You will not grant any other person a security interest in, or control over, the Collateral. Clear's own rights against your ESA, including set-off under C-01 Section 3.10, are subordinate to this Agreement as to Encumbered CLRUSD and are waived as to Withdrawable Capital under MB-03 Section 4.7.

## Article 4. How the Pledge Works on Your Smart Account

**4.1 Self-Custody.** All Collateral stays in your Smart Account. Clear Lending does not take it into its own wallet or into the custody of any other person at any time before enforcement under Article 7.

**4.2 The Lock Is Computed, Not Set.** The Pledge Module locks only:

(a) your Encumbered CLRUSD, which equals your Savings-Backed Drawn; and

(b) your Pledged Earn Positions.

**4.3 Only You Increase What Is Locked.** Your Savings-Backed Drawn and your Asset-Backed Drawn increase only through draws and charges you sign. Your Pledged Earn Positions change only through pledges and releases you sign, and through Sections 5.5 to 5.7. No administrator, data provider or attestation signer can increase what is drawn or locked.

**4.4 Automatic Release.** As you repay, the lock shrinks.

(a) Encumbered CLRUSD becomes Withdrawable Capital in the same block in which the repayment is recorded. When your Savings-Backed Drawn reaches zero, no CLRUSD is locked.

(b) When your Asset-Backed Drawn reaches zero, all Pledged Earn Positions are released in the same block.

(c) Release needs no action, consent or signature from Clear Lending.

**4.5 Releasing Earn Positions Early.** You may release any Pledged Earn Position at any time by Wallet Signature, so long as your Asset-Backed Drawn does not exceed your Asset-Backed Limit after the release.

**4.6 Clear Lending's Only Power.** Clear Lending holds no key, role or session key that can move, freeze or block your CLRUSD or your Earn Positions. Its only rights over Collateral are:

(a) the computed lock in Section 4.2;

(b) enforcement under Article 7, carried out only through the Enforcement Authorization you signed; and

(c) the Liquidation Hold in Section 6.7, which can only delay enforcement.

The fraud and security pause in MB-03 Section 4.6 is not a power under this Agreement and can never be used for credit or collection. The Pledge Module never locks USDC, and no Clear entity holds any key, role, pause, session key or module power that can move, freeze or block USDC in your Ready to allocate.

**4.7 Your Enforcement Authorization.** When you first pledge Collateral, you sign the authorization in Schedule 2 (the "**Enforcement Authorization**"). Each draw you later sign against Collateral confirms it. It authorizes the Pledge Module, and nothing else, to apply your Collateral to a Defaulted Amount, only on the conditions in Article 6 and only up to the limits in Article 7. Any person may submit the enforcement transaction once those conditions are met, but it can do only what your Enforcement Authorization allows, and it fails otherwise.

**4.8 No Rehypothecation.** Clear Lending will not sell, lend, re-pledge, rehypothecate or otherwise use any Collateral before enforcement. Your CLRUSD and its Reserve are never used to fund credit to you or anyone else. Savings-backed credit is funded from Clear Lending's own resources and is backed only by your own CLRUSD.

**4.9 Upgrades and Parameters.** The Pledge Module is subject to the upgrade rules in MB-03 Section 4.8. No upgrade or parameter change may widen Clear Lending's powers under Section 4.6. Every administrative, upgrade, parameter or Liquidation Hold action needs approval by two authorized persons under C-01 Section 6.14.

**4.10 Launch Condition.** Clear will designate its Second Authorized Signer under F-05 Section 6.3 before the soft launch accepts any Member funds. Clear Lending will not accept any pledge under this Agreement until that designation has been made.

## Article 5. Values, Limits and Maturities

**5.1 Collateral Value.** The "**Collateral Value**" of each item is:

(a) for Encumbered CLRUSD, one dollar ($1.00) per CLRUSD;

(b) for a BurnerBond, ninety-five percent (95%) of its Present Value; and

(c) for a Pool Share, seventy percent (70%) of its Pool Share Value.

**5.2 On-Chain Values Only.** Present Value and Pool Share Value are computed from on-chain data, as Schedule 1 describes. No off-chain price, rating or estimate is used.

**5.3 Changes to Advance Rates.** The percentages in Section 5.1(b) and (c) are governed parameters. Clear Lending may raise them at any time. It may lower them only on thirty (30) days' notice, and a lower percentage applies only to Earn Positions pledged after it takes effect. A change in a percentage can never by itself cause a Shortfall.

**5.4 Early Warning.** When your Asset-Backed Drawn reaches ninety percent (90%) of your Asset-Backed Limit, Clear Lending will tell you in the app and by email.

**5.5 BurnerBond Maturity: Roll Only on Your Confirmation.** A Pledged BurnerBond rolls at maturity only if you confirm that roll yourself under the BurnerBond terms (IV-01 Sections 5.1 to 5.5).

(a) *Your confirmation.* Clear Lending sends a notice in the app and by email at least twenty (20) days before the bond's maturity date (a "**Roll Notice**"), stating the new term, yield, price and maturity date and the end of the day (Pacific Time) on the fifth (5th) business day before maturity (the "**Roll Deadline**"), and sends a reminder at least two (2) business days before the Roll Deadline if you have not confirmed. The bond rolls only if you confirm that roll by Wallet Signature in the app on that Roll Notice before the Roll Deadline (a "**Roll Confirmation**"). Each Roll Confirmation covers one roll of one bond. You may withdraw it in the app at any time before the Roll Deadline.

(b) *No automatic roll.* Nothing in this Agreement, no pledge, no standing instruction and no setting in the app rolls a bond, and Clear Lending never confirms a roll for you. A roll preference you set in the app only pre-selects the choice shown on the Roll Notice.

(c) *A confirmed roll.* The new bond has the same term, or the nearest shorter term then offered, at the yield stated in the Roll Notice or any higher yield then offered for that term, and is pledged in place of the old one with no gap.

(d) *No confirmation.* If no Roll Confirmation is in effect at the Roll Deadline, or the bond does not roll for any other reason the BurnerBond terms state, the bond is paid at maturity and Section 5.6 applies.

**5.6 Maturity Without a Roll.** When you pledge a BurnerBond, you also sign a standing instruction (the "**Maturity Instruction**") for its maturity payment if the bond does not roll under Section 5.5. The Maturity Instruction directs only where the maturity payment goes; it never rolls a bond. Under it, at maturity:

(a) the part of the maturity payment needed to keep your Asset-Backed Drawn within your Asset-Backed Limit, once that BurnerBond is no longer pledged, is paid to Clear Lending and applied to your Asset-Backed Drawn, as an application on your own instruction under Section 7.9; and

(b) the rest is paid in USDC to your Ready to allocate, free of any pledge, lock or other restriction.

No part of a maturity payment is ever held, locked or restricted in your Smart Account. Before maturity you may reduce or remove the part under clause (a) by repaying Asset-Backed Drawn or pledging other Earn Positions, and the Maturity Instruction then applies only to what is still needed.

**5.7 Pool Share Events.** If the yield pool vault replaces its shares, the replacement shares are pledged in place of the old ones.

## Article 6. Default, Notice and Cure

**6.1 When Collateral May Be Enforced.** Clear Lending may enforce against Collateral only in two cases:

(a) an Objective Default, as MB-03 Section 4.5 and MB-04 define it, or a Default under MB-06 Section 13.7(a) of a Plan that this Agreement secures, as shown on-chain under Section 6.8, in each case after the notice and cure period in Sections 6.3 and 6.4; or

(b) a Shortfall that continues after the period in Section 6.5, and then only against Pledged Earn Positions.

**6.2 What Is Not a Default.** None of these is, by itself, a default or a reason to enforce: your bankruptcy or insolvency; your death or incapacity; your Exit; a fall in your income, a credit score or any other off-chain information; a fraud or security pause under MB-03 Section 4.6, or a payment the pause prevented; or a Shortfall, except as Section 6.1(b) provides.

**6.3 Default Notice.** No later than one (1) day after the end of a credit cycle in which you did not meet the requirement under MB-04 or MB-06, Clear Lending will send you a notice (a "**Default Notice**") in the app and by email, and by text message if you have consented. It will state the cure amount and how to pay it; when the cure period ends; the Defaulted Amount and which Collateral would be applied, in the order of Section 7.1; the method (redemption of CLRUSD or Pool Shares, or payment of BurnerBonds by their issuer, at the values in Sections 7.2 and 7.3); that no Collateral will be applied before a stated date; that you may instead apply Collateral yourself under Section 7.9; that you are entitled to an accounting of the unpaid Secured Obligations, free of charge; and how to dispute the amount, at [●].

**6.4 Cure Period of at Least Ten Days.** For a Secured Obligation under MB-04, the notice under MB-04 Section 9.2(a) is the Default Notice, and the Grace Period under MB-04 Section 9.1(a) ends at the later of fifteen (15) days after the second Payment Due Date and ten (10) full days after the time the Default Notice was sent, as recorded on-chain under MB-04 Section 9.2(d). That time is recorded by two authorized persons, is never earlier than the time of approval, and can be recorded only while the amount is unpaid. If no time is recorded, there is no Objective Default and no enforcement, so a late Default Notice only delays enforcement and you always have at least ten (10) full days after it. The Grace Period is also extended by the full length of any fraud or security pause under MB-03 Section 4.6 that applied to your Smart Account from the second Payment Due Date until the Grace Period ends, and a payment the pause prevented is never a missed payment, so a pause can only delay enforcement, never cause it. The same extension applies to the cure period for a Plan under MB-06. You may cure at any time before enforcement by paying the cure amount, and then no enforcement occurs for that cycle. For a Plan under MB-06, the longer periods in MB-06 Sections 13.7 and 13.8 apply instead: the notice under MB-06 Section 13.8 is the Default Notice, and enforcement may not happen before the cure date it states.

**6.5 Shortfall.** If a Shortfall arises:

(a) Clear Lending will tell you in the app and by email within four (4) hours, stating the amount of the Shortfall and how to cure it;

(b) you may cure by repaying Asset-Backed Drawn, by pledging more Earn Positions, or by both; and

(c) if the Shortfall has existed without interruption for seventy-two (72) hours, as shown on-chain, the Pledged Earn Positions may be applied under Section 7.3, but only in the smallest amount that ends the Shortfall.

A Shortfall settlement never accelerates the rest of your credit and never uses your CLRUSD.

**6.6 The ESA Is Never a Rebalancing Source.** Your CLRUSD is never used to rebalance, top up or reduce a credit line, to cure a Shortfall, or to pay any amount that is not a Defaulted Amount of Savings-Backed Drawn. It is applied only under Section 6.1(a) or on your own signed instruction.

**6.7 Liquidation Hold.** Clear Lending will set a hold (a "**Liquidation Hold**"), which stops enforcement against your Collateral, while any of the following applies:

(a) a Default Notice whose time was recorded under Section 6.4 or 6.8 but which was not delivered to you, until ten (10) full days after it is delivered;

(b) you have given notice of a billing error or a good-faith dispute about the Defaulted Amount, until it is resolved under MB-04, but only for the disputed amount;

(c) Clear Lending has notice of your bankruptcy, until the court permits enforcement;

(d) ninety (90) days after Clear Lending receives notice of your death; and

(e) any other case in which the law forbids enforcement, including the Servicemembers Civil Relief Act.

A Liquidation Hold cannot move, lock or freeze anything. It ends automatically when its reason ends. No charge accrues on any amount because of a Liquidation Hold.

**6.8 Secured Plans On-Chain.** For a Plan under MB-06 that this Agreement secures, the Pledge Module treats the Plan as in Default only when on-chain records show that a scheduled payment on it has been Past Due for at least sixty (60) days, that the date of the notice under MB-06 Section 13.8 has been recorded, and that thirty (30) days have passed since that recorded date with the Past Due amount still unpaid. The notice date is recorded with the same safeguards as a Liquidation Hold under Section 4.9: one authorized person proposes it and a different authorized person approves it under C-01 Section 6.14, it can be recorded only while the payment is Past Due, and the date recorded is the time of approval, never earlier. Paying the Past Due amount, or accepting a hardship plan under MB-06 Section 13.6, cancels the record. No other record or person can put a Plan in Default.

## Article 7. Enforcement

**7.1 Order of Enforcement.** Collateral is applied in this order:

(a) for a Defaulted Amount of Savings-Backed Drawn, Encumbered CLRUSD only;

(b) for a Defaulted Amount of Asset-Backed Drawn, first Pledged BurnerBonds, then Pledged Pool Shares;

(c) for a Shortfall, first Pledged Pool Shares, then Pledged BurnerBonds, because that order ends a Shortfall by redeeming the least; and

(d) for any other Defaulted Amount, Pledged Earn Positions left after clause (b), in the order of clause (b).

Within each kind, BurnerBonds nearest to maturity are applied first. You may set a different order among your Pledged Earn Positions in the app at any time before a Default Notice or Shortfall notice is sent.

**7.2 Encumbered CLRUSD.** Enforcement against Encumbered CLRUSD is done only by redeeming it through the ESA Vault at one dollar ($1.00) per CLRUSD and paying the USDC released from the Reserve to Clear Lending, which applies all of it to the Defaulted Amount. The amount redeemed can never exceed the lesser of your Encumbered CLRUSD and the Defaulted Amount of Savings-Backed Drawn. Because CLRUSD is redeemed at its full value, enforcement against it leaves no surplus and no deficiency.

**7.3 Earn Positions.** Enforcement against an Earn Position is done only as follows:

(a) *BurnerBonds* are collected under their own terms. Under Section 4.9 of the BurnerBond Terms (IV-01), a BurnerBond pledged under this Agreement becomes payable by Clear Lending, as issuer, when this Agreement permits enforcement against it under Section 6.1(a) or 6.1(b), at not less than one hundred percent (100%) of its Present Value at the time of payment, and that payment may be applied only to the Secured Obligations it secures. Payment of a BurnerBond under that Section is collection of an obligation owed on the Collateral, not a sale or other disposition. Clear Lending will never sell a BurnerBond, buy it for itself or accept it in full or partial satisfaction of any Secured Obligation.

(b) *Pool Shares* are redeemed through the yield pool vault's ordinary redemption function at their Pool Share Value. If the vault limits or queues redemptions, Clear Lending will wait in the queue. It will not sell Pool Shares to any person, or at less than Pool Share Value, without your consent given after the Default Notice or Shortfall notice.

(c) Only as many Earn Positions are paid or redeemed as are needed to pay the Defaulted Amount, or to end the Shortfall.

**7.4 Collection and Enforcement Under Sections 9-607 and 9-610.** Redemption of CLRUSD or Pool Shares, and payment of a BurnerBond by its issuer, is collection of the obligation owed on that Collateral, not a sale of it. Each redemption or payment under this Article will be carried out in a commercially reasonable manner under Uniform Commercial Code Sections 9-607 and 9-610. Redemption or payment at the values in Sections 7.2 and 7.3 is a commercially reasonable method.

**7.5 Application of Proceeds.** Clear Lending will apply the proceeds of each enforcement, in order, to the Defaulted Amount for which it was made, and then to any other Defaulted Amount that the Collateral secures under Section 2.5. Within a Defaulted Amount, proceeds are applied as MB-04 or MB-06 provides. Clear Lending will not apply proceeds to any collection cost, fee or charge.

**7.6 Surplus.** Any surplus is released to your Ready to allocate within two (2) business days after the enforcement. Clear Lending never keeps a surplus.

**7.7 Deficiency.** If the proceeds of Earn Positions do not pay the Defaulted Amount in full, you remain liable for the rest as an unsecured obligation under MB-04 or MB-06. Before collecting or reporting a deficiency, Clear Lending will send you a written explanation of how it was calculated, including the values used, the proceeds and how they were applied. Your Withdrawable Capital is never used to pay a deficiency.

**7.8 Statement.** Within one (1) business day after any enforcement, Clear Lending will send you a statement of what was applied, the value used, the debt reduced and any surplus.

**7.9 Your Own Instruction.** At any time, including after a Default Notice, you may sign an instruction to apply Collateral to any Secured Obligation, in any amount and order you choose. Applying Collateral on your instruction is not enforcement.

**7.10 Reinstatement.** If Collateral is enforced in breach of this Agreement, Clear Lending will, at your signed request, within five (5) business days:

(a) for CLRUSD, pay into the ESA Vault, from its own resources, the USDC needed to mint the same amount of CLRUSD to your Smart Account, with your Savings-Backed Drawn restored by the same amount on its original terms;

(b) for an Earn Position, restore an equivalent position or pay you its current value, as you choose; and

(c) pay any other loss the breach caused you.

This does not limit any other remedy you have.

**7.11 No Other Remedies.** Clear Lending will apply Collateral only under this Article, and will not set off any Secured Obligation against your Spendable balance or Withdrawable Capital.

**7.12 Collection Conduct.** Clear Lending and Clear Financial Co. will follow the federal Fair Debt Collection Practices Act and California's Rosenthal Fair Debt Collection Practices Act in collecting Secured Obligations, whether or not those laws would otherwise apply.

## Article 8. Effect on Your ESA, Credits and Membership

**8.1 Clear's Recognition.** Clear recognizes this pledge under C-01 Sections 3.7(a) and 5.6. Clear will record your Encumbered CLRUSD in your Membership Account, will not process any transfer or redemption of Encumbered CLRUSD except as this Agreement and MB-03 allow, and will redeem Encumbered CLRUSD through the ESA Vault when the Pledge Module carries out an enforcement under Section 7.2, without any further consent from you.

**8.2 Effect on Your Capital.** An enforcement against CLRUSD reduces your ESA capital and your Savings-Backed Drawn by the same amount, leaving your Withdrawable Capital unchanged.

**8.3 Equity Credits.** Vested Equity Credits are never reduced or taken back because of a pledge, a default or an enforcement. Vesting pauses on drawn capital as MB-03 Section 6.3 provides, and resumes on repayment.

**8.4 Membership and Vote.** A pledge, a default or an enforcement never ends or suspends your membership or your vote. There is no minimum ESA balance for membership.

**8.5 Redemption From the Reserve.** An enforcement redemption of Encumbered CLRUSD is paid from the ESA Reserve that Clear Financial Co. holds in trust for CLRUSD holders (MB-03 Sections 5.2 and 9.4). It does not depend on Clear's solvency and does not wait under C-01 Section 5.5. If the ESA Vault cannot process a redemption when it is due, your Encumbered CLRUSD stays locked until it can, no charge accrues on the Defaulted Amount it secures, and the delay is not a further default.

## Article 9. Exit, Death, Incapacity and Bankruptcy

**9.1 Exit.** Before your Exit takes effect in the app, the app shows your Secured Obligations and asks you to clear them in one of these ways:

(a) repay them;

(b) sign an instruction applying your Encumbered CLRUSD, Pledged Earn Positions or both to them; or

(c) leave them outstanding on their existing terms.

If you choose (c), or do nothing, the Collateral stays pledged until the Secured Obligations are paid or enforced under Article 7. Your Withdrawable Capital can be redeemed under MB-03 Section 10.1 at once and is never withheld. Clear may set off amounts that are then Defaulted Amounts against patronage payable to you under C-01 Section 3.10, but never against CLRUSD.

**9.2 Death.** On receipt of notice of your death, Clear Lending will set a Liquidation Hold for ninety (90) days. During that period, your estate or beneficiary may repay or sign an instruction to apply your Collateral. Clear Lending may extend the hold on the written request of your personal representative or beneficiary while estate administration or recovery of access is pending.

(a) *Access.* Clear holds no key to your Smart Account and cannot move your CLRUSD. Your estate or beneficiary recovers access through your recovery methods, including any Legacy Contact you named under MB-03 Section 4.10, or through the wallet provider's account recovery process, as MB-03 Section 10.3 provides. A Legacy Contact is always a person you choose, never Clear or a Subsidiary, and the Pledge Module continues to apply after a recovery.

(b) *Records.* On receipt of a death certificate and proof of authority, Clear and Clear Lending will give your personal representative or beneficiary, free of charge, a statement of your Smart Account address, ESA capital, Collateral and Secured Obligations, and will help with the wallet provider's process. Contact [●].

(c) *After the hold.* Articles 6 and 7 then apply, with notices also sent to your personal representative or beneficiary if known.

**9.3 Incapacity.** An agent under a durable power of attorney, a conservator or another person with legal authority over your property may act for you once Clear Lending receives proof of that authority, and will receive notices along with you.

**9.4 Bankruptcy.** If you file for bankruptcy:

(a) Clear Lending will stop collection and set a Liquidation Hold as soon as it has notice, and will enforce only as the court or the Bankruptcy Code permits;

(b) Clear Lending's claim is secured to the extent of the value of the Collateral, and any right of set-off it has as issuer of BurnerBonds is exercised only as the Bankruptcy Code permits;

(c) any enforcement made in breach of the automatic stay will be reversed under Section 7.10 as soon as Clear Lending has notice; and

(d) nothing here requires you to reaffirm any debt.

## Article 10. Representations and Promises

**10.1 Yours.** Each time you sign a pledge or a draw against Collateral, you represent that:

(a) you own the Collateral, free of any other lien or claim; and

(b) the information you have given Clear Lending is accurate.

You will tell Clear Lending promptly if anyone claims an interest in the Collateral.

**10.2 Clear Lending's.** Clear Lending represents and promises that:

(a) it is licensed under the California Financing Law (licence no. [●]) and will remain licensed, or exempt, in each state where it extends credit secured under this Agreement;

(b) the Pledge Module, the BurnerBond contract and the yield pool vault, as deployed, do what this Agreement describes, and no contract or wallet configuration gives Clear Lending or any Affiliate a power over your Collateral beyond Section 4.6; and

(c) it is responsible for losses caused by its own negligence, fraud or breach of this Agreement, including through the code it relies on.

**10.3 Clear's.** Clear will not amend MB-03 in a way that widens any power over your Collateral.

## Article 11. Further Assurances, Term and Changes

**11.1 Further Assurances.** You will sign any Wallet Signature or other record reasonably needed to perfect or continue the security interest in Collateral you have already pledged. A further assurance can never add Collateral, add Secured Obligations or widen enforcement beyond this Agreement.

**11.2 Term.** This Agreement continues until all Secured Obligations are paid and all credit lines under MB-04 and MB-06 are closed. Each item of Collateral is released earlier as Article 4 provides.

**11.3 Changes.** Clear Lending may change this Agreement on at least sixty (60) days' notice in the app and by email. A change that does not only benefit you applies only to Collateral pledged and draws made after it takes effect. No change may widen Clear Lending's powers under Section 4.6, or shorten any notice or cure period in Article 6.

## Article 12. Disputes

**12.1 Scope.** This Article applies to any dispute between you and Clear Lending, Clear or another Subsidiary about this Agreement or the Collateral (a "**Dispute**"), consistent with C-01 Article 9. Disputes between Members go to the Member Dispute Resolution Rules (C-07).

**12.2 Informal Resolution First.** Before starting arbitration or a small claims case, the person bringing the Dispute must send the other a written notice describing it and the relief sought. Notices to Clear Lending go to [●] or [●]. The parties must then try in good faith to resolve it for thirty (30) days. Any limitations period is paused during those thirty (30) days.

**12.3 Binding Arbitration.** Any Dispute not resolved under Section 12.2 will be decided by binding arbitration before one arbitrator, administered by the American Arbitration Association under its Consumer Arbitration Rules. Clear Lending will pay any part of your filing fee above the court filing fee. Hearings are by video or, if you choose, in your county. The Federal Arbitration Act governs this Article.

**12.4 Small Claims.** Either party may instead bring an individual Dispute in small claims court, as long as it stays there and qualifies.

**12.5 Individual Claims Only.**

(a) Disputes are resolved only individually. No class, collective, consolidated or representative proceeding is allowed, and the arbitrator may award relief only to the individual party.

(b) A request for public injunctive relief under a law that does not allow that remedy to be waived will be decided by a court, after the individual claims are arbitrated. The court case is paused until then.

(c) If a court finally decides Section 12.5(a) is unenforceable as to a claim, that claim proceeds in court, and this Article applies to all others. A court decides whether this Section 12.5 is enforceable.

**12.6 Jury Waiver.** To the extent the law permits, each party waives a jury trial in any Dispute that proceeds in court.

**12.6A Covered Borrowers.** Sections 12.3, 12.5 and 12.6 do not apply to a Dispute about consumer credit extended to you, or Collateral securing it, while you are a covered borrower under the Military Lending Act, 10 U.S.C. Section 987, and its regulations, 32 C.F.R. Part 232, to the extent that Act prohibits requiring arbitration or a waiver of rights in that Dispute. You may bring that Dispute in court, as C-01 Section 9.10 and MB-04 Section 15.10 also provide.

**12.7 Your Right to Opt Out.** You may opt out of Sections 12.3 and 12.5 by notice to Clear Lending within thirty (30) days after you accept this Agreement, in the app, at [●] or by mail to [●]. One opt-out covers every Clear arbitration agreement: a timely opt-out under this Section, under Section 9.7 of C-01, under Section 16.7 of the Website and App Terms of Use (PB-01) or under any Program Agreement opts you out of the agreement to arbitrate and the class waiver in this Agreement, in C-01, in PB-01 and in every Program Agreement between you and Clear or any Subsidiary, whether you accepted it before or after the opt-out. Opting out does not affect anything else in this Agreement. Section 12.6A applies whether or not you opt out.

## Article 13. General

**13.1 Governing Law.** This Agreement, and the creation, attachment and enforcement of the security interest, are governed by Wyoming law, including Wyoming Statutes Title 34.1 and Section 34-29-101 et seq., except that Article 12 is governed by the Federal Arbitration Act. Perfection, the effect of perfection and priority are governed by the law that the Uniform Commercial Code's choice-of-law rules select, which for CLRUSD is California's Division 12 under Section 3.2. If you reside in California, the security interest in your Collateral is created, perfected and enforced under Division 9 and Division 12 of the California Commercial Code.

**13.2 Your Consumer Protections.** Nothing in this Agreement waives any right under the law of your state of residence that cannot be waived by contract. For California residents, that includes the rights in California Commercial Code Section 9602 and the related provisions of Division 9 on notice, surplus, deficiency and commercially reasonable enforcement; the California Financing Law; and California's Rosenthal Fair Debt Collection Practices Act. Where those laws give you more protection than this Agreement, they apply.

**13.3 Notices.** Clear Lending may give you notice through the Clear app, by email, or by text message where you have consented. You may give notice to Clear Lending through the app, at [●], or by mail to [●]. A notice to you is delivered when it is posted in the app and sent by email, unless MB-17 provides otherwise.

**13.4 Electronic Signatures.** This Agreement and every pledge, release, instruction and authorization under it may be signed and delivered electronically, including by Wallet Signature, with the same effect as an ink signature, under the federal Electronic Signatures in Global and National Commerce Act and the Wyoming Uniform Electronic Transactions Act. MB-17 governs electronic delivery and the plain-language summary of each Wallet Signature.

**13.5 Assignment.** You may not assign this Agreement. Clear Lending may assign it, with the Secured Obligations, only to a successor lender that assumes all of its obligations under this Agreement, with notice to you. No assignment may give any person a power over your Collateral beyond Section 4.6.

**13.6 Severability and Survival.** If any part of this Agreement is unenforceable, the rest stays in effect. Sections 7.6, 7.7, 7.10 and 10.2(c) and Article 12 survive the end of this Agreement.

**13.7 Entire Agreement.** This Agreement, C-01, MB-03, MB-04, MB-06 and the documents they refer to are the entire agreement about the pledge of your Collateral.

---

## Schedule 1. Collateral Register and Valuation

| Collateral | Contract and network | Collateral Value | How value is read on-chain |
| --- | --- | --- | --- |
| Encumbered CLRUSD | As listed in MB-03 Schedule 2 | $1.00 per CLRUSD | Fixed |
| BurnerBond | [●] | 95% of Present Value | Face amount, issue yield and maturity stored in the bond's token data |
| Pool Share | [●]; issuer Clear Lending Co. | 70% of Pool Share Value | Vault redemption preview function |

Present Value = face amount ÷ (1 + issue yield) ^ (years to maturity), with the issue yield compounded annually. Clear Lending will update this Schedule, with notice in the app, when an address changes.

## Schedule 2. Enforcement Authorization

This is the text you sign, by Wallet Signature, when you first pledge Collateral. The app shows it in full before you sign.

> I authorize the Pledge Module installed in my Smart Account, and no other contract or person, to apply my Collateral under the Security and Pledge Agreement (MB-05) on these terms only:
>
> 1. **When.** Only after (a) an Objective Default, as recorded on-chain, and at least ten (10) full days after a Default Notice was delivered to me, with no Liquidation Hold in effect; or (b) a Shortfall that has continued for seventy-two (72) hours, as recorded on-chain.
> 2. **How much.** For an Objective Default, no more than the Defaulted Amount. For a Shortfall, no more than the smallest amount that ends the Shortfall.
> 3. **What.** My CLRUSD may be redeemed only for a Defaulted Amount of my Savings-Backed Drawn, and never for a Shortfall. My BurnerBonds may be applied only through their payment by Clear Lending Co., as issuer, at 100% or more of their Present Value under Section 4.9 of IV-01. My Pool Shares may be redeemed only through the vault at their Pool Share Value. My Ready to allocate USDC is never Collateral and is never locked.
> 4. **Where the money goes.** Only to Clear Lending Co., to reduce the debt the Collateral secures. Any surplus comes back to me.
>
> This authorization ends for each item of Collateral when it is released. It is not a waiver of any right I have under Division 9 of the Uniform Commercial Code.

## Schedule 3. Worked Examples

These examples illustrate the Agreement. If an example and the Agreement differ, the Agreement controls.

**1. Savings-backed credit.** Dana has $3,000.00 of ESA capital and draws $400.00 of savings-backed credit, so $400.00 of CLRUSD is Encumbered. She repays $150.00; in that block, Encumbered CLRUSD falls to $250.00. She then misses the cycle requirement under MB-04, and $250.00 is past due when the cycle ends. She gets a Default Notice the next day and has not paid fifteen days after cycle end. The Pledge Module redeems $250.00 of CLRUSD and pays the USDC to Clear Lending. Her ESA capital is $2,750.00, all of it Withdrawable Capital. Her vested Equity Credits do not change.

**2. Asset-backed credit and a Shortfall.** Eli pledges BurnerBonds with a Present Value of $1,000.00 (Collateral Value $950.00) and Pool Shares worth $1,000.00 (Collateral Value $700.00). His Asset-Backed Limit is $1,650.00, and he draws $1,600.00. Pool Share Value falls to $900.00, so his limit is $1,580.00 and the Shortfall is $20.00. He is notified within four hours and does nothing for 72 hours. Under Section 7.1(c), Pool Shares are applied first: redeeming $66.67 of Pool Share Value pays $66.67 off his draw and lowers his limit by $46.67, ending the Shortfall ($1,533.33 drawn against a $1,533.33 limit). (BurnerBonds would have taken $400.00). Nothing else is redeemed or accelerated, and his Savings are untouched.
---

## Signature Page

**IN WITNESS WHEREOF**, Clear Lending Co. and Clear Collective LLC adopt this Security and Pledge Agreement, effective as of the Effective Date.

**CLEAR LENDING CO.**, a Wyoming limited liability company

By: ______________________________
Name: [●]
Title: [●]
Date: [●]

**CLEAR COLLECTIVE LLC**, a Wyoming limited liability company, as to Sections 1.5, 3.2, 3.3, 3.6 and 10.3 and Article 8

By: ______________________________
Name: [●]
Title: [●]
Date: [●]

**MEMBER ACCEPTANCE**

Each Member accepts this Agreement electronically in the Clear app, and signs the Enforcement Authorization in Schedule 2 by Wallet Signature, under Sections 1.1 and 13.4. Clear Lending records the date, time, version accepted, Smart Account address and signed data of each acceptance and authorization.
