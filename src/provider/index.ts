import type { Provider, ProviderName } from "./types.js";
import { ollamaProvider } from "./ollama.js";
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

export type { Provider, ProviderName };
