import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { execInherit } from "../spawn.js";
import { git, isInsideRepo, repoRoot as getRepoRoot } from "../git/index.js";
import { discoverRepos, repoLabel } from "../workspace.js";
import { recoverRepo, printReport, summarize } from "../recover.js";
import { c, kv, section } from "../ui.js";
import { BIN_NAME } from "../identity.js";
const HELP = `${BIN_NAME} update — repair workspace state, then update ${BIN_NAME} itself.

Usage: ${BIN_NAME} update [--no-recover] [--no-self]

Phase 1: workspace recovery (default).
  Walks the workspace (or just the current repo) and repairs the kinds of
  damage \`${BIN_NAME} ship\` leaves behind when an autostash-rebase falls over:

    - aborts an in-progress rebase
    - recovers detached HEADs (switches to a branch that contains the commit,
      or to the default branch with a backup of the orphaned SHA)
    - drops every stash entry, archiving each as a patch first
    - clears conflict markers (<<<<<<<) by resetting the file to its indexed
      content; the conflicting side is preserved in the stash backups
    - unstages embedded git repos that \`git add\` slurped in by accident

  Every mutation is preceded by a backup under
  <gitDir>/chi-recover-backup-<timestamp>/.

Phase 2: self-update (default).
  Detects how ${BIN_NAME} was installed and refreshes it in place:
    - workspace clone (bin resolves into a git repo): git pull --ff-only,
      then npm install.
    - npm global install: npm install -g github:chevp/chi.

Flags:
  --no-recover     skip phase 1
  --no-self        skip phase 2
  -h, --help       show this help
`;
const REMOTE = "github:chevp/chi";
function findPackageRoot(start) {
    let dir = start;
    while (true) {
        if (existsSync(join(dir, "package.json")))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
function readPackageVersion(root) {
    try {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        return typeof pkg.version === "string" ? pkg.version : null;
    }
    catch {
        return null;
    }
}
function versionLine(oldVer, newVer) {
    const o = oldVer ?? "?";
    const n = newVer ?? "?";
    if (o === n)
        return `${o} ${c.dim("(unchanged)")}`;
    return `${c.dim(o)} → ${c.green(n)}`;
}
async function selfUpdateWorkspace(root) {
    const oldVersion = readPackageVersion(root);
    const oldSha = git(["rev-parse", "HEAD"], root).stdout.trim();
    const oldShort = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
    const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root).stdout.trim() || "(detached)";
    const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root).stdout.trim();
    section(`== self-update ==`);
    kv("location", `workspace clone (${root})`);
    kv("branch", upstream ? `${branch} ← ${upstream}` : branch);
    kv("current version", `v${oldVersion ?? "?"} @ ${oldShort || "?"}`);
    process.stdout.write("\n");
    const pulled = await execInherit("git", ["-C", root, "pull", "--ff-only"]);
    if (pulled !== 0)
        return pulled;
    const newSha = git(["rev-parse", "HEAD"], root).stdout.trim();
    const newShort = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
    const newVersion = readPackageVersion(root);
    const installed = await execInherit("npm", ["--prefix", root, "install", "--no-audit", "--no-fund"]);
    if (installed !== 0)
        return installed;
    section(`== summary ==`);
    if (oldSha && oldSha === newSha) {
        process.stdout.write(`  ${c.green("✓")} already up to date at ${oldShort} (v${oldVersion ?? "?"})\n\n`);
        return 0;
    }
    kv("version", versionLine(oldVersion, newVersion));
    kv("commit", `${c.dim(oldShort || "?")} → ${c.green(newShort || "?")}`);
    const commits = git([
        "-c", "color.ui=always",
        "log",
        `${oldSha}..${newSha}`,
        "--pretty=format:    %C(auto)%h%Creset %s %C(dim)(%cr)%Creset",
    ], root).stdout;
    if (commits.trim()) {
        const count = commits.split("\n").length;
        kv("commits pulled", String(count));
        process.stdout.write(`${commits}\n`);
    }
    process.stdout.write("\n");
    return 0;
}
async function selfUpdateGlobal(root) {
    const oldVersion = readPackageVersion(root);
    section(`== self-update ==`);
    kv("location", "global install");
    kv("source", REMOTE);
    kv("current version", `v${oldVersion ?? "?"}`);
    process.stdout.write("\n");
    const rc = await execInherit("npm", ["install", "-g", REMOTE]);
    if (rc !== 0)
        return rc;
    const newVersion = readPackageVersion(root);
    section(`== summary ==`);
    if (oldVersion && oldVersion === newVersion) {
        process.stdout.write(`  ${c.green("✓")} already up to date at v${oldVersion}\n\n`);
    }
    else {
        kv("version", versionLine(oldVersion, newVersion));
        process.stdout.write("\n");
    }
    return 0;
}
async function selfUpdate() {
    const realBin = realpathSync(process.argv[1] ?? "");
    const root = findPackageRoot(dirname(realBin));
    if (!root) {
        process.stderr.write(`${BIN_NAME} update: could not locate the chi package root from ${realBin}\n`);
        return 1;
    }
    const isWorkspaceClone = existsSync(join(root, ".git"));
    return isWorkspaceClone ? selfUpdateWorkspace(root) : selfUpdateGlobal(root);
}
function recoverScope() {
    if (isInsideRepo()) {
        const root = getRepoRoot();
        return [recoverRepo(root, { label: root.split(/[\\/]/).pop() ?? root })];
    }
    const cwd = process.cwd();
    const repos = discoverRepos(cwd);
    if (repos.length === 0) {
        process.stderr.write(`${BIN_NAME} update: no git repositories found under ${cwd.replace(/\\/g, "/")}\n`);
        return [];
    }
    process.stdout.write(`${c.bold(`== recover ${repos.length} repos ==`)}\n`);
    const reports = [];
    for (const info of repos) {
        reports.push(recoverRepo(info.path, { label: repoLabel(info) }));
    }
    return reports;
}
export async function run(argv) {
    if (argv.includes("-h") || argv.includes("--help")) {
        process.stdout.write(HELP);
        return 0;
    }
    const skipRecover = argv.includes("--no-recover");
    const skipSelf = argv.includes("--no-self");
    let recoveryHadErrors = false;
    if (!skipRecover) {
        const reports = recoverScope();
        for (const r of reports)
            printReport(r);
        if (reports.length > 0) {
            process.stdout.write(`\n${c.bold("== recovery ==")}\n  ${summarize(reports)}\n\n`);
        }
        recoveryHadErrors = reports.some((r) => r.errors.length > 0);
    }
    if (skipSelf) {
        return recoveryHadErrors ? 1 : 0;
    }
    const selfRc = await selfUpdate();
    if (selfRc !== 0)
        return selfRc;
    return recoveryHadErrors ? 1 : 0;
}
//# sourceMappingURL=update.js.map