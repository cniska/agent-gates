import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { unreachable } from "./assert";
import type { CodedError } from "./coded-error";
import { copyAside } from "./file-backup";
import { firstMarkerLine } from "./gate-marker";
import {
  type FileState,
  GATE_NAMES,
  GATES,
  type GateFile,
  type GateName,
  HOOKS_DIR,
  isPart,
  type Part,
  PRE_COMMIT,
  refuseGates,
} from "./gates-contract";
import { configValue, setConfig } from "./git";
import { type PrepareState, prepareState } from "./package-manifest";

export const SOURCE_DIR = resolve(import.meta.dir, "..", "gates");

const EXECUTE_BITS = 0o111;

const EXECUTABLE_MODE = 0o755;

const FILE_MODE = 0o644;

type Marker = { readonly part: Part; readonly version: number };

type Found = { readonly text: string; readonly executable: boolean };

type Action = "skip" | "write" | "set-aside-and-write";

export type PlannedFile = {
  readonly target: string;
  readonly state: FileState;
  readonly file: GateFile;
  readonly path: string;
  readonly source: string;
};

export type PreCommitState =
  | { readonly kind: "free" }
  | { readonly kind: "occupied"; readonly refusal: CodedError };

export type HooksPathState =
  | { readonly kind: "wired" }
  | { readonly kind: "unset" }
  | { readonly kind: "occupied"; readonly refusal: CodedError };

type InstalledFile = {
  readonly target: string;
  readonly state: FileState;
  readonly backup: string | null;
};

type GatesInstalled = {
  readonly gates: readonly GateName[];
  readonly files: readonly InstalledFile[];
  readonly prepare: Exclude<PrepareState["kind"], "occupied" | "unparseable">;
};

export function markerOf(text: string): Marker | null {
  const found = firstMarkerLine(text);
  if (found === null || !isPart(found.part)) return null;
  return { part: found.part, version: found.version };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function foundAt(path: string): Found | null {
  if (!existsSync(path)) return null;
  return { text: readFileSync(path, "utf8"), executable: (statSync(path).mode & EXECUTE_BITS) !== 0 };
}

function stateOf(file: GateFile, source: string, found: Found | null): FileState {
  if (found === null) return "missing";
  if (found.text === source) return file.executable && !found.executable ? "not-executable" : "installed";
  const hash = sha256(found.text);
  if (file.versions.slice(0, -1).some((earlier) => earlier.sha256 === hash)) return "behind";
  const at = markerOf(found.text);
  const current = markerOf(source);
  if (at !== null && current !== null && at.part === current.part && at.version > current.version)
    return "ahead";
  return "changed";
}

export function plannedFiles(root: string, gates: readonly GateName[]): PlannedFile[] {
  const files = new Map(gates.flatMap((gate) => GATES[gate]).map((file) => [file.target, file]));
  return [...files.values()].map((file) => {
    const path = join(root, file.target);
    const source = readFileSync(join(SOURCE_DIR, file.source), "utf8");
    return { target: file.target, state: stateOf(file, source, foundAt(path)), file, path, source };
  });
}

export function installedGates(root: string): GateName[] {
  return GATE_NAMES.filter((gate) =>
    GATES[gate].some((file) => {
      const found = foundAt(join(root, file.target));
      return found !== null && markerOf(found.text)?.part === gate;
    }),
  );
}

export function hooksPathState(root: string): HooksPathState {
  const hooksPath = configValue(root, "core.hooksPath");
  if (hooksPath === null) return { kind: "unset" };
  if (resolve(root, hooksPath) === join(root, HOOKS_DIR)) return { kind: "wired" };
  return { kind: "occupied", refusal: refuseGates("hooks_path_occupied", { root, hooksPath }) };
}

export function preCommitState(root: string, gates: readonly GateName[]): PreCommitState {
  if (!gates.some((gate) => GATES[gate].includes(PRE_COMMIT))) return { kind: "free" };
  const found = foundAt(join(root, PRE_COMMIT.target));
  if (found === null || markerOf(found.text) !== null) return { kind: "free" };
  return { kind: "occupied", refusal: refuseGates("pre_commit_occupied", { root }) };
}

function actionFor(state: FileState): Action {
  switch (state) {
    case "installed":
    case "ahead":
      return "skip";
    case "missing":
    case "behind":
    case "not-executable":
      return "write";
    case "changed":
      return "set-aside-and-write";
    default:
      return unreachable(state);
  }
}

function writing<T>(path: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    throw refuseGates("write_failed", { path, detail: String(error) });
  }
}

function applied(root: string, { file, path, source, state }: PlannedFile): string | null {
  const action = actionFor(state);
  if (action === "skip") return null;
  const backup =
    action === "set-aside-and-write"
      ? relative(
          root,
          writing(path, () => copyAside(path)),
        )
      : null;
  writing(path, () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    chmodSync(path, file.executable ? EXECUTABLE_MODE : FILE_MODE);
  });
  return backup;
}

export function installGates(root: string, named: readonly GateName[]): GatesInstalled {
  const installed = installedGates(root);
  const gates = GATE_NAMES.filter((gate) => named.includes(gate) || installed.includes(gate));
  if (gates.length === 0) throw refuseGates("no_gates_chosen", { root });
  const hooksPath = hooksPathState(root);
  if (hooksPath.kind === "occupied") throw hooksPath.refusal;
  const preCommit = preCommitState(root, gates);
  if (preCommit.kind === "occupied") throw preCommit.refusal;
  const prepare = prepareState(root);
  if (prepare.kind === "occupied" || prepare.kind === "unparseable") throw prepare.refusal;
  const files = plannedFiles(root, gates).map((planned) => ({
    target: planned.target,
    state: planned.state,
    backup: applied(root, planned),
  }));
  if (prepare.kind === "missing" || prepare.kind === "behind")
    writing(prepare.path, () => writeFileSync(prepare.path, prepare.wired));
  if (hooksPath.kind === "unset") setConfig(root, "core.hooksPath", HOOKS_DIR);
  return { gates, files, prepare: prepare.kind };
}
