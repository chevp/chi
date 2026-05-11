---
id: CTX-002
type: CTX
status: proposed
gate: G1
proposed-by: ai
proposed-at: 2026-05-11
supersedes: —
related: PROP-007-chevix-agents-consult.md
---

# CTX-002 — AI-Orchestration Providers & Framework-aware CLI

## Problem statement

`chi` today knows two providers — `cura` (hosted Ollama) and local `ollama` —
and the [Provider interface](../../src/provider/types.ts) only exposes a
fire-and-forget `generate(prompt: string) => Promise<string>`. That is
enough for short helpers like `chi commit` or `chi explain`, but it cannot
host the orchestrated workflows that the user now wants chi to drive:

- Multi-turn agent conversations with **tool use** (read/write files, run
  bash, search the workspace).
- Interactive **ask-user-question** loops (chi pauses, the model asks,
  the user answers via the terminal, chi resumes).
- The **chevp-ai-framework** governance loop — Context (G1) → Exploration
  (G2) → Production (G3), with `/approve`, `/promote`, `/reject` actions
  on `CTX/EXP/PRD/PROP` artifacts under [context/plans/](.).
- Workspace-awareness: when chi runs from the top-level `~/workspace`
  root rather than inside a single repo, cross-repo questions should be
  answerable.

Five questions this plan must answer before G2 (Exploration):

1. What is the **new Provider surface** for tool-use / multi-turn / streaming —
   and how does it stay non-disruptive to the existing `cura`/`ollama`
   providers that only do `generate`?
2. Which **chi commands** materialize the framework's mensch-KI-Schnittstelle
   (`consult`, `plan`, `gate`, `approve`, `promote`, `reject`) and which
   are deferred to a follow-up plan?
3. How does chi **detect workspace mode** (running at workspace root vs.
   inside a sub-repo) and how does that change provider/agent routing?
4. How is the **first runtime dependency** (`@anthropic-ai/claude-agent-sdk`)
   reconciled with [ADR-003 Zero Runtime Dependencies](../adr/ADR-003-zero-runtime-dependencies.md)?
   This requires a new ADR that carves out a narrow exception.
5. How does the new `claude-agent` provider interact with the framework's
   **gatekeeper subagents** (`gatekeeper-g1/g2/g3`) — does chi spawn them
   directly via the Agent SDK's `Task` tool, or via a chevix-agents lookup?

## Hypotheses

**H1 — A new `Orchestrator` layer above `Provider` is sufficient; the
existing `Provider` interface stays untouched.**
The chevp-ai-framework workflows (multi-turn + tool use + ask_user) are
qualitatively different from one-shot text generation. Mixing them into
the same interface would force every provider (including the local
`ollama` smollm2:135m that has no tool-use support) to implement methods
it will never run.

- *Kill criterion:* if implementing two real commands (`chi consult` and
  `chi plan`) requires us to add more than one new method to the existing
  `Provider` interface, H1 is dead and we move to extending `Provider`
  with optional capabilities. The boundary is: the new orchestrator may
  *call* `Provider.generate()` for small completions (e.g. issue title
  drafting) but no orchestration logic leaks into the `Provider` contract.

**H2 — The `@anthropic-ai/claude-agent-sdk` covers ≥ 90 % of the desired
file-I/O, bash, and ask-user-question surface out of the box; custom
chi-specific tools are an additive layer (MCP server or in-process tool
registration) rather than a replacement.**
The user picked the high-level Agent SDK precisely so chi does not
re-implement Read/Edit/Bash. Custom tools chi will need:
- `chi.plan.create` / `chi.plan.list` (creates CTX/EXP/PRD files with
  frontmatter)
- `chi.gate.run` (invokes a gatekeeper subagent on a given plan-id)
- `chi.ask_user` (forwards a question to the terminal via readline)

- *Kill criterion:* if the Agent SDK's built-in tools cannot be combined
  with a custom in-process tool list (i.e. enabling `Read` forces us to
  also accept some sandbox we cannot escape, or custom tools cannot
  return structured `tool_result` blocks the model treats as first-class),
  H2 is dead and we fall back to the low-level `@anthropic-ai/sdk` and
  implement the loop ourselves. This re-opens the SDK choice decision.

