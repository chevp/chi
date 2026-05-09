import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const MAX_GLOBAL_REPOS = 200;

export interface RepoInfo {
  /** Absolute path to the repo. */
  path: string;
  /** Repo directory name (basename of path). */
  name: string;
  /** Parent directory name when the repo lives one level below cwd; "" for direct children. */
  category: string;
}

export function isRepo(dir: string): boolean {
  try {
    return existsSync(join(dir, ".git"));
  } catch {
    return false;
  }
}

export function listChildDirs(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) out.push(full);
    } catch {
      // skip unreadable entries
    }
  }
  return out;
}

/**
 * Two-level scan for git repositories.
 *
 * Direct children that are repos are returned as-is; direct children that are
 * not repos are treated as category folders and their own children are
 * scanned one level deeper. Handles both `c:/chevp/tools` (direct child repos)
 * and `c:/chevp` (category folders containing repos).
 */
export function discoverRepos(dir: string): RepoInfo[] {
  const repos: RepoInfo[] = [];
  for (const child of listChildDirs(dir)) {
    if (isRepo(child)) {
      repos.push({ path: child, name: basename(child), category: "" });
      if (repos.length >= MAX_GLOBAL_REPOS) return repos;
      continue;
    }
    const cat = basename(child);
    for (const grand of listChildDirs(child)) {
      if (isRepo(grand)) {
        repos.push({ path: grand, name: basename(grand), category: cat });
        if (repos.length >= MAX_GLOBAL_REPOS) return repos;
      }
    }
  }
  return repos;
}

export function groupByCategory(repos: RepoInfo[]): Map<string, RepoInfo[]> {
  const groups = new Map<string, RepoInfo[]>();
  for (const r of repos) {
    const arr = groups.get(r.category) ?? [];
    arr.push(r);
    groups.set(r.category, arr);
  }
  return groups;
}

export function repoLabel(info: RepoInfo): string {
  return info.category ? `${info.category}/${info.name}` : info.name;
}
