import { c } from "../ui.js";
import { curaProvider } from "../provider/cura.js";
const HELP = `chi init — verify the cura LLM endpoint is reachable.

Usage: chi init [options]

What it does:
  1. checks BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set
  2. pings the cura endpoint
  3. confirms the configured model is available

Options:
  -h, --help    show this help

Environment (required):
  BASIC_AUTH_USER       basic-auth username for the cura endpoint
  BASIC_AUTH_PASSWORD   basic-auth password for the cura endpoint

Environment (optional):
  CHI_LLM_URL    override the default cura URL
  CHI_LLM_MODEL  override the default model (default: smollm2:135m)
`;
function ok(msg) {
    process.stdout.write(`  ${c.green("✓")} ${msg}\n`);
}
function fail(msg) {
    process.stdout.write(`  ${c.red("✗")} ${msg}\n`);
}
function info(msg) {
    process.stdout.write(`    ${c.dim(msg)}\n`);
}
export async function run(argv) {
    if (argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP);
        return 0;
    }
    const url = process.env.CHI_LLM_URL ?? "https://cura-llm-3j2fyuwcdq-oa.a.run.app";
    const model = curaProvider.activeModel();
    process.stdout.write(`chi init — cura (model: ${model})\n\n`);
    if (!process.env.BASIC_AUTH_USER || !process.env.BASIC_AUTH_PASSWORD) {
        fail("BASIC_AUTH_USER and BASIC_AUTH_PASSWORD must be set");
        info("export BASIC_AUTH_USER=<user>");
        info("export BASIC_AUTH_PASSWORD=<password>");
        info("or persist them in ~/.chi/config (basic_auth_user / basic_auth_password)");
        return 1;
    }
    ok("basic auth credentials present");
    if (await curaProvider.ping()) {
        ok(`endpoint reachable at ${url}`);
    }
    else {
        fail(`endpoint not reachable at ${url}`);
        info("check network and credentials, then re-run 'chi init'");
        return 1;
    }
    if (await curaProvider.hasModel(model)) {
        ok(`model available: ${model}`);
    }
    else {
        fail(`model not available: ${model}`);
        info(`set CHI_LLM_MODEL to one offered by ${url}/api/tags`);
        return 1;
    }
    process.stdout.write("\nready. try: chi doctor\n");
    return 0;
}
//# sourceMappingURL=init.js.map