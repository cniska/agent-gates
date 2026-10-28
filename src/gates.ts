import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { invariant, unreachable } from "./assert";
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
  fillGate,
  fillTarget,
  GATES,
  type GateFile,
  HOOKS_DIR,
  INSTALL_GATES,
  nameTheFill,
  PRE_COMMIT_STEPS,
  PRE_PUSH_STEPS,
  STEP_DIRS,
  WORKFLOWS,
  WORKFLOWS_DIR,
  type Workflows,
  type WritableState,
} from "./gates-contract";
import { filledIn, fillTemplateOf, withFill } from "./gates-fill";
import { gateSources } from "./gates-sources" with { type: "macro" };
import { configValue, setConfig } from "./git";
import { KEEP_FILE, withInstallLines } from "./no-comments-keep";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";
import { trackedLanguages, trackedPerLanguage } from "./no-comments-tracked";
import { type PrepareState, prepareState } from "./package-manifest";

const SOURCES = gateSources();

const gatesRefusal = refusals<{
  readonly no_gates_chosen: { readonly root: string };
  readonly no_language_tracked: { readonly root: string };
  readonly hooks_path_occupied: { readonly root: string; readonly hooksPath: string };
  readonly hook_occupied: { readonly root: string; readonly target: string };
  readonly write_failed: { readonly path: string; readonly detail: string };
  readonly fill_missing: { readonly root: string; readonly fill: Fill };
  readonly fill_unreadable: {
    readonly target: string;
    readonly fill: Fill;
    readonly value: string;
    readonly form: string;
  };
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
      `${root}'s ${fillGate(fill)} gate runs the project's own ${FILLS[fill].check}, and none was given with ${FILLS[fill].flag}`,
    resolve: ({ fill }) => nameTheFill(fill),
  },
  fill_unreadable: {
    message: ({ target, fill, value, form }) =>
      `${target} records the ${FILLS[fill].check} as ${value}, which is not ${form}`,
    resolve: ({ fill }) => `${nameTheFill(fill)} rewrites it`,
  },
});

const EXECUTABLE_MODE = 0o755;

const FILE_MODE = 0o644;

type Marker = { readonly part: Part; readonly version: number };

type Found = { readonly text: string; readonly executable: boolean };

type PlannedAt = {
  readonly target: string;
  readonly file: GateFile;
  readonly path: string;
};

type WritableFile = PlannedAt & {
  readonly state: WritableState;
  readonly source: string;
};

export type ResolvedFill =
  | { readonly kind: "set"; readonly value: string }
  | { readonly kind: "unset" }
  | { readonly kind: "unreadable"; readonly refusal: Refusal };

export type ResolvedFills = Readonly<Record<Fill, ResolvedFill>>;

type UnwantedFile = PlannedAt & { readonly state: "unwanted"; readonly released: boolean };

export type PlannedFile =
  | WritableFile
  | UnwantedFile
  | (PlannedAt & { readonly state: "refused"; readonly refusal: Refusal });

type CountedState = WritableState | "unwanted";

export type StepsState = { readonly steps: readonly string[]; readonly unchecked: readonly string[] };

export type HooksPathState =
  | { readonly kind: "wired" }
  | { readonly kind: "unset" }
  | { readonly kind: "occupied"; readonly refusal: Refusal };

export type InstalledFile =
  | { readonly target: string; readonly state: Exclude<WritableState, "changed"> }
  | { readonly target: string; readonly state: "changed"; readonly backup: string }
  | { readonly target: string; readonly state: "unwanted"; readonly backup: string | null };

type FileCounts = { readonly [State in CountedState]: number };

