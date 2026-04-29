import { c } from "../ui.js";
import { CHI_OS } from "../platform.js";
import { commandExists, execSync } from "../spawn.js";
import { ollamaProvider, startOllamaServer } from "../provider/ollama.js";

const HELP = `chi init — provision the local ollama setup.

Usage: chi init [options]

What it does:
  1. checks the ollama binary is installed
  2. starts 'ollama serve' in the background if not already running
  3. pulls $CHI_OLLAMA_MODEL if not already present

Options:
  -h, --help    show this help

Environment:
  CHI_OLLAMA_HOST   ollama server (default: http://localhost:11434)
  CHI_OLLAMA_MODEL  model to pull (default: llama3.2)
`;

function ok(msg: string): void {
  process.stdout.write(`  ${c.green("✓")} ${msg}\n`);
}
function fail(msg: string): void {
  process.stdout.write(`  ${c.red("✗")} ${msg}\n`);
}
function info(msg: string): void {
  process.stdout.write(`    ${c.dim(msg)}\n`);
}

function installHint(): void {
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
}

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const model = process.env.CHI_OLLAMA_MODEL ?? "llama3.2";
  const host = process.env.CHI_OLLAMA_HOST ?? "http://localhost:11434";

  process.stdout.write(`chi init — ollama (model: ${model})\n\n`);

  if (!commandExists("ollama")) {
    fail("ollama binary not found");
    installHint();
    info("re-run 'chi init' once installed");
    return 1;
  }
  ok("ollama binary found");

  if (await ollamaProvider.ping()) {
    ok(`server reachable at ${host}`);
  } else {
    info("starting 'ollama serve' in the background…");
    if (await startOllamaServer(10)) {
      ok(`server started at ${host}`);
    } else {
      fail(`could not reach ${host} after starting 'ollama serve'`);
      info("start it manually in another terminal: ollama serve");
      return 1;
    }
  }

  if (await ollamaProvider.hasModel(model)) {
    ok(`model already pulled: ${model}`);
  } else {
    info(`pulling ${model} (this may take a while)…`);
    const pull = execSync("ollama", ["pull", model]);
    process.stdout.write(pull.stdout);
    process.stderr.write(pull.stderr);
    if (!pull.ok) {
      fail(`ollama pull ${model} failed`);
      return 1;
    }
    ok(`model pulled: ${model}`);
  }

  process.stdout.write("\nready. try: chi doctor ollama\n");
  return 0;
}