**H3 — Workspace-mode detection is a 20-line resolver, not a new
subsystem.**
chi can detect workspace mode by walking up from `cwd` until it either
hits a directory containing a `CLAUDE.md` that mentions
"chevp-workflow" / "Workspace Mode" *and* contains sub-folders that are
themselves git repos, or hits filesystem root. The same resolver picks
the cwd that gets handed to the Agent SDK (`options.cwd`).

- *Kill criterion:* if the resolver produces false positives on a
  realistic workspace fixture (≥ 5 sub-repos with their own CLAUDE.md),
  H3 is dead and we require an explicit `chi config workspace_root` env
  var instead of auto-detect.

## Risks

1. **Runtime dependency lock-in (R1, expensive).** Adding
   `@anthropic-ai/claude-agent-sdk` permanently breaks
   [ADR-003](../adr/ADR-003-zero-runtime-dependencies.md). The SDK pulls
   its own transitive deps (the Anthropic JS SDK plus zod, etc.). Once
   accepted, *future* one-off "just one small dep" PRs will cite this as
   precedent. Mitigation: ADR-007 must explicitly narrow the exception
   to "SDKs strictly required for AI orchestration", forbid generic
   utility deps, and require any further dep to spawn its own ADR.

2. **API-key handling on machines that have only cura credentials (R2,
   expensive).** Today chi reads `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`
   from env or `~/.chi/config`. The Agent SDK needs `ANTHROPIC_API_KEY`.
   If a user runs `chi consult` without the new key, we must fail with a
   clear "missing ANTHROPIC_API_KEY — run `chi init --provider=claude`"
   rather than a stack trace from inside the SDK. Mitigation: extend
   `chi doctor` to check for the new key when the active provider is
   claude-agent; add `chi init --provider=claude` flow analogous to the
   existing cura-credentials prompt.

3. **Permission-mode footgun (R3, expensive).** The Agent SDK's
   `bypassPermissions` mode lets the model write to and delete files
   silently. If `chi consult` defaults to that, a malicious prompt or
   confused-deputy attack could damage the working tree. Mitigation:
   default to `permissionMode: "plan"` for `chi consult` (read-only),
   require an explicit `--write` flag to unlock `acceptEdits`, and a
   second flag `--dangerously-allow-bash` for `bypassPermissions`. Mirror
   the warning text from the existing
   `--dangerously-skip-permissions` muscle memory.

4. **Provider-parity drift.** CLAUDE.md mandates "when adding behavior to
   one provider, mirror it in the others (or document why not)." The
   `cura` and `ollama` providers cannot meaningfully implement tool-use
   against `smollm2:135m`. Mitigation: keep the new capability *out* of
   the `Provider` interface entirely (per H1). The orchestrator layer is
   claude-only; `cura`/`ollama` continue to work for `commit/explain/etc.`
   unchanged. Document the deliberate split in ADR-007.

