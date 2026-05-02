import { c } from "../ui.js";
import { CHI_OS } from "../platform.js";
import {
  activeProviderName,
  getProvider,
} from "../provider/index.js";
import { commandExists, execAsync, execSync } from "../spawn.js";
import { ollamaProvider, startOllamaServer } from "../provider/ollama.js";

const HELP = `chi doctor — verify dependencies and external services.

Usage: chi doctor [target]

Targets:
  all          run all checks (default)
  git          git installation
  docker       docker installation and daemon
  ollama       ollama binary, server reachability, configured model
  claude-code  Claude Code CLI ('claude' binary) — used as escalation target
  copilot      GitHub Copilot CLI ('copilot' binary)
  workflow     prerequisites for chi workflow / chi run (none — built-in)
  provider     only the currently selected provider (CHI_PROVIDER, default: claude-code)
`;

function ok(msg: string): void {
  process.stdout.write(`  ${msg}\n`);
}
function fail(msg: string): void {
  process.stdout.write(`  ${c.red("error:")} ${msg}\n`);
}
function info(msg: string): void {
  process.stdout.write(`  ${c.dim("hint:")} ${msg}\n`);
}

function gitInstallHint(): void {
  switch (CHI_OS) {
    case "darwin":
      info("install: brew install git");
      break;
    case "windows":
      info("install: https://git-scm.com/download/win");
      break;
    case "wsl":
    case "linux":
      info("install: sudo apt-get install git  (or your distro equivalent)");
      break;
    default:
      info("install: https://git-scm.com/downloads");
  }
}

function ghInstallHint(): void {
  switch (CHI_OS) {
    case "darwin":
      info("install: brew install gh");
      break;
    case "windows":
      info("install: winget install --id GitHub.cli");
      break;
    case "wsl":
    case "linux":
      info("install: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md");
      break;
    default:
      info("install: https://cli.github.com/");
  }
  info("docs:    https://cli.github.com/manual/");
}

function gitCheck(): boolean {
  let okAll = true;
  if (commandExists("git")) {
    const ver = execSync("git", ["--version"]).stdout.trim().split(/\s+/)[2] ?? "?";
    ok(`git ${ver}`);
  } else {
    fail("git not installed");
    gitInstallHint();
    okAll = false;
  }
  if (commandExists("gh")) {
    const ver =
      execSync("gh", ["--version"]).stdout.split(/\r?\n/)[0]?.split(/\s+/)[2] ?? "?";
    ok(`gh ${ver}  (required for chi flow / chi done)`);
    if (execSync("gh", ["auth", "status"]).ok) {
      ok("gh authenticated");
    } else {
      fail("gh not authenticated");
      info("run: gh auth login");
      okAll = false;
    }
  } else {
    fail("gh not installed  (required for chi flow / chi done)");
    ghInstallHint();
    okAll = false;
  }
  return okAll;
}

function dockerInstallHint(): void {
  switch (CHI_OS) {
    case "darwin":
      info("install: brew install --cask docker");
      break;
    case "windows":
      info(
        "install: winget install Docker.DockerDesktop  (or https://www.docker.com/products/docker-desktop/)",
      );
      break;
    case "wsl":
    case "linux":
      info("install: https://docs.docker.com/engine/install/");
      break;
    default:
      info("install: https://www.docker.com/get-started/");
  }
  info("docs:    https://docs.docker.com/get-started/");
}

function dockerStartHint(): void {
  switch (CHI_OS) {
    case "darwin":
      info("start it: open -a Docker");
      break;
    case "windows":
      info("start Docker Desktop from the Start menu");
      break;
    case "wsl":
      info("ensure Docker Desktop's WSL integration is enabled");
      break;
    case "linux":
      info("start it: sudo systemctl start docker");
      break;
    default:
      break;
  }
}

async function dockerCheck(): Promise<boolean> {
  if (!commandExists("docker")) {
    fail("docker not installed");
    dockerInstallHint();
    return false;
  }
  const ver = execSync("docker", ["--version"]).stdout.trim().split(/\s+/)[2]?.replace(/,$/, "") ?? "?";
  ok(`docker installed (${ver})`);
  // `docker info` blocks indefinitely when the daemon socket is reachable but
  // unresponsive (Docker Desktop launching, stuck VM). spawnSync's timeout
  // sends SIGTERM which docker can ignore, so use execAsync — its timeout
  // escalates to SIGKILL.
  const probe = await execAsync("docker", ["info"], { timeoutMs: 5000 });
  if (probe.ok) {
    ok("docker daemon is running");
    return true;
  }
  if (probe.status === null) {
    fail("docker daemon not responding (timed out after 5s)");
  } else {
    fail("docker daemon not running");
  }
  dockerStartHint();
  return false;
}

