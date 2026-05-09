import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
export const MAX_GLOBAL_REPOS = 200;
export function isRepo(dir) {
    try {
        return existsSync(join(dir, ".git"));
    }
    catch {
        return false;
    }
}
export function listChildDirs(dir) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const entry of entries.sort()) {
        if (entry.startsWith("."))
            continue;
        const full = join(dir, entry);
        try {
            if (statSync(full).isDirectory())
                out.push(full);
        }
        catch {
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
export function discoverRepos(dir) {
    const repos = [];
    for (const child of listChildDirs(dir)) {
        if (isRepo(child)) {
            repos.push({ path: child, name: basename(child), category: "" });
            if (repos.length >= MAX_GLOBAL_REPOS)
                return repos;
            continue;
        }
        const cat = basename(child);
        for (const grand of listChildDirs(child)) {
            if (isRepo(grand)) {
                repos.push({ path: grand, name: basename(grand), category: cat });
                if (repos.length >= MAX_GLOBAL_REPOS)
                    return repos;
            }
        }
    }
    return repos;
}
export function groupByCategory(repos) {
    const groups = new Map();
    for (const r of repos) {
        const arr = groups.get(r.category) ?? [];
        arr.push(r);
        groups.set(r.category, arr);
    }
    return groups;
}
export function repoLabel(info) {
    return info.category ? `${info.category}/${info.name}` : info.name;
}
//# sourceMappingURL=workspace.js.map