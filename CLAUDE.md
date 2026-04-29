# CLAUDE.md — chi

## Before Writing Code

Reads, greps and explanations are always free. Before you **create, edit or delete** any file:
1. Load the framework:
   @url https://chevp.github.io/chevp-ai-framework/chevp-ai-framework.md
2. Announce the inferred lifecycle step (Context / Exploration / Production)

> Note: The 3-step lifecycle applies per task, not per project. Every change starts at Context.

## What Is This Project?

`chi` is a Node.js / TypeScript port of [che-cli](https://github.com/chevp/che-cli) — a small developer CLI that wraps git workflows and AI provider calls (Claude Code, Copilot, Ollama). Same UX as `che`, no runtime dependencies, hand-rolled command dispatch.

Status: Phase 1 — `chi status` works end-to-end; other commands are stubs. See [README.md](README.md) for the full porting matrix.

## Architecture

- **Hand-rolled dispatcher** in [src/index.ts](src/index.ts) routes argv to commands. No commander/yargs.
- **Provider abstraction** in [src/provider/types.ts](src/provider/types.ts) — each AI backend (claude-code, copilot, ollama) implements the same `Provider` interface; the router picks one via `CHI_PROVIDER`.
- **Commands** live in [src/commands/](src/commands/) — one file per subcommand. Un-ported commands use `stub.ts`.
- **Config** in [src/config.ts](src/config.ts) reads `~/.chi/config` then overrides with env vars.
- **No runtime dependencies** — only Node 20+ stdlib + a TypeScript dev dependency.

Key decisions are recorded in [context/adr/](context/adr/).

## Documentation

| Folder | Content |
|--------|---------|
| [context/architecture/](context/architecture/) | System architecture artifacts |
| [context/adr/](context/adr/) | Architecture Decision Records |
| [context/guidelines/](context/guidelines/) | Development guidelines (project-specific tightening) |
| [context/plans/](context/plans/) | CTX / EXP / PRD plans (`finished/`, `proposals/`) |
| [context/specs/](context/specs/) | Feature specifications |
| [governance-log.md](governance-log.md) | Append-only gate-transition / approval log |

## Build Commands

```sh
npm install
npm run build           # tsc → dist/
npm link                # makes `chi` available on PATH
npm run dev -- <cmd>    # iterative run without rebuild
```

## Conventions

- **TypeScript strict mode.** No `any` without justification in a code comment.
- **Zero runtime dependencies.** New `dependencies` entries in [package.json](package.json) require an ADR.
- **Forward slashes** in any path written to files; this project must build on Windows, macOS, and Linux.
- **Provider parity** — when adding behavior to one provider, mirror it in the others (or document why not in the command's plan).
- **Stubs print and exit non-zero.** A stub command must surface "not yet ported" rather than silently no-op.
- Commit messages follow the existing log style — short imperative subject, optional body.
