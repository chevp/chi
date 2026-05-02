import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commandExists, execSync } from "../spawn.js";
import { git, gitDir, isInsideRepo } from "../git/index.js";
import { readMarker } from "./flow.js";
import { detectChiWorktree } from "./work.js";

const HELP = `chi done — finish the active chi flow.

Reads .git/chi-flow, then runs:
  gh pr merge <pr> --squash --auto --delete-branch
  git checkout <base> && git pull --ff-only && git remote prune origin

Options:
  --issue <n>   close GitHub issue #n after merge (overrides marker;
                useful when the flow was started via 'chi flow' rather
                than 'chi issue fix')
  -h, --help    show this help

Aborts if there's no active flow, or no PR yet (run 'chi ship' first).
`;

export async function run(argv: string[]): Promise<number> {
  let issueOverride = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (a === "--issue") {
      const v = argv[++i];
      if (!v) {
        process.stderr.write("chi done: --issue needs a value\n");
        return 1;
      }
      if (!/^\d+$/.test(v)) {
        process.stderr.write(`chi done: --issue '${v}' is not a valid issue number\n`);
        return 1;
      }
      issueOverride = v;
      continue;
    }
    process.stderr.write(`chi done: unknown option '${a}'\n`);
    return 1;
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

  // If we're inside a chi-managed worktree, the cleanup story is different:
  // `git checkout <base>` here would fail (base is checked out in the main
  // repo) and we don't want to disturb the source repo's HEAD anyway — the
  // user may be working on something else there. Just remove the worktree,
  // drop the local branch, close the issue. The user pulls main themselves.
  const wt = detectChiWorktree();
  if (wt) {
    const source = wt.meta.source;
    const rm = git(["worktree", "remove", wt.worktreePath, "--force"], source);
    process.stderr.write(rm.stderr);
    if (!rm.ok) {
      process.stderr.write(
        `chi done: 'git worktree remove' failed — clean up manually with 'git worktree prune'\n`,
      );
      return rm.status ?? 1;
    }
    if (git(["show-ref", "--verify", "--quiet", `refs/heads/${m.branch}`], source).ok) {
      git(["branch", "-D", m.branch], source);
    }
    git(["remote", "prune", "origin"], source); // best-effort

    const issueToClose = issueOverride || m.issue;
    if (issueToClose) {
      execSync("gh", ["issue", "close", issueToClose, "--reason", "completed"], { cwd: source });
    }

    // Marker is gone with the worktree; nothing to delete locally.
    if (mergeMode === "auto") {
      process.stdout.write(
        `\n── flow done: PR #${m.pr} queued (auto-merge) + worktree removed ──\n`,
      );
    } else {
      process.stdout.write(`\n── flow done: PR #${m.pr} merged + worktree removed ──\n`);
    }
    process.stdout.write(`note: your shell is now in a deleted directory — cd ${source}\n`);
    return 0;
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

  // Best-effort close the linked issue. With auto-merge GitHub's "Closes #N"
  // parser handles this asynchronously, but in direct-merge mode the issue
  // closes only if the PR body had the keyword — call gh as a safety net.
  // Idempotent: closing an already-closed issue exits non-zero, which we ignore.
  const issueToClose = issueOverride || m.issue;
  if (issueToClose) {
    execSync("gh", ["issue", "close", issueToClose, "--reason", "completed"]);
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
