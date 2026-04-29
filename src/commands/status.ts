import { basename } from "node:path";
import { CHI_OS } from "../platform.js";
import { c, kv, line, section } from "../ui.js";
import { activeProviderName, getProvider } from "../provider/index.js";
import {
  aheadBehind,
  currentBranch,
  isInsideRepo,
  porcelain,
  recentCommits,
  repoRoot,
  shortStatus,
  upstreamRef,
} from "../git/index.js";

const HELP = `chi status — overview of the current repo and chi-cli configuration.

Usage: chi status [options]

Options:
  -s, --short   only the one-line summary (no recent commits)
  -h, --help    show this help
`;

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
    "CHI_PROVIDER",
    "CHI_OLLAMA_HOST",
    "CHI_OLLAMA_MODEL",
    "CHI_MAX_DIFF_CHARS",
  ]) {
    const val = process.env[v];
    if (val) envSet.push([v, val]);
  }
  if (envSet.length > 0) {
    const first = envSet[0]!;
    kv("env", `${first[0]}=${first[1]}`);
    for (let i = 1; i < envSet.length; i++) {
      const [k, val] = envSet[i]!;
      process.stdout.write(`  ${" ".padEnd(18)} ${k}=${val}\n`);
    }
  }

  // ---- git ----------------------------------------------------------------
  if (!isInsideRepo()) {
    section("git");
    process.stdout.write(`  ${c.dim("(not a git repository)")}\n\n`);
    return 0;
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

  // ---- recent commits -----------------------------------------------------
  if (!short) {
    section("recent commits");
    process.stdout.write(recentCommits(5));
    line();
  }

  line();
  return 0;
}
