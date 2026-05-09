import type { Provider, ProviderName } from "./types.js";
import { curaProvider } from "./cura.js";

class Semaphore {
  private slots: number;
  private waiters: Array<() => void> = [];
  constructor(n: number) {
    this.slots = n;
  }
  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const w = this.waiters.shift();
    if (w) w();
    else this.slots += 1;
  }
}

let providerSem: Semaphore | null = null;
function providerSemaphore(): Semaphore {
  if (providerSem) return providerSem;
  const raw = process.env.CHI_PROVIDER_PARALLEL ?? "1";
  const n = Number.parseInt(raw, 10);
  const slots = Number.isFinite(n) && n > 0 ? n : 1;
  providerSem = new Semaphore(slots);
  return providerSem;
}

export function activeProviderName(): ProviderName {
  return "cura";
}

export function getProvider(_name: ProviderName = "cura"): Provider {
  return curaProvider;
}

/**
 * Pings the cura endpoint. Cura is a hosted Ollama on Cloud Run, so there
 * is nothing to start locally — we just probe reachability.
 */
export async function providerEnsureRunning(): Promise<boolean> {
  return curaProvider.ping();
}

export interface SmartGenerateOptions {
  /**
   * Marks the request as complex. Retained for API compatibility; ignored
   * in cura-only mode (single small model handles everything).
   */
  complex?: boolean;
}

export async function providerSmartGenerate(
  prompt: string,
  _opts: SmartGenerateOptions = {},
): Promise<string> {
  const sem = providerSemaphore();
  await sem.acquire();
  try {
    return await curaProvider.generate(prompt);
  } finally {
    sem.release();
  }
}

export type { Provider, ProviderName };
