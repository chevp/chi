/**
 * Phase-1 stub for commands not yet ported. Each known che command names itself
 * here so that `chi <cmd>` returns a clear "coming soon" instead of "unknown
 * command" — and so the dispatcher's command list is exhaustive from day one.
 */
export function stubCommand(name: string) {
  return async (_argv: string[]): Promise<number> => {
    process.stderr.write(
      `chi ${name}: not yet ported (Phase 2). See README.md for porting status.\n`,
    );
    return 2;
  };
}