5. **Plan/gate command scope creep.** "Voller Stack inkl. Workspace-
   Awareness" easily expands into a full re-implementation of the
   framework's `/approve`, `/promote`, `/reject`, `/defer`, `/gate-
   override` surface plus all three gatekeeper subagents. Mitigation:
   v1 in this plan ships only `chi consult` and `chi plan new
   <CTX|EXP|PRD|PROP|ADR>`. `chi gate` and `chi approve` are deferred
   to a follow-up CTX-003 (see Out of scope below).

## Scope

### In scope (v1, this plan)

- **New provider:** `claude-agent` (uses `@anthropic-ai/claude-agent-sdk`),
  registered alongside `cura`/`ollama` but exposed via the new orchestrator
  layer, not the `Provider` interface.
- **New orchestrator layer** at `src/orchestrator/`:
  - `types.ts` — `Orchestrator`, `OrchestratorOptions`, `AskUserHandler`.
  - `claude-agent.ts` — wraps `query()` from the Agent SDK, surfaces
    assistant messages and `tool_use` events.
  - `ask-user.ts` — readline-based terminal Q&A; pluggable via
    `AskUserHandler` so workflow YAML or tests can stub it.
  - `index.ts` — `getOrchestrator(name?)` picker.
- **New commands** (registered in [src/index.ts](../../src/index.ts)):
  - `chi consult [<question>] [--agent <name>] [--write] [--dangerously-allow-bash]`
  - `chi plan new <CTX|EXP|PRD|PROP|ADR> "<title>"` — scaffolds a new
    file with framework-conformant frontmatter under `context/plans/` or
    `context/adr/`.
  - `chi plan list [<type>]` — enumerates plans by type/status.
- **Workspace-mode detection** in `src/workspace.ts`:
  - `resolveWorkspaceRoot(cwd): { mode: "workspace" | "repo"; root: string }`.
  - Consumed by `chi consult` to pick `options.cwd` for the Agent SDK.
- **Config surface:** new `~/.chi/config` keys + envs:
  - `anthropic_api_key` / `ANTHROPIC_API_KEY`
  - `claude_model` / `CHI_CLAUDE_MODEL` (default `claude-opus-4-7`)
  - `claude_permission_mode` / `CHI_CLAUDE_PERMISSION_MODE`
    (default `plan` — read-only)
- **`chi doctor claude`** — verifies `ANTHROPIC_API_KEY` is set and a
  one-token `query()` call succeeds.
- **`chi init --provider=claude`** — interactive prompt for the API key,
  writes to `~/.chi/config` with chmod 600.
- **One ADR:** ADR-007 carves the narrow `@anthropic-ai/claude-agent-sdk`
  exception out of ADR-003.

### Out of scope (deferred to CTX-003 / future PROPs)

- `chi gate g1|g2|g3` — gatekeeper subagent invocations. Needs
  chevix-agents vendoring decision (still open per PROP-007).
- `chi approve <plan-id>` / `chi reject` / `chi promote` / `chi defer` —
  the `/approve` family. Touches frontmatter rewriting in YAML; deserves
  its own scoped plan.
- Cross-repo `chi consult --workspace` — answering one question against
  multiple sub-repos. Intersects with PROP-006 (workspace-ship); track
  there.
- Streaming output in the terminal (`--stream`). v1 prints assistant
  messages on completion; streaming is a follow-up flag.
- Custom MCP servers for chi-specific tools beyond the three listed in
  H2. The ADR locks the surface; new tools require their own plan entry.
- Replacing or removing the existing `cura`/`ollama` providers. They
  continue to serve `chi commit` / `chi explain` / `chi issue` unchanged.

## System spec — proposed shape

**Layering.**

```
src/
  provider/           ← unchanged (cura, ollama, generate-only)
    types.ts
    cura.ts
    ollama.ts
    index.ts
  orchestrator/       ← NEW
    types.ts          ← Orchestrator, OrchestratorOptions, AskUserHandler
    claude-agent.ts   ← @anthropic-ai/claude-agent-sdk wrapper
    ask-user.ts       ← readline Q&A
    tools/            ← in-process tool definitions
      chi-plan.ts     ← chi.plan.create / chi.plan.list
      chi-ask-user.ts ← chi.ask_user (delegates to ask-user.ts)
    index.ts          ← getOrchestrator() picker
  workspace.ts        ← NEW: resolveWorkspaceRoot()
  commands/
    consult.ts        ← NEW
    plan.ts           ← NEW
    ... (existing)
```

**`Orchestrator` interface (proposed).**

```ts
export interface OrchestratorOptions {
  cwd: string;                          // resolved via workspace.ts
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";
  allowedTools: string[];               // Agent SDK built-ins + chi.* tools
  model?: string;                       // default "claude-opus-4-7"
  askUser?: AskUserHandler;             // pluggable; default = readline
  systemPrompt?: string;                // for agent persona injection
}

export interface AskUserHandler {
  prompt(question: string, options?: string[]): Promise<string>;
}

