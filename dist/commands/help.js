const TEXT = `chi — collection of small CLI utilities (Node.js port of che-cli)

Usage: chi <command> [args]

Commands:
  commit              stage all + AI-generated commit message (+ optional push)
  ship                add + commit + push, recursively into submodules
                      (init missing submodules, ff-pull on a branch);
                      in flow mode: push -u + open/update draft PR
  flow <branch>       start a flow branch (pull base, checkout new, mark repo)
  work <name>         create a parallel git worktree (chi/<name> branch);
                      'chi work list|rm|cd' manage existing worktrees
  done                finish active flow: gh pr merge --squash --auto, back to base
                      (in a worktree: removes the worktree after merge)
  issue [sub] [args]  open / list / close / fix GitHub issues (AI-drafted body);
                      'chi issue [text]' is shorthand for 'chi issue create [text]';
                      'chi issue fix <n> [hint]' cuts a fix branch + starts a
                      framework-driven Claude session (CTX → EXP → PRD)
  explain [question]  ask the active LLM to diagnose the last chi ship/commit failure
                      (read-only — prints a suggested command, never executes)
  init                provision local ollama (verify binary, start server, pull model)
  run <name>          execute a workflow from .che/workflows/<name>.yml
                      (alias for: chi workflow run <name>)
  workflow <sub>      list / show / run workflows from .che/workflows/
  <trigger> [args]    any workflow with 'trigger: <name>' in its YAML can be
                      run as 'chi <name>' — shadows the built-ins above
  update              update chi itself (workspace clone or global install)
  status              git status + chi-cli config (provider, model, env)
  config [key] [val]  view or change persistent settings (~/.chi/config);
                      e.g. 'chi config provider claude-code'
  doctor [target]     verify deps and providers (git, gh, docker, ollama,
                      claude-code, copilot, workflow)
  help                show this message

Run 'chi <command> --help' for command-specific options.
`;
export async function run(_argv) {
    process.stdout.write(TEXT);
    return 0;
}
//# sourceMappingURL=help.js.map