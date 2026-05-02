---
id: PROP-006
type: PROP
status: open
proposed-by: ai
proposed-at: 2026-05-02
---

# PROP-006 — Workspace-aware `chi ship` (auto-detect, parallel, gh-batched)

## What

When `chi ship` is run from a directory **without `.git`**, treat it as a
workspace root and ship every git repo found beneath it (default depth ≤ 3).

Three-phase pipeline:

1. **Discovery** — walk the tree, collect every `.git` dir. Compare against the
   "should-exist" set from `gh repo list <user> --limit 1000` and clone any
   missing repos into the path resolved by the manifest.
2. **Local-first triage** — for each repo, run `git status --porcelain` +
   `git rev-list @{u}..HEAD` in a parallel pool. Buckets: `clean`, `dirty`,
   `ahead`. Skip `clean` entirely (no network).
3. **Parallel ship** — bounded worker pool (default 8) runs the existing
   single-repo ship logic only on `dirty` ∪ `ahead`. PR creation in flow mode
   reuses one `gh api graphql` round-trip per batch instead of N×`gh pr list`.

Single-repo behavior (`.git` present in cwd) is unchanged.

## Why

- `/Users/chevp/workspace/` has 204 git repos across category folders. `chi ship`
  today only walks `.gitmodules` ([src/commands/ship.ts:36](../../../src/commands/ship.ts#L36))
  and aborts at workspace root with "not a git repository".
- Serial × 200 repos × per-repo network latency = unusable. The dominant cost
  is round-trips, not compute, so parallelism + batched `gh api graphql`
  collapse the wall-clock from minutes to seconds for the common (mostly-clean)
  case.
- Manual repo cloning across 200+ repos drifts: a repo created on GitHub but
  never cloned locally is invisible to every workflow until somebody notices.
  Auto-clone closes that loop.

## Notes

- **New file:** `src/commands/ship-workspace.ts`. `ship.ts` gains a single
  guard: if `!isInsideRepo()`, delegate to `ship-workspace.run(argv)`.
- **Manifest:** `<workspace-root>/.chi-workspace` — minimal line-based format
  (no parser dep), one mapping per line: `<gh-repo-slug> = <local-subpath>`.
  Repos without a manifest entry surface as a doctor warning ("unmapped:
  chevp/foo — add to .chi-workspace") and are NOT auto-cloned.
- **Concurrency:** hand-rolled `Promise` pool in `src/concurrency.ts` (no dep,
  matches ADR-003). Default 8, override via `CHI_WORKSPACE_PARALLEL`.
- **gh batching:** one `gh api graphql` call per ≤50 repos pulls
  `defaultBranchRef.target.oid` + open PR head refs; replaces N×`git fetch`
  for the ahead-detection pass.
- **Push phase serialization:** parallel `git push` can collide on credential
  prompts. Mitigation: commit phase parallel, push phase serial-with-progress
  (or fully parallel iff `GIT_TERMINAL_PROMPT=0` and SSH-only — gate on env).
- **Behavior gates:**
  - `CHI_WORKSPACE_PARALLEL=N` (default 8)
  - `CHI_WORKSPACE_DEPTH=N` (default 3)
  - `CHI_WORKSPACE_AUTOCLONE=0` to opt out of clone phase
- **Out of scope** (future PROPs):
  - Workspace-wide flow mode (one branch across N repos)
  - `chi status` workspace mode
  - `chi doctor` workspace mode (manifest validation, orphaned dirs)
  - Workspace-wide rebase/conflict handling (intersects PROP-003)
- **Requires at `/promote` time:**
  - ADR for workspace discovery + manifest format (new pattern)
  - Challenger pass (Top-3 failure modes; auth-prompt deadlock + partial-clone
    state + manifest drift are the obvious candidates)
  - Kill criteria (e.g., "if wall-clock for 200 mostly-clean repos exceeds 10s
    on the reference machine, redesign or abandon")
