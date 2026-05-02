import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c } from "../ui.js";
import {
  activeProviderName,
  getProvider,
  providerEnsureRunning,
  providerSmartGenerate,
} from "../provider/index.js";
import { commandExists, execSync, execInherit } from "../spawn.js";
import { git, isInsideRepo, gitDir } from "../git/index.js";
import { parseFrontmatter, statusBadge } from "../frontmatter.js";
import { withSpinner } from "../spinner.js";
import { readLine } from "../prompt.js";
import * as workflowCmd from "./workflow.js";

const HELP = `chi issue — manage GitHub issues via gh, with AI-generated content.

Usage:
  chi issue [create] [description]    open a new issue (LLM drafts title/body)
  chi issue list [--limit N]          list open issues for the current repo
  chi issue close <n> [--reason R]    close issue #n
  chi issue fix <n> [hint]            cut fix branch + start framework-driven Claude session
  chi issue -h | --help               show this help
`;

function requireGh(): string | null {
  if (!commandExists("gh")) {
    return "chi issue: missing dependency: gh — run 'chi doctor git'";
  }
  if (!execSync("gh", ["auth", "status"]).ok) {
    return "chi issue: gh not authenticated — run 'gh auth login'";
  }
  return null;
}

async function cmdList(argv: string[]): Promise<number> {
  let limit = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--limit") {
      const v = argv[++i];
      if (!v) {
        process.stderr.write("chi issue list: --limit needs a value\n");
        return 1;
      }
      limit = Number.parseInt(v, 10) || 10;
    } else if (a === "-h" || a === "--help") {
      process.stdout.write("Usage: chi issue list [--limit N]\n");
      return 0;
    } else {
      process.stderr.write(`chi issue list: unknown option '${a}'\n`);
      return 1;
    }
  }
  const guard = requireGh();
  if (guard) {
    process.stderr.write(`${guard}\n`);
    return 1;
  }
  const r = execSync("gh", [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,labels,assignees,body",
    "--jq",
    '.[] | "\\(.number)\\t\\(.title)\\t\\([.labels[].name]|join(","))\\t\\([.assignees[].login]|join(","))\\t\\(.body|@base64)"',
  ]);
  if (!r.ok) {
    process.stderr.write("chi issue list: 'gh issue list' failed — is this a GitHub repo?\n");
    return 1;
  }
  const rows = r.stdout.trim();
  if (!rows) {
    process.stdout.write(`  ${c.dim("(no open issues)")}\n`);
    return 0;
  }
  for (const ln of rows.split(/\r?\n/)) {
    const [num, title, labels, assignees, bodyB64] = ln.split("\t");
    let body = "";
    if (bodyB64) {
      try {
        body = Buffer.from(bodyB64, "base64").toString("utf8");
      } catch {
        body = "";
      }
    }
    const fm = body ? parseFrontmatter(body) : { name: "", status: "", progress: "" };
    const meta: string[] = [];
    if (fm.progress) meta.push(c.dim(`(${fm.progress})`));
    if (labels) meta.push(c.dim(`[${labels}]`));
    if (assignees) meta.push(c.dim(`@${assignees}`));
    process.stdout.write(
      `  ${c.cyan(`#${num}`)} ${statusBadge(fm.status).padEnd(11)} ${title}${meta.length ? ` ${meta.join(" ")}` : ""}\n`,
    );
  }
  return 0;
}

async function cmdClose(argv: string[]): Promise<number> {
  let num = "";
  let reason = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--reason") {
      reason = argv[++i] ?? "";
    } else if (a === "-h" || a === "--help") {
      process.stdout.write("Usage: chi issue close <n> [--reason R]\n");
      return 0;
    } else if (a.startsWith("-")) {
      process.stderr.write(`chi issue close: unknown option '${a}'\n`);
      return 1;
    } else {
      num = a;
    }
  }
  if (!num) {
    process.stderr.write("chi issue close: issue number required\n");
    return 1;
  }
  const guard = requireGh();
  if (guard) {
    process.stderr.write(`${guard}\n`);
    return 1;
  }
  const args = reason ? ["issue", "close", num, "--comment", reason] : ["issue", "close", num];
  const r = execSync("gh", args);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return r.ok ? 0 : r.status ?? 1;
}

function buildHints(): string {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout.trim();
  let diff = git(["diff", "--no-color", "HEAD"]).stdout;
  const max = Number.parseInt(process.env.CHI_MAX_DIFF_CHARS ?? "4000", 10) || 4000;
  if (diff.length > max) {
    diff = `${diff.slice(0, max)}\n\n[diff truncated at ${max} chars]`;
  }
  let out = `Branch: ${branch}\n`;
  if (diff) {
    out += `\nLocal changes (uncommitted, may or may not be related):\n${diff}\n`;
  } else {
    out += "\n(no uncommitted local changes)\n";
  }
  return out;
}

interface CreateOpts {
  description: string;
  yes: boolean;
  dry: boolean;
  edit: boolean;
  labels: string;
}

