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
