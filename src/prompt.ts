import { createInterface } from "node:readline";

/**
 * Read a single line from stdin. Returns null when there is no TTY (so callers
 * can treat the answer as the default in non-interactive contexts).
 *
 * Uses readline so terminal echo and line editing work on every platform
 * (Windows console included).
 */
export function readLine(question: string): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** [Y/n] confirmation. Default: yes. Returns true on accept. */
export async function confirmYesNo(question: string): Promise<boolean> {
  const ans = await readLine(question);
  if (ans === null) return true;
  const v = ans.trim().toLowerCase();
  return v !== "n" && v !== "no";
}
