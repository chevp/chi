import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { getPath, lengthOf, parseYaml, type YamlValue } from "../yaml.js";

export interface ResolvedWorkflow {
  /** Folder containing .che/ */
  root: string;
  /** Path to .che/workflows */
  dir: string;
  /** Absolute path to the matched yml/yaml file */
  file: string;
  /** Parsed document */
  doc: YamlValue;
}

export class WorkflowError extends Error {}

/** Walk up from `cwd` looking for `.che/workflows`. Returns null if not found. */
export function findWorkflowsDir(cwd: string = process.cwd()): { root: string; dir: string } | null {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, ".che", "workflows");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return { root: dir, dir: candidate };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadFile(file: string): YamlValue {
  return parseYaml(readFileSync(file, "utf8"));
}

/** Resolve <name> to a workflow yml/yaml file, parsed and validated. */
export function resolveWorkflow(name: string, cwd: string = process.cwd()): ResolvedWorkflow {
  if (!name) throw new WorkflowError("missing workflow name");
  const where = findWorkflowsDir(cwd);
  if (!where) throw new WorkflowError(`no .che/workflows/ found above ${cwd}`);
  for (const ext of ["yml", "yaml"]) {
    const file = join(where.dir, `${name}.${ext}`);
    if (existsSync(file)) {
      const doc = loadFile(file);
      return { root: where.root, dir: where.dir, file, doc };
    }
  }
  throw new WorkflowError(`workflow not found: ${name} (looked in ${where.dir})`);
}

/** Validate the top-level shape: name + non-empty steps with `script:` each. */
export function validate(doc: YamlValue, file: string): void {
  const name = getPath(doc, ".name");
  if (typeof name !== "string" || name.length === 0) {
    throw new WorkflowError(`${file}: missing 'name'`);
  }
  const steps = getPath(doc, ".steps");
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new WorkflowError(`${file}: 'steps' must be a non-empty list`);
  }
  for (let i = 0; i < steps.length; i++) {
    const script = getPath(doc, `.steps[${i}].script`);
    if (typeof script !== "string" || script.length === 0) {
      throw new WorkflowError(
        `${file}: steps[${i}] is missing 'script' (no inline bash allowed)`,
      );
    }
  }
}

export interface WorkflowInputs {
  set: (k: string, v: string) => void;
  get: (k: string) => string | undefined;
  has: (k: string) => boolean;
  substitute: (s: string) => string;
}

export function createInputs(): WorkflowInputs {
  const map = new Map<string, string>();
  return {
    set(k, v) {
      map.set(k, v);
    },
    get(k) {
      return map.get(k);
    },
    has(k) {
      return map.has(k);
    },
    substitute(s) {
      let out = s;
      for (const [k, v] of map) {
        out = out.split(`\${${k}}`).join(v);
      }
      return out;
    },
  };
}

export interface InputDecl {
  name: string;
  required: boolean;
  description: string;
}

export function inputDecls(doc: YamlValue): InputDecl[] {
  const list = getPath(doc, ".inputs");
  if (!Array.isArray(list)) return [];
  const out: InputDecl[] = [];
  for (let i = 0; i < list.length; i++) {
    const name = getPath(doc, `.inputs[${i}].name`);
    if (typeof name !== "string" || !name) continue;
    const req = getPath(doc, `.inputs[${i}].required`);
    const desc = getPath(doc, `.inputs[${i}].description`);
    out.push({
      name,
      required: req === true || req === "true",
      description: typeof desc === "string" ? desc : "",
    });
  }
  return out;
}

export interface StepPlan {
  name: string;
  script: string;
  args: string[];
}

export function planSteps(doc: YamlValue, inputs: WorkflowInputs): StepPlan[] {
  const steps = getPath(doc, ".steps");
  if (!Array.isArray(steps)) return [];
  const out: StepPlan[] = [];
  for (let i = 0; i < steps.length; i++) {
    const rawName = getPath(doc, `.steps[${i}].name`);
    const rawScript = getPath(doc, `.steps[${i}].script`);
    const argsLen = lengthOf(getPath(doc, `.steps[${i}].args`));
    const args: string[] = [];
    for (let j = 0; j < argsLen; j++) {
      const v = getPath(doc, `.steps[${i}].args[${j}]`);
      args.push(inputs.substitute(stringify(v)));
    }
    const name = typeof rawName === "string" && rawName ? rawName : `step ${i + 1}`;
    const script = typeof rawScript === "string" ? inputs.substitute(rawScript) : "";
    out.push({ name, script, args });
  }
  return out;
}

function stringify(v: YamlValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/**
 * Look up a workflow by its declared `trigger:` (string or list-of-strings).
 * Returns a single-match resolved workflow if exactly one matches.
 *  - {match} on unique match
 *  - {none}  on no match
 *  - {ambiguous} when more than one workflow declares the same trigger
 */
export type TriggerLookup =
  | { kind: "match"; resolved: ResolvedWorkflow; stem: string }
  | { kind: "none" }
  | { kind: "ambiguous"; files: string[] };

export function resolveTrigger(trigger: string, cwd: string = process.cwd()): TriggerLookup {
  if (!trigger) return { kind: "none" };
  const where = findWorkflowsDir(cwd);
  if (!where) return { kind: "none" };
  const matches: Array<{ file: string; doc: YamlValue }> = [];
  for (const entry of readdirSync(where.dir)) {
    if (!/\.(ya?ml)$/.test(entry)) continue;
    const file = join(where.dir, entry);
    let doc: YamlValue;
    try {
      doc = loadFile(file);
    } catch {
      continue;
    }
    const t = getPath(doc, ".trigger");
    if (Array.isArray(t)) {
      if (t.some((v) => v === trigger)) matches.push({ file, doc });
    } else if (typeof t === "string") {
      if (t === trigger) matches.push({ file, doc });
    }
  }
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous", files: matches.map((m) => m.file) };
  const m = matches[0]!;
  const stem = parse(m.file).name;
  return {
    kind: "match",
    resolved: { root: where.root, dir: where.dir, file: m.file, doc: m.doc },
    stem,
  };
}
