# chi

Node.js / TypeScript port of [che-cli](https://github.com/chevp/che-cli) — a small developer CLI that wraps git workflows and AI provider calls (Claude Code, Copilot, Ollama). Hand-rolled command dispatch, no runtime dependencies.

```sh
$ chi status

chi-cli
  platform           darwin
  provider           claude-code
git
  repo               chi
  branch             main
  state              clean
```

## Install

Requires Node 20+.

```sh
npm install -g github:chevp/chi
```

Installs the prebuilt `dist/` from the github tarball and places `chi` on PATH via npm's global bin.

### From a local clone (development)

The bundled installer symlinks your workspace into `~/.local/bin`, so rebuilds propagate without reinstalling:

```sh
git clone https://github.com/chevp/chi.git
cd chi
./install.sh        # macOS / Linux / WSL
.\install.ps1       # Windows PowerShell
```

Flags: `--help` / `-AssumeYes` for unattended runs; `PREFIX=~/.local ./install.sh` to override the install location.

For iterative hacking without rebuilding: `npm run dev -- <cmd>`.

## Update

Once installed, chi can update itself — works for both global and from-source installs:

```sh
chi update
```

It detects the install layout and either runs `npm install -g github:chevp/chi` (global) or `git pull --ff-only && npm install` (workspace clone — the pulled commit is expected to ship a fresh `dist/`).

## Configuration

Persistent defaults live in `~/.chi/config`; environment variables override.

| Variable                | Default                  |
|-------------------------|--------------------------|
| `CHI_PROVIDER`          | `claude-code`            |
| `CHI_OLLAMA_HOST`       | `http://localhost:11434` |
| `CHI_OLLAMA_MODEL`      | `llama3.2`               |
| `CHI_MAX_DIFF_CHARS`    | `8000`                   |
| `CHI_FORCE_CLAUDE_CODE` | unset                    |
| `CHI_CONFIG_FILE`       | `~/.chi/config`          |

## Architecture

Hand-rolled dispatcher in [src/index.ts](src/index.ts) routes argv to per-command files in [src/commands/](src/commands/). Each AI backend implements the same [Provider](src/provider/types.ts) interface and is selected by `CHI_PROVIDER`. See [CLAUDE.md](CLAUDE.md) for conventions and ADR pointers.

## Why "chi"?

`che` minus an `e`. Three letters, pronounceable, distinct binary so `che` and `chi` coexist on the same machine during migration.
