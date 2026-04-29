# chi

A Node.js port of [che-cli](https://github.com/chevp/che-cli). Same UX,
TypeScript implementation, hand-rolled command dispatch (no commander/yargs),
no runtime dependencies.

> **Status:** Full command-set ported. See [Porting status](#porting-status)
> for the per-command mapping.

```sh
$ chi status

chi-cli
  platform           windows
  provider           claude-code (model: claude-code (CLI-managed))
  reachable          yes

git
  repo               chi
  branch             main
  state              clean

recent commits
  1a2b3c4 initial scaffold (1 minute ago)
```

## Install (development)

Requires Node 20+.

```sh
git clone https://github.com/chevp/chi.git
cd chi
npm install
npm run build
npm link        # makes `chi` available on PATH

chi status
```

For iterative development without rebuilding:

```sh
npm run dev -- status
```

## Configuration

Runtime config is read from environment variables, with persistent defaults
stored in `~/.chi/config` (overridden by explicit env vars).

| Variable                | Default                  |
|-------------------------|--------------------------|
| `CHI_PROVIDER`          | `claude-code`            |
| `CHI_OLLAMA_HOST`       | `http://localhost:11434` |
| `CHI_OLLAMA_MODEL`      | `llama3.2`               |
| `CHI_MAX_DIFF_CHARS`    | `8000`                   |
| `CHI_FORCE_CLAUDE_CODE` | unset                    |
| `CHI_CONFIG_FILE`       | `~/.chi/config`          |

## Project layout

```
chi/
├── bin/
│   ├── chi              # node shim → dist/index.js
│   └── chi.cmd          # Windows shim
├── src/
│   ├── index.ts         # dispatcher (hand-rolled arg routing)
│   ├── platform.ts      # OS detection (darwin/windows/wsl/linux)
│   ├── ui.ts            # ANSI colors + section/kv printers
│   ├── config.ts        # ~/.chi/config loader (env-var precedence)
│   ├── git/
│   │   └── index.ts     # git wrappers (porcelain, ahead/behind, etc.)
│   ├── provider/
│   │   ├── types.ts     # Provider interface
│   │   ├── index.ts     # provider router
│   │   ├── claude-code.ts
│   │   ├── copilot.ts
│   │   └── ollama.ts
│   └── commands/
│       ├── help.ts
│       ├── status.ts    # ✓ ported
│       └── stub.ts      # placeholder for un-ported commands
├── package.json
├── tsconfig.json
└── README.md
```

Each provider implements the same `Provider` interface (see
[src/provider/types.ts](src/provider/types.ts#L3)) so the dispatcher can route to
whichever is selected by `CHI_PROVIDER`.

## Porting status

Mapping from che-cli (shell) → chi (TS):

| che-cli                              | chi                          | Status |
|--------------------------------------|------------------------------|--------|
| `lib/che/platform.sh`                | `src/platform.ts`            | ✓ done |
| `lib/che/config_load.sh`             | `src/config.ts`              | ✓ done |
| `lib/che/provider.sh`                | `src/provider/index.ts`      | ✓ done (interface + router; generators are Phase 2) |
| `lib/che/ollama/client.sh`           | `src/provider/ollama.ts`     | partial (ping + hasModel; generate Phase 2) |
| `lib/che/claude-code/client.sh`      | `src/provider/claude-code.ts`| partial (ping; generate Phase 2) |
| `lib/che/copilot/client.sh`          | `src/provider/copilot.ts`    | partial (ping; generate Phase 2) |
| `lib/che/status.sh`                  | `src/commands/status.ts`     | ✓ done (core sections; submodules/issues/PRs/plans Phase 2) |
| `lib/che/git/commit.sh`              | `src/commands/commit.ts`     | stub   |
| `lib/che/git/ship.sh`                | `src/commands/ship.ts`       | stub   |
| `lib/che/git/flow.sh`                | `src/commands/flow.ts`       | stub   |
| `lib/che/git/done.sh`                | `src/commands/done.ts`       | stub   |
| `lib/che/issue.sh`                   | `src/commands/issue.ts`      | stub   |
| `lib/che/explain.sh`                 | `src/commands/explain.ts`    | stub   |
| `lib/che/init.sh`                    | `src/commands/init.ts`       | stub   |
| `lib/che/workflow.sh` + workflow/    | `src/commands/workflow.ts`   | stub   |
| `lib/che/reinstall.sh`               | `src/commands/reinstall.ts`  | stub   |
| `lib/che/config.sh`                  | `src/commands/config.ts`     | stub   |
| `lib/che/doctor.sh`                  | `src/commands/doctor.ts`     | stub   |
| `lib/che/frontmatter.sh`             | `src/frontmatter.ts`         | not started |
| `lib/che/json.sh`                    | (replaced by native JSON)    | n/a    |
| `lib/che/ui.sh`                      | `src/ui.ts`                  | ✓ done (subset) |
| `install.sh` / `install.ps1`         | `installer/`                 | not started |

## Why "chi"?

`che` minus an `e`. Three letters, pronounceable, distinct binary name from
the existing `che` so both can coexist on the same machine during the migration.