export interface Orchestrator {
  readonly name: "claude-agent";
  ping(): Promise<boolean>;
  /** Multi-turn run. Streams messages via the async iterator. */
  run(opts: OrchestratorOptions, prompt: string): AsyncIterable<OrchestratorEvent>;
}
```

**Event types** (assistant text, tool-use audit log, result/cost summary)
are deliberately narrower than the SDK's raw message types so we can swap
the SDK if H2 dies without changing command code.

**Defaults that lock-in safety.**

| Concern | Default | Override |
|---------|---------|----------|
| Permission mode | `plan` (read-only) | `--write` → `acceptEdits` ; `--dangerously-allow-bash` → `bypassPermissions` |
| Tools allowed | `Read`, `Glob`, `Grep`, `chi.ask_user`, `chi.plan.list` | `--write` adds `Edit`, `Write` ; `--dangerously-allow-bash` adds `Bash` |
| Working dir | Workspace root if detected, else repo root | `--cwd <path>` |
| Model | `claude-opus-4-7` | `--model <id>` or `CHI_CLAUDE_MODEL` |

**`chi consult` lifecycle.**

1. Parse argv. If no `<question>`, prompt via readline.
2. `resolveWorkspaceRoot(process.cwd())` → set `options.cwd`.
3. Pick allowed tools per flags. Refuse `--dangerously-allow-bash`
   without `--write` (explicit safety).
4. `getOrchestrator("claude-agent").run(opts, question)`.
5. For each event:
   - `assistant_text` → print to stdout.
   - `tool_use` → print one-line audit (`→ Read src/foo.ts`).
   - `ask_user` → readline prompt, send back as tool_result.
   - `result` → print cost/tokens to stderr.
6. Exit code 0 on completion, 1 on SDK error, 2 on user-cancelled.

**`chi plan new <type> "<title>"` lifecycle.**

1. Determine next `NNN` for the given type (`CTX/EXP/PRD/PROP/ADR`) by
   scanning the relevant folder.
2. Slugify title → filename.
3. Write file with framework-conformant frontmatter:
   `id`, `type`, `status: proposed`, `proposed-by: ai|human|pair`,
   `proposed-at: <today>`, empty body with the section skeleton from
   [CTX-001](CTX-001-worktree-parallelization.md).
4. Print the new path on stdout.

## Context inventory — existing code touched

| File | Change |
|------|--------|
| [src/index.ts](../../src/index.ts) | register `consult`, `plan` in dispatch table |
| [src/provider/types.ts](../../src/provider/types.ts) | **unchanged** (H1) |
| [src/provider/index.ts](../../src/provider/index.ts) | **unchanged** (orchestrator is parallel, not nested) |
| [src/orchestrator/](../../src/) | **new** subtree (see System spec) |
| [src/workspace.ts](../../src/) | **new** (workspace-root resolver) |
| [src/commands/consult.ts](../../src/commands/) | **new** |
| [src/commands/plan.ts](../../src/commands/) | **new** |
| [src/commands/init.ts](../../src/commands/init.ts) | add `--provider=claude` branch |
| [src/commands/doctor.ts](../../src/commands/doctor.ts) | add `claude` check |
| [src/commands/help.ts](../../src/commands/help.ts) | document `consult` + `plan` |
| [src/config.ts](../../src/config.ts) | three new keys in `KEY_TO_ENV` |
| [package.json](../../package.json) | add `@anthropic-ai/claude-agent-sdk` to `dependencies` |
| [README.md](../../README.md) | porting matrix entry, usage section |

## ADRs

- **ADR-007 (proposed)** — "Narrow exception to ADR-003 for AI
  orchestration SDKs." Records the carve-out, the security defaults
  (`permissionMode: "plan"` default, opt-in bash), and the rule that any
  *further* runtime dependency still requires its own ADR.

## Kill Criteria

Roll this plan back to proposal (or to a smaller PROP) if any of:

- ADR-007 cannot get past review: the user prefers to stay 100 % zero-
  dependency. Fallback: implement against the low-level
  `@anthropic-ai/sdk` only and hand-roll Read/Write/Bash tools — this is
  a different plan and re-opens the SDK choice.
- A 50-line prototype of `Orchestrator.run()` with one built-in tool
  (`Read`) and one custom tool (`chi.ask_user`) cannot complete an
  end-to-end "ask, read a file, answer" round-trip on
  `claude-opus-4-7`. H2 dies, see its kill criterion.
- The Agent SDK's permission model leaks: `permissionMode: "plan"`
  performs writes anyway in a test fixture. Without a watertight
  read-only mode, R3 is unfixable and we cannot ship `chi consult` as
  a safe default.

## Open questions — proposed defaults

These were settled via AskUserQuestion (per framework rule) before
authoring this plan:

| # | Question | User choice | Why this plan reflects it |
|---|----------|-------------|---------------------------|
| 1 | Which SDK? | `@anthropic-ai/claude-agent-sdk` (high-level) | One new dep, one ADR; tool-loop owned by SDK |
| 2 | Command scope? | Full stack incl. workspace-awareness | This plan adds `consult` + `plan` + workspace resolver; `gate`/`approve` deferred to CTX-003 to keep v1 shippable |
| 3 | Provider seam? | New orchestrator layer above Provider | `Provider` interface untouched; H1 codifies the boundary |

Remaining defaults — confirmed by user 2026-05-11 (awaiting formal
`/approve` to flip frontmatter `decided-by`/`approved-by`):

| # | Question | Decided default | Override path |
|---|----------|-----------------|---------------|
| 4 | Default permission mode for `chi consult` | `plan` (read-only) | `--write` / `--dangerously-allow-bash` |
| 5 | Default model | `claude-opus-4-7` | `CHI_CLAUDE_MODEL` env / `--model` flag |
| 6 | Where does workspace-root detection live? | New `src/workspace.ts` | Could move to `src/git/` later if it grows |
| 7 | Custom tool prefix | `chi.*` (e.g. `chi.ask_user`, `chi.plan.create`) | Matches Claude Code's `mcp__<server>__<tool>` shape conceptually |
| 8 | When does `ANTHROPIC_API_KEY` become a hard requirement? | **Only when invoking a claude-agent-backed command** (`chi consult`, `chi plan new`, future `chi gate`/`chi approve`). All pre-existing commands (`status`, `commit`, `ship`, `flow`, `done`, `issue`, `explain`, `init` without `--provider=claude`, `update`, `config`, `doctor` without the `claude` subcheck, `workflow`, `run`, `work`, `release`) must continue to function with **only** `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` set, exactly as today. Failure mode for the new commands when the key is missing: exit non-zero with `chi consult: ANTHROPIC_API_KEY is not set — run \`chi init --provider=claude\` or export the env var`. | — |

