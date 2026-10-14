import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { unreachable } from "./assert";
import { type Refusal, refusals } from "./coded-error";
import { copyAside } from "./file-backup";
import { ourMarker } from "./gate-marker";
import {
  GATE_NAMES,
  type GateName,
  isPart,
  type NoCommentsGate,
  noCommentsGate,
  type Part,
} from "./gate-parts";
import {
  eachFill,
  FILLS,
  type FileState,
  type Fill,
  type Fills,
  GATES,
  type GateFile,
  HOOKS_DIR,
  INSTALL_GATES,
  nameTheFill,
  PRE_COMMIT_STEPS,
  PRE_PUSH_STEPS,
  STEP_DIRS,
  WORKFLOWS_DIR,
  type WritableState,
} from "./gates-contract";
import { filledIn, fillTemplateOf, withFill } from "./gates-fill";
import { configValue, setConfig } from "./git";
import { trackedLanguages, trackedPerLanguage } from "./no-comments-tracked";
import { type PrepareState, prepareState } from "./package-manifest";

export const SOURCE_DIR = resolve(import.meta.dir, "..", "gates");

const gatesRefusal = refusals<{
  readonly no_gates_chosen: { readonly root: string };
  readonly no_language_tracked: { readonly root: string };
  readonly hooks_path_occupied: { readonly root: string; readonly hooksPath: string };
  readonly hook_occupied: { readonly root: string; readonly target: string };
  readonly write_failed: { readonly path: string; readonly detail: string };
  readonly fill_missing: { readonly root: string; readonly fill: Fill };
}>({
  no_gates_chosen: {
    message: ({ root }) =>
      `${root} has no gates installed and none were named, so there is nothing to install`,
    resolve: () => `stop and ask the owner which gates the project runs, then ${INSTALL_GATES}`,
  },
  no_language_tracked: {
    message: ({ root }) =>
      `${root} tracks no file a no-comments gate reads, so there is no language to install`,
    resolve: () => `stop and ask the owner which gates the project runs, then ${INSTALL_GATES}`,
  },
  hooks_path_occupied: {
    message: ({ root, hooksPath }) =>
      `${root} runs its git hooks from ${hooksPath}, so the gates in ${HOOKS_DIR} would never run`,
    resolve: ({ root }) =>
      `stop and hand this error to the owner: ${root}'s hooks must move to ${HOOKS_DIR} before the gates install`,
  },
  hook_occupied: {
    message: ({ root, target }) => `${root} has its own ${target}, which a gate would replace`,
    resolve: ({ root, target }) =>
      `stop and hand this error to the owner: ${root}'s ${target} must move out before the gates install; a step that runs before each commit belongs in ${PRE_COMMIT_STEPS}/<name>, one that runs before each push in ${PRE_PUSH_STEPS}/<name>, and commit-subject owns ${HOOKS_DIR}/commit-msg`,
  },
  write_failed: {
    message: ({ path, detail }) => `${path} could not be written: ${detail}`,
    resolve: ({ path }) => `stop and hand this error to the owner: ${path} must be writable`,
  },
  fill_missing: {
    message: ({ root, fill }) =>
      `${root}'s format gate runs the project's own ${FILLS[fill].check}, and none was given with ${FILLS[fill].flag}`,
    resolve: ({ fill }) => nameTheFill(fill),
  },
});

const EXECUTABLE_MODE = 0o755;

const FILE_MODE = 0o644;

type Marker = { readonly part: Part; readonly version: number };

type Found = { readonly text: string; readonly executable: boolean };

type Action = "skip" | "write" | "set-aside-and-write";

type PlannedAt = {
  readonly target: string;
  readonly file: GateFile;
  readonly path: string;
};

type WritableFile = PlannedAt & {
  readonly state: WritableState;
  readonly source: string;
  readonly filled: string | null;
};

export type PlannedFile =
  | WritableFile
  | (PlannedAt & { readonly state: "refused"; readonly refusal: Refusal });

export type StepsState = { readonly steps: readonly string[]; readonly unchecked: readonly string[] };

export type HooksPathState =
  | { readonly kind: "wired" }
  | { readonly kind: "unset" }
  | { readonly kind: "occupied"; readonly refusal: Refusal };

type InstalledFile = {
  readonly target: string;
  readonly state: WritableState;
  readonly backup: string | null;
};

type GatesInstalled = {
  readonly gates: readonly GateName[];
  readonly files: readonly InstalledFile[];
  readonly prepare: Exclude<PrepareState["kind"], "occupied" | "unparseable">;
  readonly fills: Fills;
};

const EXECUTE_BITS = 0o111;

