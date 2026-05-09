import { curaProvider } from "./cura.js";
import { ollamaProvider } from "./ollama.js";
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
let selected = null;
let detection = null;
/**
 * Picks the first reachable provider in priority order: local ollama → cura.
 * Cached for the lifetime of the process; concurrent callers share the same
 * in-flight detection promise.
 */
async function detect() {
    if (selected)
        return selected;
    if (detection)
        return detection;
    detection = (async () => {
        if (await ollamaProvider.ping()) {
            selected = ollamaProvider;
        }
        else {
            selected = curaProvider;
        }
        return selected;
    })();
    return detection;
}
export function activeProviderName() {
    return selected?.name ?? "cura";
}
export function getProvider(name) {
    if (name === "ollama")
        return ollamaProvider;
    if (name === "cura")
        return curaProvider;
    return selected ?? curaProvider;
}
/**
 * Selects the active provider (local ollama if reachable, otherwise cura)
 * and pings it. The selection is cached for the rest of the process.
 */
export async function providerEnsureRunning() {
    const p = await detect();
    return p.ping();
}
export async function providerSmartGenerate(prompt, _opts = {}) {
    const p = await detect();
    const sem = providerSemaphore();
    await sem.acquire();
    try {
        return await p.generate(prompt);
    }
    finally {
        sem.release();
    }
}
//# sourceMappingURL=index.js.map