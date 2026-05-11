import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { BIN_NAME } from "../identity.js";

const STATIC_FILES: Record<string, { rel: string; type: string }> = {
  "/": { rel: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { rel: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { rel: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { rel: "app.js", type: "application/javascript; charset=utf-8" },
};

const TOOLS = new Set(["status", "doctor", "help", "config"]);

const CURA_DEFAULT_URL = "https://cura-llm-3j2fyuwcdq-oa.a.run.app";
const CURA_DEFAULT_MODEL = "smollm2:135m";

interface Args {
  host: string;
  port: number;
  open: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { host: "127.0.0.1", port: 7777, open: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--no-open") args.open = false;
    else if (a === "--host") args.host = argv[++i] ?? args.host;
    else if (a === "--port" || a === "-p") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) args.port = n;
    }
  }
  return args;
}

function helpText(): string {
  return `${BIN_NAME} serve — start a local web console (chat UI over the cura backend)

Usage: ${BIN_NAME} serve [--port <n>] [--host <h>] [--no-open]

Options:
  --port, -p <n>    port to listen on (default 7777)
  --host <h>        bind address (default 127.0.0.1)
  --no-open         do not open a browser
  --help, -h        show this message

Routes (same-origin):
  GET  /             → static console UI
  GET  /api/health   → { ok, provider, model, version }
  GET  /api/models   → { models: string[], active: string }
  POST /api/chat     → NDJSON stream from cura /api/chat
  POST /api/run      → run a chi tool (status | doctor | help | config)
`;
}

/** Resolve the static-assets directory, regardless of where chi runs from. */
function staticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const fallback = resolve(here, "..", "..", "context", "prototypes", "ux-console");
  const candidates = [
    fallback,
    resolve(here, "..", "..", "..", "context", "prototypes", "ux-console"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return fallback;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const MAX = 2 * 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX) {
        rejectBody(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function curaUrlBase(): string {
  return (process.env.CHI_LLM_URL ?? CURA_DEFAULT_URL).replace(/\/+$/, "");
}

function curaModel(): string {
  return process.env.CHI_LLM_MODEL ?? CURA_DEFAULT_MODEL;
}

function basicAuthHeader(): string | null {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return null;
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = basicAuthHeader();
  if (!auth) {
    sendJson(res, 200, {
      ok: false,
      provider: "cura",
      model: curaModel(),
      error: "BASIC_AUTH_USER / BASIC_AUTH_PASSWORD not set — run `chi init` first",
    });
    return;
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const r = await fetch(`${curaUrlBase()}/api/tags`, {
      headers: { Authorization: auth },
      signal: ac.signal,
    });
    clearTimeout(t);
    sendJson(res, 200, {
      ok: r.ok,
      provider: "cura",
      model: curaModel(),
    });
  } catch (e) {
    sendJson(res, 200, {
      ok: false,
      provider: "cura",
      model: curaModel(),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = basicAuthHeader();
  if (!auth) {
    sendJson(res, 200, { models: [curaModel()], active: curaModel() });
    return;
  }
  try {
    const r = await fetch(`${curaUrlBase()}/api/tags`, {
      headers: { Authorization: auth },
    });
    if (!r.ok) {
      sendJson(res, 502, { models: [], error: `cura HTTP ${r.status}` });
      return;
    }
    const data = (await r.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean).sort();
    sendJson(res, 200, { models, active: curaModel() });
  } catch (e) {
    sendJson(res, 502, { models: [], error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = basicAuthHeader();
  if (!auth) {
    sendJson(res, 412, { error: "BASIC_AUTH_USER / BASIC_AUTH_PASSWORD not set" });
    return;
  }
  let payload: { model?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean };
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  const model = payload.model || curaModel();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const stream = payload.stream !== false;

  let upstream: Response;
  try {
    upstream = await fetch(`${curaUrlBase()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ model, messages, stream }),
    });
  } catch (e) {
    sendJson(res, 502, { error: e instanceof Error ? e.message : String(e) });
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    sendJson(res, upstream.status, { error: `cura HTTP ${upstream.status}`, detail: text.slice(0, 500) });
    return;
  }

  res.writeHead(200, {
    "Content-Type": stream ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  req.on("close", () => {
    reader.cancel().catch(() => {});
  });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } catch {
    /* client disconnected */
  } finally {
    res.end();
  }
}

const runLock = { busy: false };

async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: { name?: string; args?: string[] };
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  const name = (payload.name ?? "").trim();
  if (!TOOLS.has(name)) {
    sendJson(res, 400, { error: `tool not allowed: ${name}` });
    return;
  }
  if (runLock.busy) {
    sendJson(res, 429, { error: "another tool is running" });
    return;
  }
  runLock.busy = true;

  const entry = fileURLToPath(new URL("../index.js", import.meta.url));
  const child = spawn(process.execPath, [entry, name, ...(payload.args ?? [])], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
  child.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
  child.on("close", (code) => {
    runLock.busy = false;
    sendJson(res, 200, { stdout, stderr, code: code ?? 0 });
  });
  child.on("error", (e) => {
    runLock.busy = false;
    sendJson(res, 500, { error: e.message });
  });
}

async function handleStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const url = req.url ?? "/";
  const key = url.split("?")[0] ?? "/";
  const entry = STATIC_FILES[key];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const path = normalize(join(root, entry.rel));
  if (!path.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`missing static asset: ${entry.rel}`);
  }
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "cmd" :
    "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  const root = staticRoot();
  if (!existsSync(join(root, "index.html"))) {
    process.stderr.write(
      `${BIN_NAME} serve: static assets not found at ${root}\n` +
        "Reinstall chi or check that context/prototypes/ux-console/ ships in the package.\n",
    );
    return 1;
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && url === "/api/health") return await handleHealth(req, res);
      if (method === "GET" && url === "/api/models") return await handleModels(req, res);
      if (method === "POST" && url === "/api/chat") return await handleChat(req, res);
      if (method === "POST" && url === "/api/run") return await handleRun(req, res);
      if (method === "GET") return await handleStatic(req, res, root);
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(msg);
      } else {
        res.end();
      }
    }
  });

  return await new Promise<number>((resolveExit) => {
    server.on("error", (err) => {
      process.stderr.write(`${BIN_NAME} serve: ${err.message}\n`);
      resolveExit(1);
    });
    server.listen(args.port, args.host, () => {
      const url = `http://${args.host}:${args.port}/`;
      process.stdout.write(`${BIN_NAME} console → ${url}\n`);
      process.stdout.write("press Ctrl+C to stop\n");
      if (args.open) openInBrowser(url);
    });

    const stop = (signal: NodeJS.Signals) => {
      process.stdout.write(`\n${BIN_NAME} serve: ${signal} received, shutting down\n`);
      server.close(() => resolveExit(0));
      setTimeout(() => resolveExit(0), 1500).unref();
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  });
}
