import { curaProvider } from "./cura.js";
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
export function activeProviderName() {
    return "cura";
}
export function getProvider(_name = "cura") {
    return curaProvider;
}
/**
 * Pings the cura endpoint. Cura is a hosted Ollama on Cloud Run, so there
 * is nothing to start locally — we just probe reachability.
 */
export async function providerEnsureRunning() {
    return curaProvider.ping();
}
export async function providerSmartGenerate(prompt, _opts = {}) {
    const sem = providerSemaphore();
    await sem.acquire();
    try {
        return await curaProvider.generate(prompt);
    }
    finally {
        sem.release();
    }
}
//# sourceMappingURL=index.js.map