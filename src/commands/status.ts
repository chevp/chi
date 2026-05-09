import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { CHI_OS } from "../platform.js";
import { c, kv, line, section } from "../ui.js";
import { activeProviderName, getProvider } from "../provider/index.js";
import {
  aheadBehind,
  currentBranch,
  git,
  isInsideRepo,
  porcelain,
  recentCommits,
  repoRoot,
  shortStatus,
  submoduleStatusRecursive,
  upstreamRef,
} from "../git/index.js";
import { commandExists, execSync } from "../spawn.js";
import { parseFrontmatter, parseFrontmatterFile, statusBadge } from "../frontmatter.js";

const HELP = `chi status — overview of the current repo and chi-cli configuration.

Usage: chi status [options]

Options:
  -s, --short   only the one-line summary (no recent commits, no submodules)
  -h, --help    show this help
`;

interface IssueRow {
  num: string;
  title: string;
  labels: string;
  assignees: string;
  body: string;
}

interface PrRow {
  num: string;
  title: string;
  isDraft: boolean;
  head: string;
  review: string;
  author: string;
}

async function fetchGhIssues(timeoutSec: number, cwd?: string): Promise<IssueRow[] | null> {
  const r = execSync(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "5",
      "--json",
      "number,title,labels,assignees,body",
      "--jq",
      '.[] | "\\(.number)\\t\\(.title)\\t\\([.labels[].name]|join(","))\\t\\([.assignees[].login]|join(","))\\t\\(.body|@base64)"',
    ],
    { timeoutMs: timeoutSec * 1000, cwd },
  );
  if (!r.ok) return null;
  const out: IssueRow[] = [];
  for (const ln of r.stdout.split(/\r?\n/)) {
    if (!ln) continue;
    const [num, title, labels, assignees, bodyB64] = ln.split("\t");
    let body = "";
    if (bodyB64) {
      try {
        body = Buffer.from(bodyB64, "base64").toString("utf8");
      } catch {
        body = "";
      }
    }
    out.push({
      num: num ?? "",
      title: title ?? "",
      labels: labels ?? "",
      assignees: assignees ?? "",
      body,
    });
  }
  return out;
}

async function fetchGhPrs(timeoutSec: number, cwd?: string): Promise<PrRow[] | null> {
  const r = execSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "5",
      "--json",
      "number,title,isDraft,headRefName,reviewDecision,author",
      "--jq",
      '.[] | "\\(.number)\\t\\(.title)\\t\\(.isDraft)\\t\\(.headRefName)\\t\\(.reviewDecision // "")\\t\\(.author.login)"',
    ],
    { timeoutMs: timeoutSec * 1000, cwd },
  );
  if (!r.ok) return null;
  const out: PrRow[] = [];
  for (const ln of r.stdout.split(/\r?\n/)) {
    if (!ln) continue;
    const [num, title, isDraft, head, review, author] = ln.split("\t");
    out.push({
      num: num ?? "",
      title: title ?? "",
      isDraft: isDraft === "true",
      head: head ?? "",
      review: review ?? "",
      author: author ?? "",
    });
  }
  return out;
}

function prStateTag(row: PrRow): string {
  if (row.isDraft) return c.dim("draft");
  switch (row.review) {
    case "APPROVED":
      return c.green("approved");
    case "CHANGES_REQUESTED":
      return c.red("changes-requested");
    case "REVIEW_REQUIRED":
      return c.yellow("review-required");
    case "":
      return c.dim("open");
    default:
      return c.dim(row.review);
  }
}

const MAX_GLOBAL_REPOS = 10;

/** Scan immediate children of `dir` for git repositories (up to MAX_GLOBAL_REPOS). */
function discoverRepos(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const repos: string[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(full, ".git"))) {
      repos.push(full);
      if (repos.length >= MAX_GLOBAL_REPOS) break;
    }
  }
  return repos;
}

