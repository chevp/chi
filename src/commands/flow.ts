import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandExists, execSync } from "../spawn.js";
import { git, gitDir, isInsideRepo } from "../git/index.js";

const HELP = `chi flow — start a flow branch (pull base, checkout new, mark for chi ship/done).

Usage: chi flow <branch> [--base <branch>]

Options:
  --base <branch>   base branch (default: main)
  -h, --help        show this help

Workflow:
  chi flow feat/foo     # pull main, checkout feat/foo, write marker
  ...edit...
  chi ship              # commit + push -u (creates draft PR on first call)
  ...edit...
  chi ship              # commit + push (PR auto-updates)
  chi done              # gh pr merge --squash --auto --delete-branch + back to base
`;

export async function run(argv: string[]): Promise<number> {
  let base = "main";
  let branch = "";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (a === "--base") {
      const v = argv[++i];
      if (!v) {
        process.stderr.write("chi flow: --base needs a value\n");
        return 1;
      }
      base = v;
      continue;
    }
    if (a.startsWith("-")) {
      process.stderr.write(`chi flow: unknown option '${a}'\n`);
      return 1;
    }
    if (branch) {
      process.stderr.write("chi flow: only one branch arg accepted\n");
      return 1;
    }
    branch = a;
  }

  if (!branch) {
    process.stderr.write("chi flow: missing <branch>\n");
    process.stderr.write(HELP);
    return 1;
  }

  for (const bin of ["git", "gh"]) {
    if (!commandExists(bin)) {
      process.stderr.write(`chi flow: missing dependency: ${bin} (run 'chi doctor git')\n`);
      return 1;
    }
  }

  if (!isInsideRepo()) {
    process.stderr.write("chi flow: not a git repository\n");
    return 1;
  }

  const ghAuth = execSync("gh", ["auth", "status"]);
  if (!ghAuth.ok) {
    process.stderr.write("chi flow: gh not authenticated — run: gh auth login\n");
    return 1;
  }

  const dir = gitDir();
  if (!dir) {
    process.stderr.write("chi flow: cannot resolve git dir\n");
    return 1;
  }
  const marker = join(dir, "chi-flow");

  if (existsSync(marker)) {
    const cur = readMarker(marker).branch;
    process.stderr.write(
      `chi flow: active flow on '${cur}' — run 'chi done' first or rm ${marker}\n`,
    );
    return 1;
  }

  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    process.stderr.write(`chi flow: local branch '${branch}' already exists\n`);
    return 1;
  }

  const fetch = git(["fetch", "origin", "--prune"]);
  process.stderr.write(fetch.stderr);
  if (!fetch.ok) return fetch.status ?? 1;

  if (!git(["show-ref", "--verify", "--quiet", `refs/heads/${base}`]).ok) {
    process.stderr.write(`chi flow: base branch '${base}' does not exist locally\n`);
    return 1;
  }

  const co1 = git(["checkout", base]);
  process.stderr.write(co1.stderr);
  if (!co1.ok) return co1.status ?? 1;

  const pull = git(["pull", "--ff-only"]);
  process.stdout.write(pull.stdout);
  process.stderr.write(pull.stderr);
  if (!pull.ok) return pull.status ?? 1;

  const co2 = git(["checkout", "-b", branch]);
  process.stderr.write(co2.stderr);
  if (!co2.ok) return co2.status ?? 1;

  writeFileSync(marker, `branch=${branch}\nbase=${base}\n`);

  process.stdout.write(`\n── flow started: ${branch} (base: ${base}) ──\n`);
  process.stdout.write('next: edit, then "chi ship" to commit + push (draft PR on first call)\n');
  return 0;
}

interface FlowMarker {
  branch: string;
  base: string;
  pr: string;
  issue: string;
}

export function readMarker(path: string): FlowMarker {
  const out: FlowMarker = { branch: "", base: "", pr: "", issue: "" };
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k === "branch") out.branch = v;
      else if (k === "base") out.base = v;
      else if (k === "pr") out.pr = v;
      else if (k === "issue") out.issue = v;
    }
  } catch {
    /* ignore */
  }
  return out;
}