type GatesInstalled = {
  readonly counts: FileCounts;
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
  | { readonly kind: "rendered"; readonly source: string }
  | { readonly kind: "refused"; readonly refusal: Refusal };

function recordedFill(root: string, fill: Fill): ResolvedFill {
  const target = fillTarget(fill);
  const found = foundAt(join(root, target));
  const value = found === null ? null : filledIn(found.text, fill);
  if (value === null) return { kind: "unset" };
  const { pattern } = FILLS[fill];
  if (pattern === null || pattern.matches.test(value)) return { kind: "set", value };
  const meta = { target, fill, value, form: pattern.form };
  return { kind: "unreadable", refusal: gatesRefusal("fill_unreadable", meta) };
}

export function resolvedFills(root: string, given: Fills): ResolvedFills {
  return eachFill((fill): ResolvedFill => {
    const value = given[fill];
    return value === null ? recordedFill(root, fill) : { kind: "set", value };
  });
}

function workflowsOf(value: string): Workflows {
  const choice = WORKFLOWS.find((known) => known === value);
  invariant(choice !== undefined, `the workflows fill holds ${value}, which its pattern refuses`);
  return choice;
}

export function workflowsChosen(resolved: ResolvedFills): Workflows {
  const fill = resolved.workflows;
  return fill.kind === "set" ? workflowsOf(fill.value) : "on";
}

function fillValues(resolved: ResolvedFills): Fills {
  return eachFill((fill) => {
    const at = resolved[fill];
    return at.kind === "set" ? at.value : null;
  });
}

function rendered(root: string, file: GateFile, template: string, resolved: ResolvedFills): Rendered {
  if (file.fills === null) return { kind: "rendered", source: template };
  const fill = resolved[file.fills];
  switch (fill.kind) {
    case "set":
      return { kind: "rendered", source: withFill(template, file.fills, fill.value) };
    case "unreadable":
      return { kind: "refused", refusal: fill.refusal };
    case "unset":
      if (FILLS[file.fills].unset.kind === "required")
        return { kind: "refused", refusal: gatesRefusal("fill_missing", { root, fill: file.fills }) };
      return { kind: "rendered", source: template };
    default:
      return unreachable(fill);
  }
}

function plannedFile(root: string, file: GateFile, resolved: ResolvedFills): PlannedFile {
  const path = join(root, file.target);
  const template = SOURCES[file.source];
  invariant(template !== undefined, `the build embeds no gates/${file.source}`);
  const render = rendered(root, file, template, resolved);
  const at = { target: file.target, file, path };
  if (render.kind === "refused") return { ...at, state: "refused", refusal: render.refusal };
  const state = stateOf(file, template, render.source, foundAt(path));
  if (state === "occupied")
    return { ...at, state: "refused", refusal: gatesRefusal("hook_occupied", { root, target: file.target }) };
  return { ...at, state, source: render.source };
}

function isWorkflow(file: GateFile): boolean {
  return file.target.startsWith(`${WORKFLOWS_DIR}/`);
}

function unwantedFile(root: string, file: GateFile): UnwantedFile[] {
  const path = join(root, file.target);
  const found = foundAt(path);
  if (found === null || markerOf(found.text) === null) return [];
  const hash = sha256(found.text);
  const released = file.versions.some((version) => version.sha256 === hash);
  return [{ target: file.target, file, path, state: "unwanted", released }];
}

export function plannedFiles(
  root: string,
  gates: readonly GateName[],
  resolved: ResolvedFills,
): PlannedFile[] {
  const files = new Map(gates.flatMap((gate) => GATES[gate]).map((file) => [file.target, file]));
  const off = workflowsChosen(resolved) === "off";
  return [...files.values()].flatMap((file) =>
    off && isWorkflow(file) ? unwantedFile(root, file) : [plannedFile(root, file, resolved)],
  );
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

function writing<T>(path: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    throw gatesRefusal("write_failed", { path, detail: String(error) });
  }
}

function written({ file, path, source }: WritableFile): void {
  writing(path, () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    chmodSync(path, file.executable ? EXECUTABLE_MODE : FILE_MODE);
  });
}

function applied(root: string, planned: WritableFile): InstalledFile {
  const { target, path, state } = planned;
  switch (state) {
    case "installed":
    case "ahead":
      return { target, state };
    case "missing":
    case "behind":
    case "not-executable":
    case "reconfigured":
      written(planned);
      return { target, state };
    case "changed": {
      const backup = relative(
        root,
        writing(path, () => copyAside(path)),
      );
      written(planned);
      return { target, state, backup };
    }
    default:
      return unreachable(state);
  }
}

