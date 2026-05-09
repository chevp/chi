import { c } from "../ui.js";
import { CHI_OS } from "../platform.js";
import { activeProviderName, getProvider, providerEnsureRunning, } from "../provider/index.js";
import { commandExists, execSync } from "../spawn.js";
import { curaProvider } from "../provider/cura.js";
import { ollamaProvider } from "../provider/ollama.js";
import { BIN_NAME } from "../identity.js";
const HELP = `${BIN_NAME} doctor — verify dependencies and external services.

Usage: ${BIN_NAME} doctor [target]

Targets:
  all          run all checks (default)
  git          git installation
  ollama       local ollama endpoint reachability + available models
  cura         cura LLM endpoint reachability + configured model
  workflow     prerequisites for ${BIN_NAME} workflow / ${BIN_NAME} run (none — built-in)
  provider     summary of the active provider (auto-selected: ollama → cura)
`;
function ok(msg) {
    process.stdout.write(`  ${msg}\n`);
}
function fail(msg) {
    process.stdout.write(`  ${c.red("error:")} ${msg}\n`);
}
function info(msg) {
    process.stdout.write(`  ${c.dim("hint:")} ${msg}\n`);
}
function gitInstallHint() {
    switch (CHI_OS) {
        case "darwin":
            info("install: brew install git");
            break;
        case "windows":
            info("install: https://git-scm.com/download/win");
            break;
        case "wsl":
        case "linux":
            info("install: sudo apt-get install git  (or your distro equivalent)");
            break;
        default:
            info("install: https://git-scm.com/downloads");
    }
}
function ghInstallHint() {
    switch (CHI_OS) {
        case "darwin":
            info("install: brew install gh");
            break;
        case "windows":
            info("install: winget install --id GitHub.cli");
            break;
        case "wsl":
        case "linux":
            info("install: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md");
            break;
        default:
            info("install: https://cli.github.com/");
    }
    info("docs:    https://cli.github.com/manual/");
}
function gitCheck() {
    let okAll = true;
    if (commandExists("git")) {
        const ver = execSync("git", ["--version"]).stdout.trim().split(/\s+/)[2] ?? "?";
        ok(`git ${ver}`);
    }
    else {
        fail("git not installed");
        gitInstallHint();
        okAll = false;
    }
    if (commandExists("gh")) {
        const ver = execSync("gh", ["--version"]).stdout.split(/\r?\n/)[0]?.split(/\s+/)[2] ?? "?";
        ok(`gh ${ver}  (required for chi flow / chi done)`);
        if (execSync("gh", ["auth", "status"]).ok) {
            ok("gh authenticated");
        }
        else {
            fail("gh not authenticated");
            info("run: gh auth login");
            okAll = false;
        }
    }
    else {
        fail("gh not installed  (required for chi flow / chi done)");
        ghInstallHint();
        okAll = false;
    }
    return okAll;
}
async function ollamaCheck() {
    const url = process.env.CHI_OLLAMA_URL ?? "http://localhost:11434";
    if (!(await ollamaProvider.ping())) {
        fail(`endpoint not reachable at ${url}`);
        info("start ollama with: ollama serve");
        info("or set CHI_OLLAMA_URL to point at a remote ollama");
        return false;
    }
    ok(`endpoint responding at ${url}`);
    const model = ollamaProvider.activeModel();
    if (model && model !== "(detecting)") {
        ok(`model selected: ${model}  (first entry from /api/tags)`);
    }
    else {
        fail("no models available — pull one with: ollama pull <model>");
        return false;
    }
    return true;
}
async function curaCheck() {
    let okAll = true;
    const url = process.env.CHI_LLM_URL ?? "https://cura-llm-3j2fyuwcdq-oa.a.run.app";
    if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD) {
        ok("basic-auth credentials present (BASIC_AUTH_USER / BASIC_AUTH_PASSWORD)");
    }
    else {
        fail("BASIC_AUTH_USER and BASIC_AUTH_PASSWORD must be set");
        info("export BASIC_AUTH_USER=<user>");
        info("export BASIC_AUTH_PASSWORD=<password>");
        info("or persist them in ~/.chi/config (basic_auth_user / basic_auth_password)");
        return false;
    }
    if (await curaProvider.ping()) {
        ok(`endpoint responding at ${url}`);
    }
    else {
        fail(`endpoint not reachable at ${url}`);
        info("check network and credentials");
        return false;
    }
    const model = curaProvider.activeModel();
    if (await curaProvider.hasModel(model)) {
        ok(`model available: ${model}`);
    }
    else {
        fail(`model not available: ${model}`);
        info(`see ${url}/api/tags for the model list, then set CHI_LLM_MODEL`);
        okAll = false;
    }
    return okAll;
}
function workflowCheck() {
    ok("workflow loader (built-in YAML parser, no extra deps)");
    return true;
}
async function runSection(name, fn) {
    process.stdout.write(`${name}:\n`);
    try {
        await fn();
    }
    catch (err) {
        fail(err instanceof Error ? err.message : String(err));
    }
}
export async function run(argv) {
    const target = argv[0] ?? "all";
    switch (target) {
        case "git":
            await runSection("git", gitCheck);
            return 0;
        case "ollama":
            await runSection("ollama", ollamaCheck);
            return 0;
        case "cura":
            await runSection("cura", curaCheck);
            return 0;
        case "provider": {
            await providerEnsureRunning().catch(() => false);
            process.stdout.write(`active provider: ${activeProviderName()} (model: ${getProvider().activeModel()})\n`);
            return 0;
        }
        case "workflow":
            await runSection("workflow", workflowCheck);
            return 0;
        case "-h":
        case "--help":
            process.stdout.write(HELP);
            return 0;
        case "all":
        case "":
        case undefined: {
            process.stdout.write(`platform: ${CHI_OS}\n`);
            await providerEnsureRunning().catch(() => false);
            process.stdout.write(`active provider: ${activeProviderName()} (model: ${getProvider().activeModel()})\n\n`);
            await runSection("git", gitCheck);
            await runSection("ollama", ollamaCheck);
            await runSection("cura", curaCheck);
            await runSection("workflow", workflowCheck);
            process.stdout.write("shell deps:\n");
            for (const bin of ["curl", "bash"]) {
                if (commandExists(bin))
                    ok(bin);
                else
                    fail(`${bin} missing`);
            }
            return 0;
        }
        default:
            process.stderr.write(`chi doctor: unknown target '${target}'\n`);
            process.stderr.write("valid: all, git, ollama, cura, workflow, provider\n");
            return 1;
    }
}
//# sourceMappingURL=doctor.js.map