import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { c } from "./ui.js";

/**
 * Resolve chi's own repository root from the running script location.
 * bin/chi → dist/index.js, so any file under dist/ is two levels below the repo root.
 */
function resolveChiRoot(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // here is <chiRoot>/dist or <chiRoot>/dist/commands — walk up until we
    // find a directory that `git rev-parse` recognises as a repo root.
    let dir = here;
    for (let i = 0; i < 5; i++) {
      const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 3000,
      });
      if (r.status === 0) return r.stdout.trim();
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not resolvable — skip silently */
  }
  return null;
}

/**
 * After a successful top-level `chi ship`, check whether chi itself is behind
 * origin/main and nudge the user to run `chi reinstall`.
 *
 * Silent when: up-to-date, CHI_NO_UPDATE_CHECK=1, nested invocation, or any
 * git operation fails.
 */
export function checkForUpdate(): void {
  if (process.env.CHI_NO_UPDATE_CHECK === "1") return;
  if (process.env.__CHI_NESTED === "1") return;

  const chiRoot = resolveChiRoot();
  if (!chiRoot) return;

  // Fetch quietly with a short timeout so a bad network doesn't stall ship.
  const fetch = spawnSync(
    "git",
    ["-C", chiRoot, "fetch", "--quiet", "origin", "main"],
    { encoding: "utf8", windowsHide: true, timeout: 5000 },
  );
  if (fetch.status !== 0) return;

  const local = spawnSync(
    "git",
    ["-C", chiRoot, "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  );
  const remote = spawnSync(
    "git",
    ["-C", chiRoot, "rev-parse", "origin/main"],
    { encoding: "utf8", windowsHide: true },
  );
  if (local.status !== 0 || remote.status !== 0) return;

  const localSha = local.stdout.trim();
  const remoteSha = remote.stdout.trim();
  if (localSha === remoteSha) return;

  // Check whether local is an ancestor of remote (i.e. behind, not diverged
  // on a feature branch).
  const behind = spawnSync(
    "git",
    ["-C", chiRoot, "merge-base", "--is-ancestor", localSha, remoteSha],
    { windowsHide: true },
  );
  if (behind.status !== 0) return;

  process.stderr.write(
    `\n${c.yellow("chi: a newer version is available on origin/main")}\n` +
      `  run ${c.bold("chi reinstall")} to update\n`,
  );
}
