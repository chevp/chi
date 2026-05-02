import { basename, join } from "node:path";
import { existsSync, appendFileSync } from "node:fs";
import { commandExists, execInherit, execSync } from "../spawn.js";
import { git, gitDir, isInsideRepo, pushWithRecovery } from "../git/index.js";
import { readMarker } from "./flow.js";
import { run as commitRun } from "./commit.js";

const HELP = `chi ship — for this repo and every submodule (recursively):
  init if missing, fast-forward pull if on a branch, then add + commit + push.

In flow mode (.git/chi-flow present): commit, push -u origin <branch>, and on
first call open a draft PR via gh.
`;

const SELF_BIN = process.argv[1] ?? "chi";

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (!isInsideRepo()) {
    process.stderr.write("chi ship: not a git repository\n");
    return 1;
  }

  const repoRoot = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  const dir = gitDir();
  if (!dir) return 1;
  const marker = join(dir, "chi-flow");

  // --- submodules: recurse first so the parent commit can include any pointer
  // bumps the children produced.
  const gmodPath = join(repoRoot, ".gitmodules");
  if (existsSync(gmodPath)) {
    const failed: string[] = [];
    const cfg = git(
      ["-C", repoRoot, "config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    ).stdout;
    for (const ln of cfg.split(/\r?\n/)) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      const smPath = trimmed.split(/\s+/, 2)[1];
      if (!smPath) continue;

      const init = git(["-C", repoRoot, "submodule", "update", "--init", "--", smPath]);
      if (!init.ok) {
        failed.push(`${smPath} (init failed)`);
        process.stderr.write(
          `chi ship: submodule update failed for '${smPath}' — skipping (continuing)\n`,
        );
        continue;
      }

      const smAbs = join(repoRoot, smPath);
      if (!existsSync(join(smAbs, ".git"))) continue;

      // ff-pull on a branch only.
      if (git(["-C", smAbs, "symbolic-ref", "-q", "HEAD"]).ok) {
        const ff = git(["-C", smAbs, "pull", "--ff-only", "--quiet"]);
        if (!ff.ok) {
          process.stdout.write(`chi ship: pull failed in ${smPath} (continuing)\n`);
        }
      } else {
        process.stdout.write(`chi ship: ${smPath} is in detached HEAD, skipping pull\n`);
      }

      const subRc = await execInherit(process.execPath, [SELF_BIN, "ship"], { cwd: smAbs });
      if (subRc !== 0) {
        failed.push(`${smPath} (ship failed)`);
        process.stderr.write(`chi ship: ship failed in '${smPath}' (continuing)\n`);
      }
    }

    if (failed.length > 0) {
      process.stderr.write(`\nchi ship: ${failed.length} submodule(s) had errors:\n`);
      for (const f of failed) process.stderr.write(`  - ${f}\n`);
    }
  }

  // --- pull main repo before commit/push: ff-only first, fall back to rebase ---
  if (
    git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok &&
    git(["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok
  ) {
    const ff = git(["-C", repoRoot, "pull", "--ff-only", "--autostash"]);
    if (!ff.ok) {
      process.stderr.write(
        `chi ship: ff-only pull failed in ${basename(repoRoot)} — trying pull --rebase --autostash\n`,
      );
      const rb = git(["-C", repoRoot, "pull", "--rebase", "--autostash"]);
      process.stdout.write(rb.stdout);
      process.stderr.write(rb.stderr);
      if (!rb.ok) {
        const innerDir = git(["-C", repoRoot, "rev-parse", "--git-dir"]).stdout.trim();
        const inRebase =
          existsSync(join(innerDir, "rebase-merge")) || existsSync(join(innerDir, "rebase-apply"));
        if (inRebase) {
          // chi does not currently auto-resolve via claude — surface the conflicts and abort.
          process.stderr.write(
            `chi ship: rebase produced conflicts in ${basename(
              repoRoot,
            )} — resolve manually and retry (chi does not yet wrap claude for conflict resolution)\n`,
          );
          const conflicts = git(
            ["-C", repoRoot, "diff", "--name-only", "--diff-filter=U"],
          ).stdout.trim();
          if (conflicts) process.stderr.write(`conflicting files:\n${conflicts}\n`);
          git(["-C", repoRoot, "rebase", "--abort"]);
          return 1;
        }
        process.stderr.write(
          `chi ship: pull failed in ${basename(repoRoot)} — resolve manually and retry\n`,
        );
        return 1;
      }
    }
  }

  // --- flow mode ---
  if (existsSync(marker)) {
    const m = readMarker(marker);
    const base = m.base || "main";
    const cur = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (cur !== m.branch) {
      process.stderr.write(
        `chi ship: marker says flow branch '${m.branch}' but HEAD is '${cur}'\n`,
      );
      return 1;
    }

    if (!commandExists("gh")) {
      process.stderr.write("chi ship: missing dependency: gh (required in flow mode)\n");
      return 1;
    }

    const flowLabel = m.pr
      ? `flow: ${m.branch} → ${base}, PR #${m.pr}`
      : `flow: ${m.branch} → ${base}`;
    process.stdout.write(`\n── repo: ${basename(repoRoot)} (${flowLabel}) ──\n`);

    const commitRc = await commitRun(["--yes"]);
    if (commitRc !== 0) return commitRc;

    const pushRc = pushWithRecovery({ args: ["-u", "origin", m.branch] });
    if (pushRc !== 0) return pushRc;

    if (!m.pr) {
      const ahead = git(["log", `origin/${base}..${m.branch}`, "--oneline"]).stdout.trim();
      if (!ahead) {
        process.stderr.write(
          `chi ship: no commits on '${m.branch}' beyond '${base}' yet — skipping PR creation\n`,
        );
        return 0;
      }
      const createArgs = ["pr", "create", "--draft", "--base", base, "--head", m.branch];
      if (m.issue) {
        // Build title/body explicitly so we can inject "Closes #N" — GitHub's
        // auto-close keyword. `--fill` would otherwise pull body from commit
        // messages, which usually don't contain the magic phrase.
        const log = git(["log", "-1", "--format=%B", m.branch]).stdout;
        const lines = log.split(/\r?\n/);
        const title = (lines.shift() ?? "").trim() || `fix: issue #${m.issue}`;
        while (lines.length && (lines[0] ?? "").trim() === "") lines.shift();
        const bodyText = lines.join("\n").trim();
        const closes = `Closes #${m.issue}`;
        const body =
          bodyText.length === 0
            ? closes
            : bodyText.includes(closes)
              ? bodyText
              : `${bodyText}\n\n${closes}`;
        createArgs.push("--title", title, "--body", body);
      } else {
        createArgs.push("--fill");
      }
      const create = execSync("gh", createArgs);
      if (!create.ok) {
        process.stderr.write(create.stderr);
        return create.status ?? 1;
      }
      const url = create.stdout.trim();
      const match = url.match(/\/pull\/(\d+)/);
      const newPr = match ? match[1] : "";
      if (!newPr) {
        process.stderr.write(`chi ship: failed to parse PR number from gh output: ${url}\n`);
        return 1;
      }
      appendFileSync(marker, `pr=${newPr}\n`);
      process.stdout.write(`\n→ draft PR: ${url}\n`);
    } else {
      process.stdout.write(`\n→ updated PR #${m.pr}\n`);
    }
    return 0;
  }

  // --- detached HEAD recovery before deciding clean/dirty ---
  if (!git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok) {
    const detachedSha = git(["-C", repoRoot, "rev-parse", "HEAD"]).stdout.trim();
    let recoverBranch = "";
    if (existsSync(marker)) {
      recoverBranch = readMarker(marker).branch;
      if (
        recoverBranch &&
        !git(["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${recoverBranch}`]).ok
      ) {
        recoverBranch = "";
      }
    }
    if (!recoverBranch) {
      const list = git([
        "-C",
        repoRoot,
        "for-each-ref",
        "--format=%(refname:short)",
        "--contains",
        detachedSha,
        "refs/heads/",
      ]).stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      recoverBranch = list[0] ?? "";
    }
    if (recoverBranch) {
      const co = git(["-C", repoRoot, "checkout", recoverBranch]);
      if (co.ok) {
        process.stdout.write(`chi ship: recovered from detached HEAD, switched to '${recoverBranch}'\n`);
      } else {
        process.stdout.write(
          `chi ship: detached HEAD at ${detachedSha} (could not recover to '${recoverBranch}')\n`,
        );
      }
    } else {
      process.stdout.write(
        `chi ship: detached HEAD at ${detachedSha} (no branch contains this commit)\n`,
      );
    }
  }

  // Compact path: nothing in the working tree → one-line status, skip commit.
  const dirty = git(["-C", repoRoot, "status", "--porcelain"]).stdout.trim();
  if (!dirty) {
    process.stdout.write(`${basename(repoRoot)}: clean\n`);
    return 0;
  }

  process.stdout.write(`\n── repo: ${basename(repoRoot)} ──\n`);

  if (git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok) {
    return commitRun(["--push", "--yes"]);
  }
  process.stdout.write("chi ship: still in detached HEAD, committing without push\n");
  return commitRun(["--yes"]);
}
