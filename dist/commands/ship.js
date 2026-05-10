import { basename, join } from "node:path";
import { existsSync, appendFileSync } from "node:fs";
import { commandExists, execInherit, execSync } from "../spawn.js";
import { git, gitDir, isInsideRepo, pushWithRecovery } from "../git/index.js";
import { resolveConflicts, finalizeRebase } from "../conflict.js";
import { c } from "../ui.js";
import { BIN_NAME } from "../identity.js";
import { readMarker } from "./flow.js";
import { run as commitRun } from "./commit.js";
import { listActiveChiFlows } from "./work.js";
import { discoverRepos, repoLabel } from "../workspace.js";
const HELP = `${BIN_NAME} ship — for this repo and every submodule (recursively):
  init if missing, fast-forward pull if on a branch, then add + commit + push.

In flow mode (.git/chi-flow present): commit, push -u origin <branch>, and on
first call open a draft PR via gh.

Workspace-root mode (cwd is not a git repo):
  Discover repos one or two levels deep, optionally clone any missing repos
  via misc/chevp-setup/clone-all.py, then run \`${BIN_NAME} ship\` in each.
`;
const SELF_BIN = process.argv[1] ?? "chi";
/**
 * Workspace-root mode: discover repos under cwd and ship each.
 *
 * Before iterating, attempts to clone any repos listed in repo-map.json
 * via chevp-setup's clone-all.py (if both python and the script are
 * available). Failures in individual repos do not abort the rest.
 */