async function globalStatus(short: boolean): Promise<number> {
  const cwd = process.cwd();
  const repos = discoverRepos(cwd);

  section("global overview");
  process.stdout.write(`  ${c.dim(`(not inside a git repository — showing workspace summary)`)}\n`);

  if (repos.length === 0) {
    process.stdout.write(`  ${c.dim("no git repositories found in child directories")}\n`);
    line();
    return 0;
  }

  // ---- repositories with branch + state ------------------------------------
  section("repositories");
  for (const repo of repos) {
    const name = basename(repo);
    const branchR = git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo);
    const branch = branchR.ok ? branchR.stdout.trim() : "detached";
    const st = git(["status", "--porcelain=v1"], repo);
    const dirty = st.ok && st.stdout.trim().length > 0;
    const state = dirty ? c.yellow("dirty") : c.green("clean");
    process.stdout.write(`  ${c.cyan(name.padEnd(24))} ${branch.padEnd(20)} ${state}\n`);
  }

  if (short) {
    line();
    return 0;
  }

  // ---- recent commits per repo ---------------------------------------------
  section("recent commits");
  for (const repo of repos) {
    const name = basename(repo);
    const commits = recentCommits(3, repo);
    if (commits.trim()) {
      process.stdout.write(`  ${c.bold(name)}\n`);
      process.stdout.write(`${commits}\n`);
    }
  }

  // ---- GitHub: issues + PRs per repo ---------------------------------------
  if (commandExists("gh") && execSync("gh", ["auth", "status"]).ok) {
    const ghTimeout = Number.parseInt(process.env.CHI_GH_TIMEOUT ?? "3", 10) || 3;

    const allIssues: Array<{ repo: string; rows: IssueRow[] }> = [];
    const allPrs: Array<{ repo: string; rows: PrRow[] }> = [];

    for (const repo of repos) {
      const name = basename(repo);
      // Only query repos that have a GitHub remote
      const remote = git(["remote", "get-url", "origin"], repo);
      if (!remote.ok || !remote.stdout.includes("github")) continue;

      const [issues, prs] = await Promise.all([
        fetchGhIssues(ghTimeout, repo),
        fetchGhPrs(ghTimeout, repo),
      ]);
      if (issues && issues.length > 0) allIssues.push({ repo: name, rows: issues });
      if (prs && prs.length > 0) allPrs.push({ repo: name, rows: prs });
    }

    section("issues");
    if (allIssues.length > 0) {
      for (const { repo: repoName, rows } of allIssues) {
        process.stdout.write(`  ${c.bold(repoName)}\n`);
        for (const row of rows) {
          const fm = row.body
            ? parseFrontmatter(row.body)
            : { name: "", status: "", progress: "" };
          const meta: string[] = [];
          if (fm.progress) meta.push(c.dim(`(${fm.progress})`));
          if (row.labels) meta.push(c.dim(`[${row.labels}]`));
          if (row.assignees) meta.push(c.dim(`@${row.assignees}`));
          process.stdout.write(
            `    ${c.cyan(`#${row.num}`)} ${statusBadge(fm.status).padEnd(11)} ${row.title}${
              meta.length ? ` ${meta.join(" ")}` : ""
            }\n`,
          );
        }
      }
    } else {
      process.stdout.write(`  ${c.dim("(none open)")}\n`);
    }

    section("pull requests");
    if (allPrs.length > 0) {
      for (const { repo: repoName, rows } of allPrs) {
        process.stdout.write(`  ${c.bold(repoName)}\n`);
        for (const row of rows) {
          const tag = prStateTag(row);
          process.stdout.write(
            `    ${c.cyan(`#${row.num}`)} ${tag.padEnd(9)} ${row.title} ${c.dim(`(${row.head} by @${row.author})`)}\n`,
          );
        }
      }
    } else {
      process.stdout.write(`  ${c.dim("(none open)")}\n`);
    }
  }

  line();
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const first = argv[0];
  if (first === "-h" || first === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const short = first === "-s" || first === "--short";

  // ---- chi-cli ------------------------------------------------------------
  section("chi-cli");
  kv("platform", CHI_OS);

  const provider = getProvider();
  kv(
    "provider",
    `${activeProviderName()} ${c.dim(`(model: ${provider.activeModel()})`)}`,
  );

  const reachable = await provider.ping();
  kv(
    "reachable",
    reachable
      ? c.green("yes")
      : `${c.red("no")} ${c.dim("— run 'chi doctor provider'")}`,
  );

  const envSet: Array<[string, string]> = [];
  for (const v of [
    "CHI_LLM_URL",
    "CHI_LLM_MODEL",
    "BASIC_AUTH_USER",
    "CHI_MAX_DIFF_CHARS",
  ]) {
    const val = process.env[v];
    if (val) envSet.push([v, val]);
  }
  if (envSet.length > 0) {
    const f = envSet[0]!;
    kv("env", `${f[0]}=${f[1]}`);
    for (let i = 1; i < envSet.length; i++) {
      const [k, val] = envSet[i]!;
      process.stdout.write(`  ${" ".padEnd(18)} ${k}=${val}\n`);
    }
  }

  // ---- git ----------------------------------------------------------------
  if (!isInsideRepo()) {
    return globalStatus(short);
  }

  const root = repoRoot();
  const branch = currentBranch();
  const upstream = upstreamRef();
  const counts = porcelain();
  const dirty = counts.total === 0 ? c.green("clean") : c.yellow("dirty");

  section("git");
  kv("repo", basename(root));
  kv("branch", c.cyan(branch));
  if (upstream) {
    const ab = aheadBehind();
    kv(
      "upstream",
      `${upstream}  ${c.dim("↑")}${ab.ahead} ${c.dim("↓")}${ab.behind}`,
    );
  }
  kv("state", dirty);
  if (counts.total > 0) {
    kv(
      "changes",
      `${counts.staged} staged · ${counts.unstaged} unstaged · ${counts.untracked} untracked`,
    );
  }

  if (counts.total > 0 && !short) {
    line();
    process.stdout.write(shortStatus());
  }

  // ---- submodules ---------------------------------------------------------
  if (!short && existsSync(join(root, ".gitmodules"))) {
    section("submodules");
    const sm = submoduleStatusRecursive(root);
    if (!sm.trim()) {
      process.stdout.write(`  ${c.dim("(none initialized)")}\n`);
    } else {
      for (const ln of sm.split(/\r?\n/)) {
        if (!ln) continue;
        const flag = ln.charAt(0);
        const rest = ln.slice(1);
        switch (flag) {
          case " ":
            process.stdout.write(`  ${c.green("✓")} ${rest}\n`);
            break;
          case "+":
            process.stdout.write(`  ${c.yellow("±")} ${rest} ${c.dim("(out of sync)")}\n`);
            break;
          case "-":
            process.stdout.write(`  ${c.red("−")} ${rest} ${c.dim("(not initialized)")}\n`);
            break;
          case "U":
            process.stdout.write(`  ${c.red("!")} ${rest} ${c.dim("(merge conflict)")}\n`);
            break;
          default:
            process.stdout.write(`  ${ln}\n`);
        }
      }
    }
  }

  // ---- recent commits -----------------------------------------------------
  if (!short) {
    section("recent commits");
    process.stdout.write(recentCommits(5));
    line();
  }

  // ---- GitHub: issues + pull requests -------------------------------------
  if (!short && commandExists("gh") && execSync("gh", ["auth", "status"]).ok) {
    const ghTimeout = Number.parseInt(process.env.CHI_GH_TIMEOUT ?? "3", 10) || 3;
    const [issues, prs] = await Promise.all([
      fetchGhIssues(ghTimeout),
      fetchGhPrs(ghTimeout),
    ]);

    section("issues");
    if (issues && issues.length > 0) {
      for (const row of issues) {
        const fm = row.body
          ? parseFrontmatter(row.body)
          : { name: "", status: "", progress: "" };
        const meta: string[] = [];
        if (fm.progress) meta.push(c.dim(`(${fm.progress})`));
        if (row.labels) meta.push(c.dim(`[${row.labels}]`));
        if (row.assignees) meta.push(c.dim(`@${row.assignees}`));
        process.stdout.write(
          `  ${c.cyan(`#${row.num}`)} ${statusBadge(fm.status).padEnd(11)} ${row.title}${
            meta.length ? ` ${meta.join(" ")}` : ""
          }\n`,
        );
      }
    } else {
      process.stdout.write(`  ${c.dim("(none open)")}\n`);
    }

    section("pull requests");
    if (prs && prs.length > 0) {
      for (const row of prs) {
        const tag = prStateTag(row);
        process.stdout.write(
          `  ${c.cyan(`#${row.num}`)} ${tag.padEnd(9)} ${row.title} ${c.dim(`(${row.head} by @${row.author})`)}\n`,
        );
      }
    } else {
      process.stdout.write(`  ${c.dim("(none open)")}\n`);
    }
  }

  // ---- plans --------------------------------------------------------------
  if (!short) {
    const plansDir = join(root, ".chi", "plans");
    const altDir = join(root, ".che", "plans");
    let dirToUse = "";
    if (existsSync(plansDir) && statSync(plansDir).isDirectory()) dirToUse = plansDir;
    else if (existsSync(altDir) && statSync(altDir).isDirectory()) dirToUse = altDir;

    if (dirToUse) {
      const entries = readdirSync(dirToUse).filter((e) => e.endsWith(".md") && e !== "README.md");
      if (entries.length > 0) {
        section("plans");
        for (const entry of entries) {
          const file = join(dirToUse, entry);
          const fm = parseFrontmatterFile(file);
          const stem = entry.replace(/\.md$/, "");
          const name = fm.name || stem;
          const badge = statusBadge(fm.status);
          const extra = fm.progress ? ` ${c.dim(`(${fm.progress})`)}` : "";
          process.stdout.write(
            `  ${badge.padEnd(11)} ${name}${extra} ${c.dim(`(${entry})`)}\n`,
          );
        }
      } else if (process.env.CHI_STATUS_SHOW_EMPTY === "1") {
        section("plans");
        process.stdout.write(`  ${c.dim(`(no plans in ${dirToUse})`)}\n`);
      }
    }
  }

  line();
  return 0;
}