function markerOf(text: string): Marker | null {
  const found = ourMarker(text);
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

function templateOf(file: GateFile, text: string): string {
  return file.fills === null ? text : fillTemplateOf(text, file.fills);
}

function stateOf(file: GateFile, template: string, source: string, found: Found | null): FileState {
  if (found === null) return "missing";
  if (found.text === source) return file.executable && !found.executable ? "not-executable" : "installed";
  const text = templateOf(file, found.text);
  if (file.fills !== null && text === template) return "reconfigured";
  const hash = sha256(text);
  if (file.versions.slice(0, -1).some((earlier) => earlier.sha256 === hash)) return "behind";
  const at = markerOf(found.text);
  if (at === null && file.executable) return "occupied";
  const current = markerOf(source);
  if (at !== null && current !== null && at.part === current.part && at.version > current.version)
    return "ahead";
  return "changed";
}

type Rendered =
  | { readonly kind: "rendered"; readonly source: string; readonly filled: string | null }
  | { readonly kind: "refused"; readonly refusal: Refusal };

function rendered(
  root: string,
  file: GateFile,
  template: string,
  given: Fills,
  found: Found | null,
): Rendered {
  if (file.fills === null) return { kind: "rendered", source: template, filled: null };
  const filled = given[file.fills] ?? (found === null ? null : filledIn(found.text, file.fills));
  if (filled !== null) return { kind: "rendered", source: withFill(template, file.fills, filled), filled };
  if (FILLS[file.fills].unset.kind === "required")
    return { kind: "refused", refusal: gatesRefusal("fill_missing", { root, fill: file.fills }) };
  return { kind: "rendered", source: template, filled: null };
}

function plannedFile(root: string, file: GateFile, given: Fills): PlannedFile {
  const path = join(root, file.target);
  const template = readFileSync(join(SOURCE_DIR, file.source), "utf8");
  const found = foundAt(path);
  const render = rendered(root, file, template, given, found);
  const at = { target: file.target, file, path };
  if (render.kind === "refused") return { ...at, state: "refused", refusal: render.refusal };
  const state = stateOf(file, template, render.source, found);
  if (state === "occupied")
    return { ...at, state: "refused", refusal: gatesRefusal("hook_occupied", { root, target: file.target }) };
  return { ...at, state, source: render.source, filled: render.filled };
}

function filledFor(planned: readonly PlannedFile[], fill: Fill): string | null {
  for (const file of planned) if (file.state !== "refused" && file.file.fills === fill) return file.filled;
  return null;
}

export function fillsOf(planned: readonly PlannedFile[]): Fills {
  return eachFill((fill) => filledFor(planned, fill));
}

export function plannedFiles(root: string, gates: readonly GateName[], given: Fills): PlannedFile[] {
  const files = new Map(gates.flatMap((gate) => GATES[gate]).map((file) => [file.target, file]));
  return [...files.values()].map((file) => plannedFile(root, file, given));
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
  return { kind: "occupied", refusal: gatesRefusal("hooks_path_occupied", { root, hooksPath }) };
}

function filesIn(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .map((name) => `${dir}/${name}`)
    .filter((path) => statSync(join(root, path)).isFile());
}

function isOwnStep(found: Found | null): boolean {
  return found?.executable === true && markerOf(found.text) === null;
}

function pathNamed(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w./-])`).test(text);
}

export function stepsState(root: string, planned: readonly PlannedFile[]): StepsState {
  const steps = STEP_DIRS.flatMap((dir) => filesIn(root, dir)).filter(
    (path) => !planned.some(({ target }) => target === path) && isOwnStep(foundAt(join(root, path))),
  );
  const workflows = filesIn(root, WORKFLOWS_DIR).map((path) => readFileSync(join(root, path), "utf8"));
  const unchecked = steps.filter((step) => !workflows.some((text) => pathNamed(text, step)));
  return { steps, unchecked };
}

function actionFor(state: WritableState): Action {
  switch (state) {
    case "installed":
    case "ahead":
      return "skip";
    case "missing":
    case "behind":
    case "not-executable":
    case "reconfigured":
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
    throw gatesRefusal("write_failed", { path, detail: String(error) });
  }
}

function applied(root: string, { file, path, source, state }: WritableFile): string | null {
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

export function trackedLanguageGates(root: string): NoCommentsGate[] {
  const languages = trackedLanguages(trackedPerLanguage(root));
  if (languages.length === 0) throw gatesRefusal("no_language_tracked", { root });
  return languages.map(noCommentsGate);
}

export function installGates(root: string, named: readonly GateName[], given: Fills): GatesInstalled {
  const installed = installedGates(root);
  const gates = GATE_NAMES.filter((gate) => named.includes(gate) || installed.includes(gate));
  if (gates.length === 0) throw gatesRefusal("no_gates_chosen", { root });
  const hooksPath = hooksPathState(root);
  if (hooksPath.kind === "occupied") throw hooksPath.refusal;
  const toWrite = plannedFiles(root, gates, given).map((planned) => {
    if (planned.state === "refused") throw planned.refusal;
    return planned;
  });
  const prepare = prepareState(root);
  if (prepare.kind === "occupied" || prepare.kind === "unparseable") throw prepare.refusal;
  const files = toWrite.map((planned) => ({
    target: planned.target,
    state: planned.state,
    backup: applied(root, planned),
  }));
  if (prepare.kind === "missing" || prepare.kind === "behind")
    writing(prepare.path, () => writeFileSync(prepare.path, prepare.wired));
  if (hooksPath.kind === "unset") setConfig(root, "core.hooksPath", HOOKS_DIR);
  return { gates, files, prepare: prepare.kind, fills: fillsOf(toWrite) };
}