function parseCreate(argv: string[]): CreateOpts | { help: true } | { error: string } {
  const o: CreateOpts = { description: "", yes: false, dry: false, edit: false, labels: "" };
  const desc: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    switch (a) {
      case "-y":
      case "--yes":
        o.yes = true;
        break;
      case "-n":
      case "--dry-run":
        o.dry = true;
        break;
      case "-e":
      case "--edit":
        o.edit = true;
        break;
      case "-l":
      case "--label":
        o.labels = argv[++i] ?? "";
        break;
      case "-h":
      case "--help":
        return { help: true };
      case "--":
        desc.push(...argv.slice(i + 1));
        i = argv.length;
        break;
      default:
        if (a.startsWith("-")) return { error: `chi issue create: unknown option '${a}'` };
        desc.push(a);
        break;
    }
  }
  o.description = desc.join(" ");
  return o;
}

async function cmdCreate(argv: string[]): Promise<number> {
  const parsed = parseCreate(argv);
  if ("help" in parsed) {
    process.stdout.write(
      `Usage: chi issue create [options] [description]

Options:
  -y, --yes        skip confirmation
  -n, --dry-run    print the drafted issue, do not open it
  -e, --edit       open editor before submitting
  -l, --label L    comma-separated labels to apply
`,
    );
    return 0;
  }
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 1;
  }
  const opts = parsed;

  const guard = requireGh();
  if (guard) {
    process.stderr.write(`${guard}\n`);
    return 1;
  }
  if (!isInsideRepo()) {
    process.stderr.write("chi issue create: not a git repository\n");
    return 1;
  }

  const hints = buildHints();
  const seed = opts.description
    ? `User-provided description (this is the primary intent — use it):
${opts.description}

Repository hints (for additional context only):
${hints}`
    : `No user description was provided. Infer the issue from the repository hints below.

${hints}`;

  const prompt = `You are drafting a GitHub issue.

Format (exact):
<title>
<blank line>
---
status: <one of: open | in-progress | blocked>
progress: <free-form, e.g. "0%" or "0/3 steps">
---

<body in GitHub-flavored markdown>

Rules:
- Reply with ONLY the issue text. No quotes, no preamble, no explanation.
- Title: one line, 4–72 characters, imperative or descriptive.
- The frontmatter block is REQUIRED, immediately after the blank line.
- Body: concise GitHub-flavored markdown. 4-15 lines is typical.

Input:
${seed}`;

  await providerEnsureRunning().catch(() => false);

  let raw = "";
  try {
    raw = await withSpinner(
      `drafting issue via ${activeProviderName()} (${getProvider().activeModel()})`,
      () => providerSmartGenerate(prompt),
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(
      "chi issue: LLM draft failed — run 'chi doctor provider' for diagnostics\n",
    );
    return 1;
  }

  // Trim leading + trailing blank lines.
  const lines = raw.split(/\r?\n/);
  while (lines.length && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();

  if (lines.length === 0) {
    process.stderr.write("chi issue: LLM returned an empty title — aborting\n");
    return 1;
  }

  let title = (lines.shift() ?? "")
    .replace(/^\s+/, "")
    .replace(/^["']|["']$/g, "");
  // skip a leading blank between title and body
  if (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  let body = lines.join("\n");

  if (!title) {
    process.stderr.write("chi issue: LLM returned an empty title — aborting\n");
    return 1;
  }

  process.stdout.write(`\n${c.bold("Title:")} ${title}\n`);
  if (body.trim()) {
    process.stdout.write(`\n${c.bold("Body:")}\n`);
    for (const ln of body.split(/\r?\n/)) {
      process.stdout.write(`  ${ln}\n`);
    }
  }
  process.stdout.write("\n");

  if (opts.dry) return 0;

  let edit = opts.edit;
  if (!opts.yes && !edit) {
    const ans = await readLine("open this issue? [Y/n/e=edit] ");
    const v = (ans ?? "").trim().toLowerCase();
    if (v === "n" || v === "no") {
      process.stdout.write("aborted\n");
      return 1;
    }
    if (v === "e") edit = true;
  }

  if (edit) {
    const tmp = mkdtempSync(join(tmpdir(), "chi-issue-"));
    const file = join(tmp, "ISSUE.md");
    try {
      writeFileSync(file, `${title}\n\n${body}\n`);
      const editor = process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
      await execInherit(editor, [file]);
      const updated = readFileSync(file, "utf8").split(/\r?\n/);
      title = updated[0] ?? title;
      // skip blank line right after title
      if (updated[1] !== undefined && updated[1].trim() === "") updated.splice(1, 1);
      body = updated.slice(1).join("\n");
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  const args = ["issue", "create", "--title", title, "--body", body || "_(no body)_"];
  if (opts.labels) {
    args.push("--label", opts.labels);
  }
  const r = execSync("gh", args);
  if (!r.ok) {
    process.stderr.write(r.stderr);
    process.stderr.write("chi issue: gh issue create failed\n");
    return r.status ?? 1;
  }
  process.stdout.write(`${c.green("→ opened:")} ${r.stdout.trim()}\n`);
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === "-h" || sub === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  switch (sub) {
    case "create":
      return cmdCreate(argv.slice(1));
    case "list":
      return cmdList(argv.slice(1));
    case "close":
      return cmdClose(argv.slice(1));
    default:
      // Treat the first arg as the description for create.
      return cmdCreate(argv);
  }
}
