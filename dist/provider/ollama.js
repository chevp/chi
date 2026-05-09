import { commandExists, execAsync } from "../spawn.js";
const HOST = () => process.env.CHI_OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = () => process.env.CHI_OLLAMA_MODEL ?? "llama3.2";
async function fetchWithTimeout(url, init = {}) {
    const { timeoutMs = 2000, ...rest } = init;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        return await fetch(url, { ...rest, signal: ac.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * If the server is already responding, returns true immediately. Otherwise
 * spawns `ollama serve` in the background and waits up to `timeoutSec`.
 */
export async function startOllamaServer(timeoutSec = 10) {
    if (await ollamaProvider.ping())
        return true;
    if (!commandExists("ollama"))
        return false;
    const detached = process.platform !== "win32";
    // Fire-and-forget. We do not await — we poll for readiness below.
    void execAsync("ollama", ["serve"], { ...(detached ? { env: process.env } : {}) });
    for (let i = 0; i < timeoutSec; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await ollamaProvider.ping())
            return true;
    }
    return false;
}
export const ollamaProvider = {
    name: "ollama",
    activeModel() {
        return MODEL();
    },
    async ping() {
        try {
            const r = await fetchWithTimeout(`${HOST()}/api/tags`, { timeoutMs: 2000 });
            return r.ok;
        }
        catch {
            return false;
        }
    },
    async hasModel(model = MODEL()) {
        try {
            const r = await fetchWithTimeout(`${HOST()}/api/tags`, { timeoutMs: 2000 });
            if (!r.ok)
                return false;
            const data = (await r.json());
            const list = data.models ?? [];
            return list.some((m) => (m.name ?? "").startsWith(model));
        }
        catch {
            return false;
        }
    },
    async generate(prompt) {
        const payload = JSON.stringify({ model: MODEL(), prompt, stream: false });
        const r = await fetch(`${HOST()}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });
        if (!r.ok) {
            throw new Error(`ollama generate failed: HTTP ${r.status}`);
        }
        const data = (await r.json());
        return data.response ?? "";
    },
};
//# sourceMappingURL=ollama.js.map