function ollamaInstallHint(): void {
  switch (CHI_OS) {
    case "darwin":
      info("install: brew install ollama");
      break;
    case "windows":
      info("install: https://ollama.com/download/windows");
      break;
    case "wsl":
    case "linux":
      info("install: curl -fsSL https://ollama.com/install.sh | sh");
      break;
    default:
      info("install: https://ollama.com/download");
  }
  info("guide:   https://chevp.github.io/cura-llm-local/  (5-min local setup)");
}

async function ollamaCheck(): Promise<boolean> {
  let okAll = true;
  if (commandExists("ollama")) {
    ok("ollama binary found");
  } else {
    fail("ollama binary not found");
    ollamaInstallHint();
    okAll = false;
  }
  const host = process.env.CHI_OLLAMA_HOST ?? "http://localhost:11434";
  if (await ollamaProvider.ping()) {
    ok(`server responding at ${host}`);
  } else {
    info(`no response at ${host} — starting 'ollama serve' in the background…`);
    if (await startOllamaServer(10)) {
      ok(`server started at ${host}`);
    } else {
      fail(`could not reach ${host} after starting 'ollama serve'`);
      info("start it manually in another terminal: ollama serve");
      return false;
    }
  }
  const model = process.env.CHI_OLLAMA_MODEL ?? "llama3.2";
  if (await ollamaProvider.hasModel(model)) {
    ok(`model available: ${model}`);
  } else {
    fail(`model not pulled: ${model}`);
    info(`pull it: chi init  (or: ollama pull ${model})`);
    okAll = false;
  }
  return okAll;
}

function claudeCodeCheck(): boolean {
  if (!commandExists("claude")) {
    fail("claude CLI not on PATH");
    info("install: https://docs.claude.com/claude-code");
    return false;
  }
  const ver = execSync("claude", ["--version"]).stdout.split(/\r?\n/)[0] ?? "";
  ok(`claude CLI found${ver ? ` (${ver})` : ""}`);
  return true;
}

function copilotCheck(): boolean {
  if (!commandExists("copilot")) {
    fail("copilot CLI not on PATH");
    info(
      "install: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli",
    );
    return false;
  }
  const ver = execSync("copilot", ["--version"]).stdout.split(/\r?\n/)[0] ?? "";
  ok(`copilot CLI found${ver ? ` (${ver})` : ""}`);
  return true;
}

function workflowCheck(): boolean {
  // chi has a built-in YAML parser, no Python/PyYAML needed (unlike che).
  ok("workflow loader (built-in YAML parser, no extra deps)");
  return true;
}

async function activeProviderCheck(): Promise<boolean> {
  const p = activeProviderName();
  process.stdout.write(`active provider: ${p} (model: ${getProvider(p).activeModel()})\n`);
  switch (p) {
    case "ollama":
      return ollamaCheck();
    case "claude-code":
      return claudeCodeCheck();
    case "copilot":
      return copilotCheck();
  }
}

async function runSection(name: string, fn: () => boolean | Promise<boolean>): Promise<void> {
  process.stdout.write(`${name}:\n`);
  try {
    await fn();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function run(argv: string[]): Promise<number> {
  const target = argv[0] ?? "all";
  switch (target) {
    case "git":
      await runSection("git", gitCheck);
      return 0;
    case "docker":
      await runSection("docker", dockerCheck);
      return 0;
    case "ollama":
      await runSection("ollama", ollamaCheck);
      return 0;
    case "claude-code":
      await runSection("claude-code", claudeCodeCheck);
      return 0;
    case "copilot":
      await runSection("copilot", copilotCheck);
      return 0;
    case "workflow":
      await runSection("workflow", workflowCheck);
      return 0;
    case "provider":
      await runSection("provider", activeProviderCheck);
      return 0;
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    case "all":
    case "":
    case undefined: {
      process.stdout.write(`platform: ${CHI_OS}\n`);
      process.stdout.write(
        `active provider: ${activeProviderName()} (model: ${getProvider().activeModel()})\n\n`,
      );
      await runSection("git", gitCheck);
      await runSection("docker", dockerCheck);
      await runSection("ollama", ollamaCheck);
      await runSection("claude-code", claudeCodeCheck);
      await runSection("copilot", copilotCheck);
      await runSection("workflow", workflowCheck);
      process.stdout.write("shell deps:\n");
      for (const bin of ["curl", "bash"]) {
        if (commandExists(bin)) ok(bin);
        else fail(`${bin} missing`);
      }
      return 0;
    }
    default:
      process.stderr.write(`chi doctor: unknown target '${target}'\n`);
      process.stderr.write(
        "valid: all, git, docker, ollama, claude-code, copilot, workflow, provider\n",
      );
      return 1;
  }
}
