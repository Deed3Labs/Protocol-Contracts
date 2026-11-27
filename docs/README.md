# Documentation

Documentation for **Clear** — the app and the co-op — and for **the Clear Protocol**, the on-chain
layer underneath it, sorted by who it is for. New to Clear? Start with the
[Overview](./overview/README.md). To run the software, start with [Developers](./developers/README.md).

| Section | For |
|---|---|
| [Overview](./overview/README.md) | Anyone — what Clear is and how the money works |
| [Members](./members/README.md) | People using the member app |
| [Merchants](./merchants/README.md) | Shops taking Clear, and their staff |
| [Investors](./investors/README.md) | Financial contributors |
| [Contributors](./contributors/README.md) | People contributing land or property |
| [Governance](./governance/README.md) | How the co-op decides, and who holds which keys |
| [Developers](./developers/README.md) | Building on Clear, or running and changing its software |
| [Protocol](./protocol/README.md) | The contracts, including the Deed track, and a [reference page for every deployed contract](./protocol/contracts/README.md) |
| [Operators](./operators/README.md) | Deploying, upgrading and running it |

**Who decides what is set out in [Governance](./governance/README.md).** Every other section links
there for who decides something or who holds a key.

Superseded material is in [`archive/`](./archive/README.md).

---

## Design and build references

Design specifications the apps are built to. They are reference material for contributors to the
software, not part of the published documentation. **Their paths are fixed:** build scripts, tests and
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

## Contributing to the documentation

Open a focused pull request against `dev`, as for code, and update the documentation in the same change
as the interface or workflow it describes. A new page goes in the section for its reader and gets a
line in that section's `README.md`.

CI checks that every link resolves (`scripts/check-doc-links.mjs`) and that the
[contract reference](./protocol/contracts/README.md) matches `deployments/`
(`scripts/docs/contract-reference.mjs --check`).

- Issues: [Deed3Labs/Protocol-Contracts/issues](https://github.com/Deed3Labs/Protocol-Contracts/issues)
- Discussions: [Deed3Labs/Protocol-Contracts/discussions](https://github.com/Deed3Labs/Protocol-Contracts/discussions)