**Implementation guard for #8** (mirrored as an acceptance criterion):
the key check lives inside `src/orchestrator/claude-agent.ts` at the
first `query()` call — not in `loadPersistedConfig()` or any boot path.
A unit/integration test must prove that `chi status` / `chi commit`
/ `chi doctor` succeed in an environment where only the cura credentials
are present, no claude key, the SDK module not even importable. The
existing [src/config.ts](../../src/config.ts) gains the
`anthropic_api_key` → `ANTHROPIC_API_KEY` mapping but does **not** treat
the key as required.

## Acceptance criteria for G1 → G2

- [x] User has approved the three SDK / scope / seam choices captured in
      the "Open questions — proposed defaults" table above. *(2026-05-11)*
- [x] User has approved the five remaining defaults (#4–#8), with #8
      refined to "key blocks **only** claude-agent-backed commands; all
      pre-existing commands keep working without it." *(2026-05-11)*
- [ ] H1, H2, H3 stand (no falsifying evidence raised in review).
- [ ] Risks R1–R5 acknowledged; mitigations agreed.
- [ ] Scope (in/out) signed off — in particular the deferral of
      `chi gate` / `chi approve` to CTX-003.
- [ ] ADR-007 draft reviewed (does it acceptably narrow ADR-003?).
- [ ] Frontmatter flipped to `decided-by: chevp` / `approved-by: chevp`
      / `approved-at: <date>` on this plan **and** on ADR-007. Per
      framework rule, only the human writes these fields.

Once all checked, this plan moves to **EXP-002** (Exploration-B:
prototype `Orchestrator.run()` end-to-end on a single command, then
decide between two candidate API surfaces — the one specified here vs.
a streaming-first variant — before committing to PRD-003).
