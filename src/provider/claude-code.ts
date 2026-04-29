import { spawnSync } from "node:child_process";
import type { Provider } from "./types.js";

function commandExists(bin: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [bin], { stdio: "ignore" });
  return r.status === 0;
}

export const claudeCodeProvider: Provider = {
  name: "claude-code",

  activeModel() {
    return "claude-code (CLI-managed)";
  },

  async ping() {
    return commandExists("claude");
  },

  async hasModel() {
    // Claude Code manages its own model selection.
    return true;
  },

  async generate(_prompt: string): Promise<string> {
    throw new Error("claude-code provider: generate() not yet ported (Phase 2)");
  },
};
