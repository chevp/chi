const DEFAULT_URL = "http://localhost:11434";
const URL_BASE = () => (process.env.CHI_OLLAMA_URL ?? DEFAULT_URL).replace(/\/+$/, "");
let cachedModel = null;
async function fetchWithTimeout(url, init = {}) {
    const { timeoutMs = 1500, ...rest } = init;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        return await fetch(url, { ...rest, signal: ac.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function listModels(timeoutMs = 1500) {
    const r = await fetchWithTimeout(`${URL_BASE()}/api/tags`, { timeoutMs });
    if (!r.ok)
        return [];
    const data = (await r.json());
    return (data.models ?? []).map((m) => m.name ?? "").filter((n) => n.length > 0);
}
export const ollamaProvider = {
    name: "ollama",
    activeModel() {
        return cachedModel ?? "(detecting)";
    },
    async ping() {
        try {
            const models = await listModels();
            if (models.length === 0)
                return false;
            cachedModel = models[0] ?? null;
            return cachedModel !== null;
        }
        catch {
            return false;
        }
    },
    async hasModel(model) {
        try {
            const models = await listModels();
            if (model === undefined)
                return models.length > 0;
            return models.some((n) => n.startsWith(model));
        }
        catch {
            return false;
        }
    },
    async generate(prompt) {
        if (!cachedModel) {
            const models = await listModels(5000);
            if (models.length === 0) {
                throw new Error("ollama: no models available at /api/tags");
            }
            cachedModel = models[0] ?? null;
        }
        const r = await fetch(`${URL_BASE()}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: cachedModel, prompt, stream: false }),
        });
        if (!r.ok) {
            const body = await r.text().catch(() => "");
            throw new Error(`ollama generate failed: HTTP ${r.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
        }
        const data = (await r.json());
        return data.response ?? "";
    },
};
//# sourceMappingURL=ollama.js.map