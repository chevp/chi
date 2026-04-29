import { loadPersistedConfig } from "./config.js";
import * as helpCmd from "./commands/help.js";
import * as statusCmd from "./commands/status.js";
import { stubCommand } from "./commands/stub.js";

type CommandRunner = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, CommandRunner> = {
  status: statusCmd.run,
  help: helpCmd.run,
  "-h": helpCmd.run,
  "--help": helpCmd.run,

  // Stubs — implemented in subsequent phases.
  commit: stubCommand("commit"),
  ship: stubCommand("ship"),
  flow: stubCommand("flow"),
  done: stubCommand("done"),
  issue: stubCommand("issue"),
  explain: stubCommand("explain"),
  init: stubCommand("init"),
  run: stubCommand("run"),
  workflow: stubCommand("workflow"),
  reinstall: stubCommand("reinstall"),
  config: stubCommand("config"),
  doctor: stubCommand("doctor"),
};

async function main(): Promise<number> {
  loadPersistedConfig();

  const [, , cmd = "help", ...rest] = process.argv;
  const runner = COMMANDS[cmd];

  if (!runner) {
    process.stderr.write(`chi: unknown command '${cmd}'\n`);
    await helpCmd.run([]);
    return 1;
  }

  try {
    return await runner(rest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`chi ${cmd}: ${msg}\n`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`chi: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
