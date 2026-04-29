import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export function git(args: string[], cwd?: string): GitResult {
  const opts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    cwd,
    windowsHide: true,
  };
  const r = spawnSync("git", args, opts);
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").toString(),
    stderr: (r.stderr ?? "").toString(),
    status: r.status,
  };
}

export function isInsideRepo(): boolean {
  return git(["rev-parse", "--git-dir"]).ok;
}

export function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function currentBranch(): string {
  const sym = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (sym.ok) return sym.stdout.trim();
  const sha = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
  return `${sha} (detached)`;
}

export function upstreamRef(): string | null {
  const r = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return r.ok ? r.stdout.trim() : null;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export function aheadBehind(): AheadBehind {
  const r = git(["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (!r.ok) return { ahead: 0, behind: 0 };
  const parts = r.stdout.trim().split(/\s+/);
  const behind = Number.parseInt(parts[0] ?? "0", 10);
  const ahead = Number.parseInt(parts[1] ?? "0", 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

export interface PorcelainCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  total: number;
  raw: string;
}

export function porcelain(): PorcelainCounts {
  const r = git(["status", "--porcelain=v1"]);
  const raw = r.ok ? r.stdout : "";
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const ln of raw.split("\n")) {
    if (!ln) continue;
    const x = ln[0] ?? " ";
    const y = ln[1] ?? " ";
    if (ln.startsWith("??")) {
      untracked++;
      continue;
    }
    if ("MADRC".includes(x)) staged++;
    if ("MADRC".includes(y)) unstaged++;
  }
  return { staged, unstaged, untracked, total: staged + unstaged + untracked, raw };
}

export function shortStatus(): string {
  return git(["-c", "color.status=always", "status", "--short"]).stdout;
}

export function recentCommits(n = 5): string {
  return git([
    "-c", "color.ui=always",
    "log",
    `-n`, String(n),
    "--pretty=format:  %C(auto)%h%Creset %s %C(dim)(%cr)%Creset",
  ]).stdout;
}
