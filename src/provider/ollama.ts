import type { Provider } from "./types.js";

const HOST = (): string => process.env.CHI_OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = (): string => process.env.CHI_OLLAMA_MODEL ?? "llama3.2";

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 2000, ...rest } = init;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const ollamaProvider: Provider = {
  name: "ollama",

  activeModel() {
    return MODEL();
  },

  async ping() {
    try {
      const r = await fetchWithTimeout(`${HOST()}/api/tags`, { timeoutMs: 2000 });
      return r.ok;
    } catch {
      return false;
    }
  },

  async hasModel(model = MODEL()) {
    try {
      const r = await fetchWithTimeout(`${HOST()}/api/tags`, { timeoutMs: 2000 });
      if (!r.ok) return false;
      const data = (await r.json()) as { models?: Array<{ name?: string }> };
      const list = data.models ?? [];
      return list.some((m) => (m.name ?? "").startsWith(model));
    } catch {
      return false;
    }
  },

  async generate(_prompt: string): Promise<string> {
    throw new Error("ollama provider: generate() not yet ported (Phase 2)");
  },
};
