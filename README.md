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
│   ├── index.ts         # dispatcher (workflow trigger lookup → built-ins)
│   ├── platform.ts      # OS detection (darwin/windows/wsl/linux)
│   ├── ui.ts            # ANSI colors + section/kv printers
│   ├── config.ts        # ~/.chi/config loader (env-var precedence)
│   ├── spawn.ts         # child_process helpers (sync/async, inherit-stdio)
│   ├── prompt.ts        # readline / yes-no helpers (TTY-aware)
│   ├── spinner.ts       # braille spinner (TTY-only, silent in CI)
│   ├── frontmatter.ts   # YAML frontmatter parser (status/progress badges)
│   ├── yaml.ts          # minimal YAML parser for workflow files
│   ├── git/
│   │   └── index.ts     # git wrappers + push-with-recovery + error log
│   ├── provider/
│   │   ├── types.ts     # Provider interface
│   │   ├── index.ts     # router + smart-generate (escalation to claude-code)
│   │   ├── claude-code.ts
│   │   ├── copilot.ts
│   │   └── ollama.ts
│   ├── workflow/
│   │   └── loader.ts    # workflow discovery + validation + step planning
│   └── commands/
│       ├── help.ts
│       ├── status.ts
│       ├── commit.ts
│       ├── ship.ts
│       ├── flow.ts
│       ├── done.ts
│       ├── issue.ts
│       ├── explain.ts
│       ├── init.ts
│       ├── reinstall.ts
│       ├── config.ts
│       ├── doctor.ts
│       └── workflow.ts  # list / show / run sub-dispatcher (also: chi run)
├── package.json
├── tsconfig.json
└── README.md
```

Each provider implements the same `Provider` interface (see
[src/provider/types.ts](src/provider/types.ts#L3)) so the dispatcher can route to
whichever is selected by `CHI_PROVIDER`.

## Porting status

Mapping from che-cli (shell) → chi (TS):

| che-cli                              | chi                                  | Status      |
|--------------------------------------|--------------------------------------|-------------|
| `lib/che/platform.sh`                | `src/platform.ts`                    | ✓ done      |
| `lib/che/config_load.sh`             | `src/config.ts`                      | ✓ done      |
| `lib/che/provider.sh`                | `src/provider/index.ts`              | ✓ done      |
| `lib/che/ollama/client.sh`           | `src/provider/ollama.ts`             | ✓ done      |
| `lib/che/claude-code/client.sh`      | `src/provider/claude-code.ts`        | ✓ done      |
| `lib/che/copilot/client.sh`          | `src/provider/copilot.ts`            | ✓ done      |
| `lib/che/status.sh`                  | `src/commands/status.ts`             | ✓ done      |
| `lib/che/git/commit.sh`              | `src/commands/commit.ts`             | ✓ done      |
| `lib/che/git/ship.sh`                | `src/commands/ship.ts`               | ✓ done      |
| `lib/che/git/flow.sh`                | `src/commands/flow.ts`               | ✓ done      |
| `lib/che/git/done.sh`                | `src/commands/done.ts`               | ✓ done      |
| `lib/che/git/push.sh`                | `src/git/index.ts` (`pushWithRecovery`) | ✓ done   |
| `lib/che/git/conflicts.sh`           | —                                    | not ported (see PROP) |
| `lib/che/git/warnings.sh`            | —                                    | not ported (see PROP) |
| `lib/che/issue.sh`                   | `src/commands/issue.ts`              | ✓ done      |
| (new — no che-cli equivalent)        | `chi issue fix` + `.che/workflows/issue-fix.yml` | ✓ done (PROP-008) |
| `lib/che/explain.sh`                 | `src/commands/explain.ts`            | ✓ done      |
| `lib/che/init.sh`                    | `src/commands/init.ts`               | ✓ done      |
| `lib/che/workflow.sh` + workflow/    | `src/commands/workflow.ts`, `src/workflow/loader.ts` | ✓ done |
| `lib/che/reinstall.sh`               | `src/commands/reinstall.ts`          | ✓ done      |
| `lib/che/config.sh`                  | `src/commands/config.ts`             | ✓ done      |
| `lib/che/doctor.sh`                  | `src/commands/doctor.ts`             | ✓ done      |
| `lib/che/frontmatter.sh`             | `src/frontmatter.ts`                 | ✓ done      |
| `lib/che/json.sh`                    | (replaced by native `JSON.*`)        | n/a         |
| `lib/che/ui.sh`                      | `src/ui.ts` + `src/spinner.ts`       | ✓ done      |
| `lib/che/workflow/yaml_get.py`       | `src/yaml.ts` (in-tree YAML parser)  | ✓ done      |
| `install.sh` / `install.ps1`         | `installer/`                         | not started (PROP-001) |
| `self_update.sh`                     | —                                    | not ported (PROP-002) |

Conflict resolution (`conflicts.sh`) and the LLM warning fixer (`warnings.sh`)
in `chi ship` are intentionally deferred — they wrap interactive `claude`
invocations and need careful UX work; tracked as proposals.

## Why "chi"?

`che` minus an `e`. Three letters, pronounceable, distinct binary name from
the existing `che` so both can coexist on the same machine during the migration.
