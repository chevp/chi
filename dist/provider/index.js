import { ollamaProvider, startOllamaServer } from "./ollama.js";
import { claudeCodeProvider } from "./claude-code.js";
import { copilotProvider } from "./copilot.js";
// Semaphore for provider serialization (ADR-004 §4). Workspace-mode runs N
// parallel git workers, but provider calls must stay below the active
// account/runtime's effective concurrency to avoid 429s and GPU contention.
// Single-repo invocations take the uncontended fast path (one cheap promise).
class Semaphore {
    slots;
    waiters = [];
    constructor(n) {
        this.slots = n;
    }
    async acquire() {
        if (this.slots > 0) {
            this.slots -= 1;
            return;
        }
        await new Promise((resolve) => this.waiters.push(resolve));
    }
    release() {
        const w = this.waiters.shift();
        if (w)
            w();
        else
            this.slots += 1;
    }
}
let providerSem = null;
function providerSemaphore() {
    if (providerSem)
        return providerSem;
    const raw = process.env.CHI_PROVIDER_PARALLEL ?? "1";
    const n = Number.parseInt(raw, 10);
    const slots = Number.isFinite(n) && n > 0 ? n : 1;
    providerSem = new Semaphore(slots);
    return providerSem;
}
const REGISTRY = {
    ollama: ollamaProvider,
    "claude-code": claudeCodeProvider,
    copilot: copilotProvider,
};
const VALID_NAMES = [
    "ollama",
    "claude-code",
    "copilot",
];
function isProviderName(s) {
    return VALID_NAMES.includes(s);
}
export function activeProviderName() {
    const env = process.env.CHI_PROVIDER ?? "claude-code";
    if (!isProviderName(env)) {
        throw new Error(`chi: unknown provider '${env}' (valid: ${VALID_NAMES.join(", ")})`);
    }
    return env;
}
export function getProvider(name = activeProviderName()) {
    return REGISTRY[name];
}
/**
 * Best-effort: ensure the active provider is reachable. For ollama, spawns
 * `ollama serve` in the background if needed. For CLI-wrapping providers
 * there's nothing to start. Returns true if reachable after the attempt.
 */
export async function providerEnsureRunning() {
    const p = activeProviderName();
    if (p === "ollama")
        return startOllamaServer();
    return getProvider(p).ping();
}
/**
 * Routes simple tasks through the active provider (default: claude-code) and
 * escalates to the claude-code CLI when:
 *   - opts.complex is true,
 *   - CHI_FORCE_CLAUDE_CODE=1 is set, OR
 *   - the active provider is unreachable (auto-fallback).
 *
 * Falls through to the active provider if claude-code is requested but the
 * `claude` binary is missing, so a missing escalation target never breaks
 * the simple path.
 */
export async function providerSmartGenerate(prompt, opts = {}) {
    const sem = providerSemaphore();
    await sem.acquire();
    try {
        return await doSmartGenerate(prompt, opts);
    }
    finally {
        sem.release();
    }
}
async function doSmartGenerate(prompt, opts) {
    const force = opts.complex || process.env.CHI_FORCE_CLAUDE_CODE === "1";
    if (force) {
        if (await claudeCodeProvider.ping()) {
            return claudeCodeProvider.generate(prompt);
        }
        process.stderr.write(`chi: claude CLI not available — falling back to '${activeProviderName()}'\n`);
    }
    const active = getProvider();
    if (await active.ping()) {
        return active.generate(prompt);
    }
    if (active.name !== "claude-code" && (await claudeCodeProvider.ping())) {
        process.stderr.write(`chi: provider '${active.name}' unreachable — escalating to claude-code\n`);
        return claudeCodeProvider.generate(prompt);
    }
    throw new Error(`chi: no LLM provider available (active='${active.name}', claude CLI missing)`);
}
//# sourceMappingURL=index.js.map