async function globalShip(argv) {
    const cwd = process.cwd();
    const cwdFwd = cwd.replace(/\\/g, "/");
    const skipClone = argv.includes("--no-clone");
    // ---- 1. Optionally sync the workspace via chevp-setup ------------------
    const cloneScript = join(cwd, "misc", "chevp-setup", "clone-all.py");
    if (!skipClone && existsSync(cloneScript)) {
        process.stdout.write(`${c.bold("== sync workspace ==")}\n`);
        process.stdout.write(`  → ${cloneScript.replace(/\\/g, "/")}\n`);
        const py = commandExists("python")
            ? "python"
            : commandExists("python3")
                ? "python3"
                : "";
        if (!py) {
            process.stdout.write(`  ${c.yellow("python not on PATH — skipping clone-all (re-run with python installed to fetch missing repos)")}\n`);
        }
        else {
            const rc = await execInherit(py, [cloneScript], { cwd });
            if (rc !== 0) {
                process.stdout.write(`  ${c.yellow(`clone-all exited ${rc} — continuing with locally available repos`)}\n`);
            }
        }
    }
    else if (!skipClone) {
        process.stdout.write(`  ${c.dim(`(no misc/chevp-setup/clone-all.py under ${cwdFwd} — skipping repo sync)`)}\n`);
    }
    // ---- 2. Discover repos (after clone-all so newly cloned ones count) ----
    const repos = discoverRepos(cwd);
    if (repos.length === 0) {
        process.stderr.write(`${BIN_NAME} ship: no git repositories found under ${cwdFwd}\n`);
        return 1;
    }
    process.stdout.write(`\n${c.bold(`== ship ${repos.length} repos ==`)}\n`);
    const failures = [];
    let shipped = 0;
    for (const info of repos) {
        const label = repoLabel(info);
        process.stdout.write(`\n${c.cyan(`── ${label} ──`)}\n`);
        const rc = await execInherit(process.execPath, [SELF_BIN, "ship"], {
            cwd: info.path,
            env: { ...process.env, __CHI_NESTED: "1" },
        });
        if (rc !== 0) {
            failures.push(label);
        }
        else {
            shipped++;
        }
    }
    process.stdout.write(`\n${c.bold("== summary ==")}\n`);
    process.stdout.write(`  ${shipped}/${repos.length} ok`);
    if (failures.length > 0) {
        process.stdout.write(`,  ${c.red(`${failures.length} failed`)}\n`);
        for (const f of failures) {
            process.stdout.write(`    ${c.red("✗")} ${f}\n`);
        }
        return 1;
    }
    process.stdout.write(`\n`);
    return 0;
}
export async function run(argv) {
    if (argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP);
        return 0;
    }
    if (!isInsideRepo()) {
        return globalShip(argv);
    }
    const repoRoot = git(["rev-parse", "--show-toplevel"]).stdout.trim();
    const dir = gitDir();
    if (!dir)
        return 1;
    const marker = join(dir, "chi-flow");
    // --- submodules: recurse first so the parent commit can include any pointer
    // bumps the children produced.
    const gmodPath = join(repoRoot, ".gitmodules");
    if (existsSync(gmodPath)) {
        const failed = [];
        const cfg = git(["-C", repoRoot, "config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"]).stdout;
        for (const ln of cfg.split(/\r?\n/)) {
            const trimmed = ln.trim();
            if (!trimmed)
                continue;
            const smPath = trimmed.split(/\s+/, 2)[1];
            if (!smPath)
                continue;
            const init = git(["-C", repoRoot, "submodule", "update", "--init", "--", smPath]);
            if (!init.ok) {
                failed.push(`${smPath} (init failed)`);
                process.stderr.write(`chi ship: submodule update failed for '${smPath}' — skipping (continuing)\n`);
                continue;
            }
            const smAbs = join(repoRoot, smPath);
            if (!existsSync(join(smAbs, ".git")))
                continue;
            // ff-pull on a branch only.
            if (git(["-C", smAbs, "symbolic-ref", "-q", "HEAD"]).ok) {
                const ff = git(["-C", smAbs, "pull", "--ff-only", "--quiet"]);
                if (!ff.ok) {
                    process.stdout.write(`chi ship: pull failed in ${smPath} (continuing)\n`);
                }
            }
            else {
                process.stdout.write(`chi ship: ${smPath} is in detached HEAD, skipping pull\n`);
            }
            const subRc = await execInherit(process.execPath, [SELF_BIN, "ship"], {
                cwd: smAbs,
                env: { ...process.env, __CHI_NESTED: "1" },
            });
            if (subRc !== 0) {
                failed.push(`${smPath} (ship failed)`);
                process.stderr.write(`chi ship: ship failed in '${smPath}' (continuing)\n`);
            }
        }
        if (failed.length > 0) {
            process.stderr.write(`\nchi ship: ${failed.length} submodule(s) had errors:\n`);
            for (const f of failed)
                process.stderr.write(`  - ${f}\n`);
        }
    }
    // --- pull main repo before commit/push: ff-only first, fall back to rebase ---
    if (git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok &&
        git(["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok) {
        const ff = git(["-C", repoRoot, "pull", "--ff-only", "--autostash"]);
        if (!ff.ok) {
            process.stderr.write(`chi ship: ff-only pull failed in ${basename(repoRoot)} — trying pull --rebase --autostash\n`);
            const rb = git(["-C", repoRoot, "pull", "--rebase", "--autostash"]);
            process.stdout.write(rb.stdout);
            process.stderr.write(rb.stderr);
            if (!rb.ok) {
                const innerDir = git(["-C", repoRoot, "rev-parse", "--git-dir"]).stdout.trim();
                const inRebase = existsSync(join(innerDir, "rebase-merge")) || existsSync(join(innerDir, "rebase-apply"));
                if (inRebase) {
                    const result = await resolveConflicts(repoRoot);
                    const rc = finalizeRebase(repoRoot, result);
                    if (rc !== 0)
                        return rc;
                    // Rebase succeeded after resolution — continue with ship
                }
                process.stderr.write(`chi ship: pull failed in ${basename(repoRoot)} — resolve manually and retry\n`);
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
            process.stderr.write(`chi ship: marker says flow branch '${m.branch}' but HEAD is '${cur}'\n`);
            return 1;
        }
        if (!commandExists("gh")) {
            process.stderr.write(`${BIN_NAME} ship: missing dependency: gh (required in flow mode)\n`);
            return 1;
        }
        const flowLabel = m.pr
            ? `flow: ${m.branch} → ${base}, PR #${m.pr}`
            : `flow: ${m.branch} → ${base}`;
        process.stdout.write(`\n── repo: ${basename(repoRoot)} (${flowLabel}) ──\n`);
        const commitRc = await commitRun(["--yes"]);
        if (commitRc !== 0)
            return commitRc;
        const pushRc = await pushWithRecovery({ args: ["-u", "origin", m.branch] });
        if (pushRc !== 0)
            return pushRc;
        if (!m.pr) {
            const ahead = git(["log", `origin/${base}..${m.branch}`, "--oneline"]).stdout.trim();
            if (!ahead) {
                process.stderr.write(`chi ship: no commits on '${m.branch}' beyond '${base}' yet — skipping PR creation\n`);
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
                while (lines.length && (lines[0] ?? "").trim() === "")
                    lines.shift();
                const bodyText = lines.join("\n").trim();
                const closes = `Closes #${m.issue}`;
                const body = bodyText.length === 0
                    ? closes
                    : bodyText.includes(closes)
                        ? bodyText
                        : `${bodyText}\n\n${closes}`;
                createArgs.push("--title", title, "--body", body);
            }
            else {
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
        }
        else {
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
            if (recoverBranch &&
                !git(["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${recoverBranch}`]).ok) {
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
            }
            else {
                process.stdout.write(`chi ship: detached HEAD at ${detachedSha} (could not recover to '${recoverBranch}')\n`);
            }
        }
        else {
            process.stdout.write(`chi ship: detached HEAD at ${detachedSha} (no branch contains this commit)\n`);
        }
    }
    // --- rebase onto default branch (e.g. origin/main) before pushing ---
    // Keeps feature branches up to date with main so a PR back to main is
    // always trivially mergeable. If a rebase rewrites history, the subsequent
    // push must use --force-with-lease.
    let needForceWithLease = false;
    if (git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok) {
        const curBranch = git(["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "HEAD"]).stdout.trim();
        const headRef = git([
            "-C", repoRoot, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD",
        ]);
        let defaultBranch = "";
        if (headRef.ok) {
            defaultBranch = headRef.stdout.trim().replace(/^origin\//, "");
        }
        else {
            for (const cand of ["main", "master"]) {
                if (git([
                    "-C", repoRoot, "show-ref", "--verify", "--quiet",
                    `refs/remotes/origin/${cand}`,
                ]).ok) {
                    defaultBranch = cand;
                    break;
                }
            }
        }
        if (defaultBranch && curBranch && curBranch !== defaultBranch) {
            const fetch = git(["-C", repoRoot, "fetch", "origin", defaultBranch]);
            if (!fetch.ok) {
                process.stderr.write(`${c.dim(`${BIN_NAME} ship: fetch origin/${defaultBranch} failed — skipping rebase`)}\n`);
            }
            else {
                const behindStr = git([
                    "-C", repoRoot, "rev-list", "--count", `HEAD..origin/${defaultBranch}`,
                ]).stdout.trim();
                const behind = Number.parseInt(behindStr, 10) || 0;
                if (behind > 0) {
                    const headBefore = git(["-C", repoRoot, "rev-parse", "HEAD"]).stdout.trim();
                    process.stdout.write(`${c.dim(`${BIN_NAME} ship: ${curBranch} is ${behind} commit(s) behind origin/${defaultBranch} — rebasing`)}\n`);
                    const rb = git([
                        "-C", repoRoot, "rebase", "--autostash", `origin/${defaultBranch}`,
                    ]);
                    process.stdout.write(rb.stdout);
                    process.stderr.write(rb.stderr);
                    if (!rb.ok) {
                        const innerDir = git([
                            "-C", repoRoot, "rev-parse", "--git-dir",
                        ]).stdout.trim();
                        const inRebase = existsSync(join(innerDir, "rebase-merge")) ||
                            existsSync(join(innerDir, "rebase-apply"));
                        if (inRebase) {
                            const result = await resolveConflicts(repoRoot);
                            const rc = finalizeRebase(repoRoot, result);
                            if (rc !== 0)
                                return rc;
                        }
                        else {
                            process.stderr.write(`${BIN_NAME} ship: rebase onto origin/${defaultBranch} failed — resolve manually and retry\n`);
                            return 1;
                        }
                    }
                    const headAfter = git(["-C", repoRoot, "rev-parse", "HEAD"]).stdout.trim();
                    if (headAfter !== headBefore) {
                        needForceWithLease = true;
                    }
                }
            }
        }
    }
    // Compact path: nothing in the working tree → one-line status, skip commit.
    const dirty = git(["-C", repoRoot, "status", "--porcelain"]).stdout.trim();
    if (!dirty) {
        if (needForceWithLease) {
            process.stdout.write(`\n── repo: ${basename(repoRoot)} (rebased) ──\n`);
            const rc = await pushWithRecovery({
                args: ["--force-with-lease"],
                cwd: repoRoot,
            });
            if (rc !== 0)
                return rc;
        }
        else {
            process.stdout.write(`${basename(repoRoot)}: clean\n`);
        }
        // Worktree-aware hint: if the source repo is clean but a chi-managed
        // worktree has an active flow, the user probably ran ship from the wrong
        // directory. Point them at it. (This is the common pitfall after
        // `chi issue fix N` — claude's work lives in ../<repo>-issue-N.)
        const flows = listActiveChiFlows();
        if (flows.length > 0) {
            process.stdout.write(`\n${c.yellow("note:")} active flow(s) in chi-managed worktree(s):\n`);
            for (const f of flows) {
                const tag = f.flow.issue ? ` (issue #${f.flow.issue})` : "";
                process.stdout.write(`  ${c.cyan(f.flow.branch)}${tag}\n`);
                process.stdout.write(`    ${c.dim("→")} cd ${f.worktreePath} && chi ship\n`);
            }
        }
        return 0;
    }
    process.stdout.write(`\n── repo: ${basename(repoRoot)} ──\n`);
    let rc;
    if (git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]).ok) {
        if (needForceWithLease) {
            rc = await commitRun(["--yes"]);
            if (rc !== 0)
                return rc;
            rc = await pushWithRecovery({
                args: ["--force-with-lease"],
                cwd: repoRoot,
            });
        }
        else {
            rc = await commitRun(["--push", "--yes"]);
        }
    }
    else {
        process.stdout.write(`${BIN_NAME} ship: still in detached HEAD, committing without push\n`);
        rc = await commitRun(["--yes"]);
    }
    return rc;
}
//# sourceMappingURL=ship.js.map