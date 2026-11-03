# Documentation

Everything written down about **CLEAR** — the app and the co-op — and about **the Clear Protocol**,
the on-chain layer underneath it, sorted by who it is for. Start with the root
[`README.md`](../README.md) for what the repository is and how to run it.

| Section | For |
|---|---|
| [Overview](./overview/README.md) | Anyone — what Clear is and how the money works |
| [Members](./members/README.md) | People using the member app |
| [Merchants](./merchants/README.md) | Shops taking Clear, and their staff |
| [Investors](./investors/README.md) | Financial contributors |
| [Governance](./governance/README.md) | How the co-op decides, and who holds which keys |
| [Developers](./developers/README.md) | Building on Clear, or working in this repository |
| [Protocol](./protocol/README.md) | The contracts, including the Deed track |
| [Operators](./operators/README.md) | Deploying, upgrading and running it |

**Governance is the one place a rule is written down.** When a member, merchant, investor or
operator page depends on who decides something or who holds a key, it links to
[`governance/`](./governance/README.md) rather than restating it, so a change is made once.

Every link in these pages points at a file that exists; CI checks it
(`scripts/check-doc-links.mjs`). Anything no longer true of the code is in
[`archive/`](./archive/README.md), not here.

---

## Design and build references

What the apps were built to, kept for the people building them. These are not documentation for
readers and will not be published with it. **Their paths are fixed:** build scripts, tests and
applied database migrations cite them, and a migration cannot be edited once it has run.

| | |
|---|---|
| [`reference/`](./reference/README.md) | The member app: the design spec, and static reference screens for Home, Savings, Earn, Activity, Send and Card |
| [`merchant-reference/`](./merchant-reference/) | The merchant app: one file per screen with every state, sheet and width, its decision log, the pilot checklist and the build prompts. `apps/merchant/scripts/reference-css.mjs` reads the HTML |
| [`pay-reference/`](./pay-reference/) | Pay with Clear: design reference and decision log. `apps/pay/scripts/reference-css.mjs` reads the HTML |
| [`rewards-reference/`](./rewards-reference/) | The rewards app: design reference, decision log and store builds. Read by the rewards and merchant reference-css scripts |
| [`command-reference/`](./command-reference/), [`command-center-plan.md`](./command-center-plan.md), [`ui-redesign-plan.md`](./ui-redesign-plan.md), [`ui-redesign/`](./ui-redesign/) | The Command Center: decision log, original plan, the UI redesign plan and its screenshots. The current design source is [`design/command-center-ui/`](../design/command-center-ui/README.md) |
| [`hardware/`](./hardware/) | Clear Terminal: the Point device API, the cash-drawer protocol and M2 reader timing. Reference for developers too — linked from [Developers](./developers/README.md) — and pinned to the firmware constants by `apps/merchant/src/hardware/docs.test.ts` |

---

## Contributing to these docs

Focused PRs against `dev`, same as code. Update the doc in the same change as the interface or
workflow it describes — that is the only way any of this stays true. A new page goes in the section
for its reader and gets a line in that section's `README.md`.

- Issues: [Deed3Labs/Protocol-Contracts/issues](https://github.com/Deed3Labs/Protocol-Contracts/issues)
- Discussions: [Deed3Labs/Protocol-Contracts/discussions](https://github.com/Deed3Labs/Protocol-Contracts/discussions)
