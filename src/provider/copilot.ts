import { spawnSync } from "node:child_process";
import type { Provider } from "./types.js";

function commandExists(bin: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [bin], { stdio: "ignore" });
  return r.status === 0;
}

export const copilotProvider: Provider = {
  name: "copilot",

  activeModel() {
    return "copilot (CLI-managed)";
  },

  async ping() {
    return commandExists("copilot");
  },

  async hasModel() {
    return true;
  },

  async generate(_prompt: string): Promise<string> {
    throw new Error("copilot provider: generate() not yet ported (Phase 2)");
  },
};
