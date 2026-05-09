import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { c } from "../ui.js";
import { CHI_CONFIG_FILE } from "../config.js";
import { curaProvider } from "../provider/cura.js";
import { BIN_NAME } from "../identity.js";
import { readLine, readSecret } from "../prompt.js";

const HELP = `${BIN_NAME} init — set up cura credentials and verify the endpoint.

Usage: ${BIN_NAME} init [options]

What it does:
  1. prompts for BASIC_AUTH_USER / BASIC_AUTH_PASSWORD if not already set
  2. saves them to ~/.chi/config (chmod 600)
  3. pings the cura endpoint
  4. confirms the configured model is available

Options:
  --force        re-prompt even if credentials are already set
  -h, --help     show this help

Environment (optional):
  CHI_LLM_URL    override the default cura URL
  CHI_LLM_MODEL  override the default model (default: smollm2:135m)
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

interface Pair {
  key: string;
  value: string;
}

function readConfigPairs(): Pair[] {
  if (!existsSync(CHI_CONFIG_FILE)) return [];
  const raw = readFileSync(CHI_CONFIG_FILE, "utf8");
  const out: Pair[] = [];
  for (const ln of raw.split(/\r?\n/)) {
    const trimmed = ln.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out.push({
      key: trimmed.slice(0, eq).trim(),
      value: trimmed.slice(eq + 1).replace(/^\s+/, ""),
    });
  }
  return out;
}

function writeConfigPairs(pairs: Pair[]): void {
  mkdirSync(dirname(CHI_CONFIG_FILE), { recursive: true });
  const body = pairs.map((p) => `${p.key}=${p.value}`).join("\n");
  writeFileSync(CHI_CONFIG_FILE, `${body}${body ? "\n" : ""}`, { mode: 0o600 });
}

function upsertPairs(updates: Record<string, string>): void {
  const keep = readConfigPairs().filter((p) => !(p.key in updates));
  const merged = [
    ...keep,
    ...Object.entries(updates).map(([key, value]) => ({ key, value })),
  ];
  writeConfigPairs(merged);
}

async function promptCredentials(force: boolean): Promise<{ user: string; password: string } | null> {
  const persisted = Object.fromEntries(readConfigPairs().map((p) => [p.key, p.value]));

  const existingUser =
    process.env.BASIC_AUTH_USER ||
    persisted.basic_auth_user ||
    "";
  const existingPassword =
    process.env.BASIC_AUTH_PASSWORD ||
    persisted.basic_auth_password ||
    "";

  if (!force && existingUser && existingPassword) {
    info("credentials already set — pass --force to re-prompt");
    return { user: existingUser, password: existingPassword };
  }

  if (!process.stdin.isTTY) {
    fail("not a TTY — cannot prompt for credentials");
    info("set BASIC_AUTH_USER / BASIC_AUTH_PASSWORD in env, or run interactively");
    return null;
  }

  process.stdout.write("\n");
  const userPrompt = existingUser ? `BASIC_AUTH_USER [${existingUser}]: ` : "BASIC_AUTH_USER: ";
  const userIn = await readLine(userPrompt);
  const user = (userIn ?? "").trim() || existingUser;
  if (!user) {
    fail("BASIC_AUTH_USER is required");
    return null;
  }

  const passwordIn = await readSecret("BASIC_AUTH_PASSWORD: ");
  const password = passwordIn ?? "";
  if (!password) {
    if (existingPassword) {
      info("(empty input — keeping existing password)");
      return { user, password: existingPassword };
    }
    fail("BASIC_AUTH_PASSWORD is required");
    return null;
  }

  return { user, password };
}

export async function run(argv: string[]): Promise<number> {
  let force = false;
  for (const a of argv) {
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    process.stderr.write(`chi init: unknown option '${a}'\n`);
    return 1;
  }

  const url = process.env.CHI_LLM_URL ?? "https://cura-llm-3j2fyuwcdq-oa.a.run.app";
  const model = curaProvider.activeModel();

  process.stdout.write(`chi init — cura (model: ${model})\n`);

  const creds = await promptCredentials(force);
  if (!creds) return 1;

  upsertPairs({
    basic_auth_user: creds.user,
    basic_auth_password: creds.password,
  });
  process.env.BASIC_AUTH_USER = creds.user;
  process.env.BASIC_AUTH_PASSWORD = creds.password;
  ok(`saved credentials to ${CHI_CONFIG_FILE}`);

  if (await curaProvider.ping()) {
    ok(`endpoint reachable at ${url}`);
  } else {
    fail(`endpoint not reachable at ${url}`);
    info(`check network and credentials, then re-run '${BIN_NAME} init --force'`);
    return 1;
  }

  if (await curaProvider.hasModel(model)) {
    ok(`model available: ${model}`);
  } else {
    fail(`model not available: ${model}`);
    info(`set CHI_LLM_MODEL to one offered by ${url}/api/tags`);
    return 1;
  }

  process.stdout.write("\nready. try: chi commit\n");
  return 0;
}
