import type { Provider, ProviderName } from "./types.js";
import { ollamaProvider, startOllamaServer } from "./ollama.js";
import { claudeCodeProvider } from "./claude-code.js";
import { copilotProvider } from "./copilot.js";

const REGISTRY: Record<ProviderName, Provider> = {
  ollama: ollamaProvider,
  "claude-code": claudeCodeProvider,
  copilot: copilotProvider,
};

const VALID_NAMES: ReadonlyArray<ProviderName> = [
  "ollama",
  "claude-code",
  "copilot",
];

function isProviderName(s: string): s is ProviderName {
  return (VALID_NAMES as ReadonlyArray<string>).includes(s);
}

export function activeProviderName(): ProviderName {
  const env = process.env.CHI_PROVIDER ?? "claude-code";
  if (!isProviderName(env)) {
    throw new Error(
      `chi: unknown provider '${env}' (valid: ${VALID_NAMES.join(", ")})`,
    );
  }
  return env;
}

export function getProvider(name: ProviderName = activeProviderName()): Provider {
  return REGISTRY[name];
}

/**
 * Best-effort: ensure the active provider is reachable. For ollama, spawns
 * `ollama serve` in the background if needed. For CLI-wrapping providers
 * there's nothing to start. Returns true if reachable after the attempt.
 */
export async function providerEnsureRunning(): Promise<boolean> {
  const p = activeProviderName();
  if (p === "ollama") return startOllamaServer();
  return getProvider(p).ping();
}

export interface SmartGenerateOptions {
  /** Mark the request as complex — escalate to claude-code if available. */
  complex?: boolean;
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
export async function providerSmartGenerate(
  prompt: string,
  opts: SmartGenerateOptions = {},
): Promise<string> {
  const force = opts.complex || process.env.CHI_FORCE_CLAUDE_CODE === "1";

  if (force) {
    if (await claudeCodeProvider.ping()) {
      return claudeCodeProvider.generate(prompt);
    }
    process.stderr.write(
      `chi: claude CLI not available — falling back to '${activeProviderName()}'\n`,
    );
  }

  const active = getProvider();
  if (await active.ping()) {
    return active.generate(prompt);
  }

  if (active.name !== "claude-code" && (await claudeCodeProvider.ping())) {
    process.stderr.write(
      `chi: provider '${active.name}' unreachable — escalating to claude-code\n`,
    );
    return claudeCodeProvider.generate(prompt);
  }

  throw new Error(
    `chi: no LLM provider available (active='${active.name}', claude CLI missing)`,
  );
}

export type { Provider, ProviderName };