function removed(root: string, { target, path, released }: UnwantedFile): InstalledFile {
  const backup = released
    ? null
    : relative(
        root,
        writing(path, () => copyAside(path)),
      );
  writing(path, () => unlinkSync(path));
  return { target, state: "unwanted", backup };
}

function fileCounts(files: readonly InstalledFile[]): FileCounts {
  const count = (state: CountedState) => files.filter((file) => file.state === state).length;
  return {
    installed: count("installed"),
    missing: count("missing"),
    behind: count("behind"),
    changed: count("changed"),
    ahead: count("ahead"),
    "not-executable": count("not-executable"),
    reconfigured: count("reconfigured"),
    unwanted: count("unwanted"),
  };
}

type KeepPlan =
  | { readonly state: "installed" }
  | { readonly state: "missing" | "behind"; readonly path: string; readonly text: string };

function keepPlan(root: string): KeepPlan {
  const path = join(root, KEEP_FILE);
  const found = foundAt(path)?.text ?? null;
  const text = withInstallLines(found);
  if (text === null) return { state: "installed" };
  return { state: found === null ? "missing" : "behind", path, text };
}

function keepsComments(gates: readonly GateName[]): boolean {
  return LANGUAGE_NAMES.some((language) => gates.includes(noCommentsGate(language)));
}

const HOOK_LANGUAGES: readonly Language[] = ["shell"];

const WORKFLOW_LANGUAGES: readonly Language[] = ["yaml"];

function trackedLanguageGates(root: string, workflows: Workflows): NoCommentsGate[] {
  const tracked = trackedLanguages(trackedPerLanguage(root));
  if (tracked.length === 0) throw gatesRefusal("no_language_tracked", { root });
  const gateFiles = workflows === "on" ? [...HOOK_LANGUAGES, ...WORKFLOW_LANGUAGES] : HOOK_LANGUAGES;
  return LANGUAGE_NAMES.filter((language) => gateFiles.includes(language) || tracked.includes(language)).map(
    noCommentsGate,
  );
}

export type Named =
  | { readonly kind: "none" }
  | { readonly kind: "gates"; readonly gates: readonly GateName[] }
  | { readonly kind: "each-tracked-language" };

function namedGates(root: string, named: Named, workflows: Workflows): readonly GateName[] {
  switch (named.kind) {
    case "none":
      return [];
    case "gates":
      return named.gates;
    case "each-tracked-language":
      return trackedLanguageGates(root, workflows);
    default:
      return unreachable(named);
  }
}

export function installGates(root: string, chosen: Named, given: Fills): GatesInstalled {
  const resolved = resolvedFills(root, given);
  const named = namedGates(root, chosen, workflowsChosen(resolved));
  const installed = installedGates(root);
  const gates = GATE_NAMES.filter((gate) => named.includes(gate) || installed.includes(gate));
  if (gates.length === 0) throw gatesRefusal("no_gates_chosen", { root });
  const hooksPath = hooksPathState(root);
  if (hooksPath.kind === "occupied") throw hooksPath.refusal;
  const toWrite = plannedFiles(root, gates, resolved).map((planned) => {
    if (planned.state === "refused") throw planned.refusal;
    return planned;
  });
  const prepare = prepareState(root);
  if (prepare.kind === "occupied" || prepare.kind === "unparseable") throw prepare.refusal;
  const keep = keepsComments(gates) ? keepPlan(root) : null;
  const files = toWrite.map((planned) =>
    planned.state === "unwanted" ? removed(root, planned) : applied(root, planned),
  );
  if (keep !== null) {
    if (keep.state !== "installed") {
      const { path, text } = keep;
      writing(path, () => writeFileSync(path, text));
    }
    files.push({ target: KEEP_FILE, state: keep.state });
  }
  if (prepare.kind === "missing" || prepare.kind === "behind")
    writing(prepare.path, () => writeFileSync(prepare.path, prepare.wired));
  if (hooksPath.kind === "unset") setConfig(root, "core.hooksPath", HOOKS_DIR);
  return { counts: fileCounts(files), gates, files, prepare: prepare.kind, fills: fillValues(resolved) };
}
