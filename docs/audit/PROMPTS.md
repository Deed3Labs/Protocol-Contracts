# Prompts for the Claude Code cloud sessions

Start each one as a cloud session (claude.ai/code, the Claude app, or the desktop app with Cloud selected) on `Deed3Labs/Protocol-Contracts`. Run one phase per session: a fresh session for each phase is cheaper than one long one.

Order: Phase 1, then Phase 2 and Phase 3 (these two can run at the same time in separate sessions), then Phase 4.

---

## Phase 1: fix every audit finding

```
Work in Deed3Labs/Protocol-Contracts. Read docs/audit/FIX-PLAN.md in full first, then docs/audit/DECISIONS.md. Open the finding reports (AUDIT-REPORT.md, DEEP-FINDINGS.md, DEED-FINDINGS.md) only as each step needs them.

Do Phase 0 and Phase 1 exactly as the plan says:
- Branch audit/phase-1 from dev.
- Do workstream 1A yourself.
- Run 1B and 1C as two subagents in parallel, each with a complete brief. Use Sonnet subagents for mechanical work.
- Follow sections 2 and 3 of the plan (ground rules and saving usage).
- Never deploy, never use a key, never touch a live network.

Push the branch after each numbered step and keep docs/audit/PHASE-1-PROGRESS.md current. When the Phase 1 done-criteria are met:
- write docs/audit/PHASE-1-REPORT.md;
- open one PR into dev;
- stop and summarise the report in under 200 words.
```

## Phase 2: compliance spec (after Phase 1 is merged)

```
Work in Deed3Labs/Protocol-Contracts. Read docs/audit/FIX-PLAN.md (sections 2, 3, 4 "Phase 2", 6 and 7), docs/audit/DECISIONS.md and docs/audit/specs/compliance-changes.md. Use docs/audit/PHASE-1-REPORT.md for what changed in Phase 1.

Branch audit/phase-2-compliance from dev and build Phase 2 in the plan's order. A Sonnet subagent may build RateSchedule and its tests while you do the issuer changes. Implement acceptance tests 1-17, recomputing the figures for per-second accrual (DECISIONS #1). Never deploy or use keys.

Push after each step and keep docs/audit/PHASE-2-PROGRESS.md current. When done:
- write docs/audit/PHASE-2-REPORT.md and docs/audit/UPGRADEABILITY.md;
- open one PR into dev;
- stop with a summary under 200 words, listing any conflicts with the spec's "Do NOT change" list.
```

## Phase 3: Deed trust agreement v5 (after Phase 1 is merged; can run alongside Phase 2)

```
Work in Deed3Labs/Protocol-Contracts. Read docs/audit/FIX-PLAN.md (sections 2, 3, 4 "Phase 3", 6 and 7), docs/audit/DECISIONS.md (the trust agreement addendum section and #8-#10), and both files under docs/audit/specs/deed-trust-v5-*. The addendum supersedes item 8 of the brief. Use docs/audit/PHASE-1-REPORT.md for what changed in Phase 1.

Branch audit/phase-3-deed-v5 from dev. Touch only Deed-track files plus the new CoopTransferAgent and Functional Contract registry. Never deploy or use keys.

Push after each step and keep docs/audit/PHASE-3-PROGRESS.md current. When done:
- write docs/audit/DEED-V5-INTERFACE.md (final function signatures, events, reserved trait keys, and every deviation from the brief with its reason) and docs/audit/PHASE-3-REPORT.md;
- open one PR into dev;
- stop with a summary under 200 words.
```

## Phase 4: independent re-review (after Phases 1-3 are merged)

```
Work in Deed3Labs/Protocol-Contracts on dev. Read docs/audit/FIX-PLAN.md section 4 "Phase 4" and all PHASE-*-REPORT.md files. Branch audit/phase-4-rereview.

Run Phase 4. The reviewer subagent must get only the diff 7eb5976..HEAD and the original finding reports, not the phase reports. Its job is to find what the fixes broke or missed.

Never deploy or use keys. If BASE_SEPOLIA_RPC_URL is set, do the read-only fork rehearsal; if not, skip it and say so.

Write docs/audit/REREVIEW.md, open one PR into dev, and stop with a summary under 200 words.
```

## Resuming a phase that stopped

```
Resume Phase N in Deed3Labs/Protocol-Contracts on branch <branch>. Read docs/audit/PHASE-N-PROGRESS.md and `git log --oneline -20`, then continue from the first unticked step. Don't redo finished steps. Follow docs/audit/FIX-PLAN.md as before.
```
