const TEXT = `chi — collection of small CLI utilities (Node.js port of che-cli)

Usage: chi <command> [args]

Commands:
  status              git status + chi-cli config (provider, model, env)
  help                show this message

  (not yet ported — coming in subsequent phases)
  commit              stage all + AI-generated commit message
  ship                add + commit + push, recursively into submodules
  flow <branch>       start a flow branch
  done                finish active flow
  issue [sub]         open / list / close GitHub issues
  explain [question]  ask the active LLM to diagnose the last failure
  init                provision local ollama
  run <name>          execute a workflow
  workflow <sub>      list / show / run workflows
  reinstall           re-run scripts/reinstall.sh
  config [key] [val]  view or change persistent settings
  doctor [target]     verify deps and providers

Run 'chi <command> --help' for command-specific options.
`;

export async function run(_argv: string[]): Promise<number> {
  process.stdout.write(TEXT);
  return 0;
}
