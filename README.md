# chi

Node.js / TypeScript port of [che-cli](https://github.com/chevp/che-cli) — a small developer CLI that wraps git workflows and AI provider calls. Hand-rolled command dispatch, no runtime dependencies.

The LLM backend is hardwired to the **cura** Cloud Run endpoint (a hosted Ollama). No claude-code, no copilot, no local ollama, no docker.

```sh
$ chi status

chi-cli
  platform           darwin
  provider           cura (model: smollm2:135m)
  reachable          yes

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

Installs the prebuilt `dist/` from the github tarball and places three binaries on PATH via npm's global bin: `chi`, `che`, and `jan`. All three resolve to the same launcher; each presents itself with its invoked name in help text and error prefixes (see [ADR-009](context/adr/ADR-009-unified-binary-aliases.md)).

If a previous standalone `che-cli` or `jan-cli` is installed, uninstall it first so npm can claim the `che` / `jan` names:

```sh
npm uninstall -g che-cli jan-cli
npm install -g github:chevp/chi
```

### From a local clone (development)

```sh
git clone https://github.com/chevp/chi.git
cd chi
./install.sh        # macOS / Linux / WSL
.\install.ps1       # Windows PowerShell
```

Flags: `--help` / `-AssumeYes` for unattended runs; `PREFIX=~/.local ./install.sh` to override the install location. For iterative hacking without rebuilding: `npm run dev -- <cmd>`.

## First-time setup

Run **once** after install to enter your cura credentials and verify the endpoint:

```sh
chi init
```

`chi init` prompts for `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` (password input is masked), saves them to `~/.chi/config` (chmod 600), pings the cura endpoint, and confirms the model is available. Re-run with `--force` to update saved credentials.

If you'd rather not be prompted, set both env vars before running `chi init` and the saved file will mirror what's in your environment:

```sh
export BASIC_AUTH_USER=<user>
export BASIC_AUTH_PASSWORD=<password>
chi init
```

## Update

Once installed, chi can update itself — works for both global and from-source installs:

```sh
chi update
```

It detects the install layout and either runs `npm install -g github:chevp/chi` (global) or `git pull --ff-only && npm install` (workspace clone — the pulled commit is expected to ship a fresh `dist/`).

## Usage

All commands use the cura endpoint for LLM calls. Credentials are read from env vars first, then `~/.chi/config`.

### Daily git workflow

```sh
chi status            # repo state + provider reachability
chi commit            # stage all + AI-generated commit message
chi commit --push     # also push
chi flow my-feature   # cut a flow branch from base
chi ship              # add + commit + push (recursive into submodules)
chi done              # squash-merge the active flow PR + return to base
```

### Issue management

```sh
chi issue                           # interactive: AI drafts a new issue
chi issue "title and rough body"    # AI fleshes out title/body, opens it
chi issue list --limit 20
chi issue close 42 --reason "fixed in #45"
```

`chi issue fix <n>` is **not available** — it required an interactive Claude CLI session that no longer exists in cura-only mode.

### Diagnostics

```sh
chi explain                                # diagnose the last failed chi ship/commit
chi explain "why is git push hanging?"     # ad-hoc question, current git state included
chi doctor                                 # all checks (git, cura, workflow)
chi doctor cura                            # only the cura endpoint check
```

### Config

```sh
chi config                                # list saved settings
chi config llm_model smollm2:135m         # change a key
chi config basic_auth_user my-user        # update saved credentials
chi config --unset basic_auth_password    # forget a key
chi config edit                           # open ~/.chi/config in $EDITOR
chi config path                           # print the config file path
```

### Workflows and worktrees

```sh
chi workflow list                       # list .che/workflows/*.yml
chi run <name>                          # alias for `chi workflow run <name>`
chi work <branch-name>                  # parallel git worktree (branch chi/<name>)
chi work list | rm <name> | cd <name>
```

## Configuration

Persistent settings live in `~/.chi/config` (managed by `chi init` and `chi config`). Env vars always win over the file. The file is written with mode 600 on first save by `chi init`.

| Key (`~/.chi/config`)  | Env var               | Default                                              |
|------------------------|-----------------------|------------------------------------------------------|
| `basic_auth_user`      | `BASIC_AUTH_USER`     | **required**                                         |
| `basic_auth_password`  | `BASIC_AUTH_PASSWORD` | **required**                                         |
| `llm_url`              | `CHI_LLM_URL`         | `https://cura-llm-3j2fyuwcdq-oa.a.run.app`           |
| `llm_model`            | `CHI_LLM_MODEL`       | `smollm2:135m`                                       |
| `max_diff_chars`       | `CHI_MAX_DIFF_CHARS`  | `8000`                                               |
| —                      | `CHI_CONFIG_FILE`     | `~/.chi/config`                                      |
| —                      | `CHI_INVOKED_AS`      | basename of `argv[1]` (e.g. `chi`, `jan`, `che`)     |

`CHI_INVOKED_AS` lets a wrapper present chi under a different name — help text, status header, and error prefixes all switch to that name. Auto-detected from `argv[1]`, so the [chevp/jan-cli](https://github.com/chevp/jan-cli) wrapper picks up `jan` automatically without setting it.

## Architecture

Hand-rolled dispatcher in [src/index.ts](src/index.ts) routes argv to per-command files in [src/commands/](src/commands/). The single [cura provider](src/provider/cura.ts) implements the [Provider](src/provider/types.ts) interface and sends `Authorization: Basic <base64>` on every call. See [CLAUDE.md](CLAUDE.md) for conventions and ADR pointers.

## Why "chi"?

`che` minus an `e`. Three letters, pronounceable, distinct binary so `che` and `chi` coexist on the same machine during migration. There's also a `jan` wrapper at [chevp/jan-cli](https://github.com/chevp/jan-cli) that exposes the same chi binary under a different name.
