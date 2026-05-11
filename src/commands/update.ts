import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { execInherit } from "../spawn.js";
import { git, isInsideRepo, repoRoot as getRepoRoot } from "../git/index.js";
import { discoverRepos, repoLabel } from "../workspace.js";
import { recoverRepo, printReport, summarize, type RecoveryReport } from "../recover.js";
import { c, kv, section } from "../ui.js";
import { BIN_NAME } from "../identity.js";

const REMOTE = "github:chevp/chi";

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
  When the running binary resolves into a workspace clone, updates the clone
  in place: \`git pull --ff-only --autostash\`, \`npm install\`, \`npm run build\`.
  No global npm install. Otherwise reinstalls from ${REMOTE} via \`npm install -g\`.

Flags:
  --no-recover     skip phase 1
  --no-self        skip phase 2
  -h, --help       show this help
`;

function findPackageRoot(start: string): string | null {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readPackageVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function versionLine(oldVer: string | null, newVer: string | null): string {
  const o = oldVer ?? "?";
  const n = newVer ?? "?";
  if (o === n) return `${o} ${c.dim("(unchanged)")}`;
  return `${c.dim(o)} → ${c.green(n)}`;
}

async function selfUpdate(): Promise<number> {
  const realBin = realpathSync(process.argv[1] ?? "");
  const root = findPackageRoot(dirname(realBin));
  if (!root) {
    process.stderr.write(`${BIN_NAME} update: could not locate the chi package root from ${realBin}\n`);
    return 1;
  }

  const oldVersion = readPackageVersion(root);
  const isWorkspaceClone = existsSync(join(root, ".git"));

  section(`== self-update ==`);
  if (isWorkspaceClone) {
    const oldShort = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
    const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root).stdout.trim() || "(detached)";
    const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root).stdout.trim();
    kv("location", `workspace clone (${root})`);
    kv("branch", upstream ? `${branch} ← ${upstream}` : branch);
    kv("current version", `v${oldVersion ?? "?"} @ ${oldShort || "?"}`);
    kv("source", upstream || "(no upstream)");
    process.stdout.write("\n");

    if (!upstream) {
      process.stderr.write(
        `${BIN_NAME} update: workspace clone has no upstream; skipping (set one with \`git branch --set-upstream-to=...\`)\n`,
      );
      return 1;
    }

    const pull = await execInherit("git", ["pull", "--ff-only", "--autostash"], { cwd: root });
    if (pull !== 0) {
      process.stderr.write(
        `${BIN_NAME} update: git pull failed in ${root} — resolve manually and retry\n`,
      );
      return pull;
    }

    const install = await execInherit("npm", ["install"], { cwd: root });
    if (install !== 0) return install;

    const build = await execInherit("npm", ["run", "build"], { cwd: root });
    if (build !== 0) return build;

    const newVersion = readPackageVersion(root);
    const newShort = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
    section(`== summary ==`);
    if (oldVersion && newVersion && oldVersion === newVersion && oldShort === newShort) {
      process.stdout.write(`  ${c.green("✓")} already up to date at v${oldVersion} @ ${newShort}\n\n`);
    } else {
      kv("version", versionLine(oldVersion, newVersion));
      if (oldShort !== newShort) kv("commit", `${c.dim(oldShort)} → ${c.green(newShort)}`);
      process.stdout.write("\n");
    }
    return 0;
  }

  kv("location", `global install (${root})`);
  kv("current version", `v${oldVersion ?? "?"}`);
  kv("source", REMOTE);
  process.stdout.write("\n");

  const rc = await execInherit("npm", ["install", "-g", REMOTE]);
  if (rc !== 0) return rc;

  const newVersion = readPackageVersion(root);
  section(`== summary ==`);
  if (oldVersion && newVersion && oldVersion === newVersion) {
    process.stdout.write(`  ${c.green("✓")} already up to date at v${oldVersion}\n\n`);
  } else {
    kv("version", versionLine(oldVersion, newVersion));
    process.stdout.write("\n");
  }
  return 0;
}

function recoverScope(): RecoveryReport[] {
  if (isInsideRepo()) {
    const root = getRepoRoot();
    return [recoverRepo(root, { label: root.split(/[\\/]/).pop() ?? root })];
  }
  const cwd = process.cwd();
  const repos = discoverRepos(cwd);
  if (repos.length === 0) {
    process.stderr.write(
      `${BIN_NAME} update: no git repositories found under ${cwd.replace(/\\/g, "/")}\n`,
    );
    return [];
  }
  process.stdout.write(`${c.bold(`== recover ${repos.length} repos ==`)}\n`);
  const reports: RecoveryReport[] = [];
  for (const info of repos) {
    reports.push(recoverRepo(info.path, { label: repoLabel(info) }));
  }
  return reports;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  const skipRecover = argv.includes("--no-recover");
  const skipSelf = argv.includes("--no-self");

  let recoveryHadErrors = false;

  if (!skipRecover) {
    const reports = recoverScope();
    for (const r of reports) printReport(r);
    if (reports.length > 0) {
      process.stdout.write(`\n${c.bold("== recovery ==")}\n  ${summarize(reports)}\n\n`);
    }
    recoveryHadErrors = reports.some((r) => r.errors.length > 0);
  }

  if (skipSelf) {
    return recoveryHadErrors ? 1 : 0;
  }

  const selfRc = await selfUpdate();
  if (selfRc !== 0) return selfRc;
  return recoveryHadErrors ? 1 : 0;
}
