export type ProviderName = "ollama" | "claude-code" | "copilot";

export interface Provider {
  readonly name: ProviderName;
  /** Display label for the active model (e.g. "llama3.2", "claude-code (CLI-managed)"). */
  activeModel(): string;
  /** True if the provider is reachable right now. Should be cheap and silent. */
  ping(): Promise<boolean>;
  /** True if the named model is available. */
  hasModel(model?: string): Promise<boolean>;
  /** Generate text from a prompt. Throws on transport failure. */
  generate(prompt: string): Promise<string>;
}
