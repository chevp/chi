import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { execInherit } from "../spawn.js";

const HELP = `chi update — update chi itself.

Usage: chi update

Detects how chi was installed and refreshes it in place:
  - workspace clone (bin/chi resolves into a git repo): git pull --ff-only,
    then npm install (the prepare hook rebuilds dist/).
  - npm global install: npm install -g github:chevp/chi.

Local uncommitted changes are preserved — git pull will fail rather than
clobber them. If pull fails, resolve manually and re-run.
`;

const REMOTE = "github:chevp/chi";

function findPackageRoot(start: string): string | null {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function run(argv: string[]): Promise<number> {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  const realBin = realpathSync(process.argv[1] ?? "");
  const root = findPackageRoot(dirname(realBin));
  if (!root) {
    process.stderr.write(`chi update: could not locate the chi package root from ${realBin}\n`);
    return 1;
  }

  const isWorkspace = existsSync(join(root, ".git"));

  if (isWorkspace) {
    process.stdout.write(`chi update: workspace clone at ${root}\n`);
    const pulled = await execInherit("git", ["-C", root, "pull", "--ff-only"]);
    if (pulled !== 0) return pulled;
    return execInherit("npm", ["--prefix", root, "install", "--no-audit", "--no-fund"]);
  }

  process.stdout.write(`chi update: global install (${REMOTE})\n`);
  return execInherit("npm", ["install", "-g", REMOTE]);
}
