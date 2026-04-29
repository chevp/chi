import {
  spawn,
  spawnSync,
  type SpawnOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type StdioOptions,
} from "node:child_process";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  /** When true, capture stderr separately. When false, merge into stdout. */
  separateStderr?: boolean;
}

export function execSync(cmd: string, args: string[], opts: ExecOptions = {}): ExecResult {
  const o: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    timeout: opts.timeoutMs,
    windowsHide: true,
  };
  const r = spawnSync(cmd, args, o);
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").toString(),
    stderr: (r.stderr ?? "").toString(),
    status: r.status,
  };
}

export interface ExecAsyncOptions extends ExecOptions {
  /** Inherit stdio (interactive). */
  inherit?: boolean;
}

/**
 * Async spawn with optional stdin input. Resolves with captured stdout/stderr
 * unless `inherit` is true, in which case both streams pipe to the parent.
 */
export function execAsync(
  cmd: string,
  args: string[],
  opts: ExecAsyncOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const stdio: StdioOptions = opts.inherit
      ? "inherit"
      : ["pipe", "pipe", "pipe"];
    const o: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio,
    };
    const child = spawn(cmd, args, o);

    let stdout = "";
    let stderr = "";
    if (!opts.inherit) {
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      if (opts.input !== undefined) {
        child.stdin?.write(opts.input);
        child.stdin?.end();
      } else {
        child.stdin?.end();
      }
    }

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }, opts.timeoutMs);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr || String(err), status: null });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, status: code });
    });
  });
}

/** True if the named binary is on PATH. */
export function commandExists(bin: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [bin], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

/** Inherit-stdio spawn that resolves with the exit code. Used when chi
 *  shells out to interactive tools (git commit -e, $EDITOR). */
export function execInherit(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
