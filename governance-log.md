# Governance Log

Append-only log of gate transitions, ADR approvals, plan promotions, and overrides for the `chi` project.

Format (one line per event):

```
YYYY-MM-DD | <human-name> | <event-type> | <artifact-id> | <rationale>
```

Event types: `gate-pass`, `gate-block`, `gate-override`, `adr-accepted`, `adr-superseded`, `plan-approved`, `plan-rejected`, `plan-completed`.

---

2026-04-29 | chevp | framework-installed | chevp-ai-framework | Full installation seeded (CLAUDE.md, context/ tree, ADR-001..003, system-architecture.md)
2026-04-29 | chevp | plan-approved | PRD-001-full-port | Full che-cli → chi TS port; kill criteria documented; out-of-scope items recorded as PROP-001..003
2026-04-29 | chevp | plan-completed | PRD-001-full-port | All 11 acceptance criteria met (build clean, status/commit dry-run/config/doctor/workflow {list,show,run,trigger} verified). Moved to finished/. Deferred work captured as PROP-001..005.
2026-04-29 | chevp | gate-pass | G3 | PRD-001 production complete: tsc clean, smoke tests pass for status/help/doctor/config/workflow chain, dispatcher routes built-ins + workflow triggers correctly.
2026-05-02 | chevp | gate-pass | G1 | PROP-006 context complete: H1-H3 with test+kill criterion, R1-R3 expensive risks with mitigations (R4 mitigated by design), ADR-004 scope sketched; status moved to exploration.
2026-05-02 | chevp | gate-pass | G1 | PROP-008 context complete: H1-H3 with kill criteria, R1-R4 with mitigations, hybrid architecture (workflow YAML + thin TS subcommand) chosen via AskUserQuestion; no new ADR (zero new runtime deps).
2026-05-02 | chevp | plan-approved | PROP-008 | Implementation: .che/workflows/issue-fix.yml + .che/scripts/issue-fix.sh + cmdFix in src/commands/issue.ts. Endpoint: code-change only, manual chi ship/done.
2026-05-02 | chevp | adr-accepted | ADR-004 | Workspace discovery + manifest format + concurrency primitive + provider call serialization for PRD-002.
2026-05-02 | chevp | gate-pass | G2/PRD-002 | H1 PASS (1.6s warm, 4.7s cold @ 205 repos, 5.85x speedup, conc=8 sweet spot), H2 PASS (12 repos in 1 GraphQL call @ 1.2s); H3 deferred to G3 fault-injection. Evidence: insights-PRD-002.md.
2026-05-02 | chevp | plan-approved | PRD-002-workspace-ship | Production approved; auto-detect workspace mode for chi ship, parallel triage + serial-with-progress push + provider single-slot queue.
2026-05-02 | chevp | gate-pass | G3 | PRD-002 production complete: tsc clean, workspace discovery + concurrency pool + provider semaphore landed via PR #6. Issue #1 closed.
2026-05-02 | chevp | plan-completed | PRD-002-workspace-ship | Implemented in PR #6 (merged); plan moved to finished/. Issue #1 (chevp/chi#1) closed with reference.
2026-05-02 | chevp | adr-accepted | ADR-005 | Bundled workflow fallback: resolveWorkflow falls back to chi's own .che/workflows/ when no per-repo override exists; runner skips chdir for built-in workflows so scripts operate on the user's repo. Fixes `chi issue fix` failing in consumer repos that don't ship issue-fix.yml.
