import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commandExists, execSync } from "../spawn.js";
import { git, gitDir, isInsideRepo } from "../git/index.js";
import { readMarker } from "./flow.js";

const HELP = `chi done — finish the active chi flow.

Reads .git/chi-flow, then runs:
  gh pr merge <pr> --squash --auto --delete-branch
  git checkout <base> && git pull --ff-only && git remote prune origin

Aborts if there's no active flow, or no PR yet (run 'chi ship' first).
`;

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  for (const bin of ["git", "gh"]) {
    if (!commandExists(bin)) {
      process.stderr.write(`chi done: missing dependency: ${bin} (run 'chi doctor git')\n`);
      return 1;
    }
  }
  if (!isInsideRepo()) {
    process.stderr.write("chi done: not a git repository\n");
    return 1;
  }

  const dir = gitDir();
  if (!dir) return 1;
  const marker = join(dir, "chi-flow");
  if (!existsSync(marker)) {
    process.stderr.write(
      `chi done: no active flow (${marker} missing) — run 'chi flow <branch>' first\n`,
    );
    return 1;
  }

  const m = readMarker(marker);
  if (!m.branch) {
    process.stderr.write("chi done: marker missing 'branch' field\n");
    return 1;
  }
  const base = m.base || "main";
  if (!m.pr) {
    process.stderr.write("chi done: no PR recorded yet — run 'chi ship' first to create one\n");
    return 1;
  }

  const cur = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (cur !== m.branch) {
    process.stderr.write(
      `chi done: HEAD is on '${cur}' but flow branch is '${m.branch}' — checkout it first\n`,
    );
    return 1;
  }

  let mergeMode: "auto" | "direct" = "auto";
  let draftPromoted = false;
  for (;;) {
    const args =
      mergeMode === "auto"
        ? ["pr", "merge", m.pr, "--squash", "--auto", "--delete-branch"]
        : ["pr", "merge", m.pr, "--squash", "--delete-branch"];
    const r = execSync("gh", args);
    if (r.ok) break;

    if (mergeMode === "auto" && r.stderr.includes("enablePullRequestAutoMerge")) {
      process.stderr.write("chi done: auto-merge disabled on this repo — falling back to direct merge\n");
      mergeMode = "direct";
      continue;
    }
    if (!draftPromoted && r.stderr.includes("is still a draft")) {
      process.stderr.write(`chi done: PR #${m.pr} is a draft — marking ready, then retrying\n`);
      const ready = execSync("gh", ["pr", "ready", m.pr]);
      if (!ready.ok) {
        process.stderr.write(ready.stderr);
        return ready.status ?? 1;
      }
      draftPromoted = true;
      continue;
    }
    process.stderr.write(r.stderr);
    return r.status ?? 1;
  }

  const co = git(["checkout", base]);
  process.stderr.write(co.stderr);
  if (!co.ok) return co.status ?? 1;
  const pull = git(["pull", "--ff-only"]);
  process.stdout.write(pull.stdout);
  process.stderr.write(pull.stderr);
  if (!pull.ok) return pull.status ?? 1;
  git(["remote", "prune", "origin"]); // best-effort

  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${m.branch}`]).ok) {
    git(["branch", "-D", m.branch]); // best-effort
  }

  try {
    rmSync(marker, { force: true });
  } catch {
    /* ignore */
  }

  if (mergeMode === "auto") {
    process.stdout.write(
      `\n── flow done: PR #${m.pr} queued (auto-merge, squash, delete-branch) ──\n`,
    );
  } else {
    process.stdout.write(`\n── flow done: PR #${m.pr} merged (squash, delete-branch) ──\n`);
  }
  process.stdout.write(`back on ${base}\n`);
  return 0;
}
