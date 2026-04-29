import type { Provider } from "./types.js";
import { commandExists, execAsync } from "../spawn.js";

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

  async generate(prompt: string): Promise<string> {
    if (!commandExists("copilot")) {
      throw new Error("copilot CLI not on PATH");
    }
    const r = await execAsync("copilot", ["-p", "--allow-all-tools"], { input: prompt });
    if (!r.ok) {
      throw new Error(r.stderr.trim() || `copilot exited with status ${r.status}`);
    }
    return r.stdout;
  },
};
