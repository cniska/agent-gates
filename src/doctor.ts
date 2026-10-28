import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { invariant, unreachable } from "./assert";
import type { Refusal } from "./coded-error";
import { type GateName, noCommentsGate } from "./gate-parts";
import {
  type HooksPathState,
  hooksPathState,
  installedGates,
  type PlannedFile,
  plannedFiles,
  type ResolvedFill,
  type ResolvedFills,
  resolvedFills,
  type StepsState,
  stepsState,
  workflowsChosen,
} from "./gates";
import {
  ADAPTER_FILES,
  EACH_TRACKED_LANGUAGE,
  FILL_NAMES,
  FILLS,
  type Fill,
  type GateFile,
  HOOKS_DIR,
  INSTALL_GATES,
  NO_FILLS,
  NO_SECRETS_SCANNER,
  nameTheFill,
  PINNED_ACTIONS_SCANNER,
  REINSTALL,
  SCANNER_FILE,
  WORKFLOWS_DIR,
} from "./gates-contract";
import { adaptersBeside } from "./no-comments-installed";
import { KEEP_FILE, keepRead } from "./no-comments-keep";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";
import { countsOf } from "./no-comments-report";
import { findings, judgedChange } from "./no-comments-scan";
import { trackedLanguages, trackedPerLanguage } from "./no-comments-tracked";
import { secretsAdded } from "./no-secrets-judge";
import { countsOf as secretCountsOf } from "./no-secrets-report";
import { type PrepareState, prepareState } from "./package-manifest";
import { unpinnedIn } from "./pinned-actions-judge";
import { countsOf as unpinnedCountsOf } from "./pinned-actions-report";
import { SWEEP_ALL } from "./scanner-call";
import { judgedTextOf } from "./scanner-change";

export type Health =
  | { readonly name: string; readonly state: "ok"; readonly detail: string }
  | { readonly name: string; readonly state: "warn" | "fail"; readonly detail: string; readonly fix: string };

type HealthCounts = { readonly [State in Health["state"]]: number };

type DoctorReport = { readonly counts: HealthCounts; readonly checks: readonly Health[] };

function refusedHealth(name: string, error: Refusal): Health {
  return { name, state: "fail", detail: error.message, fix: error.resolve };
}

function fileHealth(planned: PlannedFile): Health {
  const name = planned.target;
  switch (planned.state) {
    case "installed":
      return { name, state: "ok", detail: "installed" };
    case "missing":
      return { name, state: "fail", detail: "missing, so the gate does not run", fix: REINSTALL };
    case "not-executable":
      return { name, state: "fail", detail: "not executable, so git skips the hook", fix: REINSTALL };
    case "behind":
      return { name, state: "warn", detail: "an earlier version of this gate file", fix: REINSTALL };
    case "changed":
      return {
        name,
        state: "warn",
        detail: "differs from every version of this gate file; install sets it aside before replacing it",
        fix: REINSTALL,
      };
    case "ahead":
      return {
        name,
        state: "warn",
        detail: "written by a newer agent-gates than this one",
        fix: `update agent-gates, then ${REINSTALL}`,
      };
    case "reconfigured":
      invariant(false, "doctor gives no command, so no file is reconfigured");
      break;
    case "unwanted":
      return {
        name,
        state: "warn",
        detail: "a gate's workflow while the project's workflows are off, so CI still runs it",
        fix: REINSTALL,
      };
    case "refused":
      return refusedHealth(name, planned.refusal);
    default:
      return unreachable(planned);
  }
}

function programOf(command: string): string {
  const [program = ""] = command.trim().split(/\s+/);
  return program;
}

function onPath(program: string): boolean {
  return spawnSync("sh", ["-c", 'command -v "$1" >/dev/null', "sh", program]).status === 0;
}

function unsetHealth(fill: Fill): Health[] {
  const { check, unset } = FILLS[fill];
  switch (unset.kind) {
    case "required":
      return [];
    case "defaulted":
      return [{ name: check, state: "ok", detail: unset.detail }];
    default:
      return unreachable(unset);
  }
}

function setHealth(fill: Fill, value: string): Health[] {
  const { check, program } = FILLS[fill];
  if (program === null) return [{ name: check, state: "ok", detail: `\`${value}\`` }];
  const named = programOf(value);
  if (onPath(named)) return [{ name: check, state: "ok", detail: `\`${value}\`; ${named} is on PATH` }];
  return [
    {
      name: check,
      state: "fail",
      detail: `\`${value}\`, but ${named} is not on PATH${program.offPathEffect}`,
      fix: `install ${named}, or ${nameTheFill(fill)}`,
    },
  ];
}

function fillHealth(fill: Fill, resolved: ResolvedFill): Health[] {
  switch (resolved.kind) {
    case "set":
      return setHealth(fill, resolved.value);
    case "unset":
      return unsetHealth(fill);
    case "unreadable":
      return [];
    default:
      return unreachable(resolved);
  }
}

function fillsHealth(planned: readonly PlannedFile[], resolved: ResolvedFills): Health[] {
  return FILL_NAMES.filter((fill) => planned.some(({ file }) => file.fills === fill)).flatMap((fill) =>
    fillHealth(fill, resolved[fill]),
  );
}

const LANGUAGES_CHECK = "no-comments languages";

function missingDetail(language: Language, tracked: ReadonlyMap<Language, number>): string {
  const count = tracked.get(language) ?? 0;
  const files = count === 1 ? "file" : "files";
  return `${language} reads ${count} tracked ${files}, but ${noCommentsGate(language)} is not installed`;
}

function unusedDetail(language: Language): string {
  return `${noCommentsGate(language)} is installed, but the project tracks no file ${language} reads`;
}

function languagesFix(missing: readonly Language[], unused: readonly Language[]): string {
  const install = missing.length === 0 ? [] : [`agent-gates install ${EACH_TRACKED_LANGUAGE}`];
  const remove =
    unused.length === 0
      ? []
      : [`delete ${unused.map((language) => ADAPTER_FILES[language].target).join(" ")}`];
  return [...install, ...remove].join("; ");
}

function installedLanguages(gates: readonly GateName[]): Language[] {
  return LANGUAGE_NAMES.filter((language) => gates.includes(noCommentsGate(language)));
}

function languagesHealth(root: string, installed: readonly Language[]): Health[] {
  const tracked = trackedPerLanguage(root);
  const needed = trackedLanguages(tracked);
  const missing = needed.filter((language) => !installed.includes(language));
  const unused = installed.filter((language) => !needed.includes(language));
  if (installed.length === 0 && missing.length === 0) return [];
  if (missing.length === 0 && unused.length === 0)
    return [
      {
        name: LANGUAGES_CHECK,
        state: "ok",
        detail: `${installed.join(", ")}, as the tracked files need`,
      },
    ];
  return [
    {
      name: LANGUAGES_CHECK,
      state: "warn",
      detail: [
        ...missing.map((language) => missingDetail(language, tracked)),
        ...unused.map(unusedDetail),
      ].join("; "),
      fix: languagesFix(missing, unused),
    },
  ];
}

type Counted =
  | { readonly kind: "counted"; readonly detail: string; readonly clean: boolean }
  | { readonly kind: "refused"; readonly refusal: Refusal };

function staleOf(runs: readonly GateFile[], planned: readonly PlannedFile[]): string[] {
  return planned
    .filter(({ target, state }) => runs.some((file) => file.target === target) && state !== "installed")
    .map(({ target }) => target);
}

function notCounted(runs: readonly GateFile[], stale: readonly string[]): string {
  const [these, them] = runs.length === 1 ? ["this differs", "it"] : ["these differ", "them"];
  return `not counted while ${these} from this agent-gates, since the count runs ${them}: ${stale.join(", ")}`;
}

function backlogOf(
  name: string,
  scanner: GateFile,
  alsoRuns: readonly GateFile[],
  planned: readonly PlannedFile[],
  counted: () => Counted,
): Health {
  const runs = [scanner, ...alsoRuns];
  const stale = staleOf(runs, planned);
  if (stale.length > 0) return { name, state: "warn", detail: notCounted(runs, stale), fix: REINSTALL };
  const count = counted();
  if (count.kind === "refused") return refusedHealth(name, count.refusal);
  if (count.clean) return { name, state: "ok", detail: count.detail };
  return {
    name,
    state: "warn",
    detail: count.detail,
    fix: `node ${scanner.target} ${SWEEP_ALL} lists each one`,
  };
}

function backlogHealth(
  root: string,
  installed: readonly Language[],
  planned: readonly PlannedFile[],
): Health[] {
  if (installed.length === 0) return [];
  const adapterFiles = installed.map((language) => ADAPTER_FILES[language]);
  return [
    backlogOf("no-comments backlog", SCANNER_FILE, adapterFiles, planned, () => {
      const all = { kind: "all" } as const;
      const read = keepRead(judgedTextOf(root, all, KEEP_FILE));
      if (read.kind === "malformed") return { kind: "refused", refusal: read.refusal };
      const adapters = adaptersBeside(join(root, dirname(SCANNER_FILE.target)));
      const found = findings(judgedChange(root, all), adapters, read.keep);
      return { kind: "counted", detail: countsOf(found, "tracked"), clean: found.length === 0 };
    }),
  ];
}

function secretsHealth(root: string, gates: readonly GateName[], planned: readonly PlannedFile[]): Health[] {
  if (!gates.includes("no-secrets")) return [];
  return [
    backlogOf("no-secrets backlog", NO_SECRETS_SCANNER, [], planned, () => {
      const skipped = [{ inRoot: dirname(NO_SECRETS_SCANNER.target) }];
      const found = secretsAdded(root, { kind: "all" }, skipped);
      return { kind: "counted", detail: secretCountsOf(found, "tracked"), clean: found.length === 0 };
    }),
  ];
}

function actionsHealth(root: string, gates: readonly GateName[], planned: readonly PlannedFile[]): Health[] {
  if (!gates.includes("pinned-actions")) return [];
  return [
    backlogOf("pinned-actions backlog", PINNED_ACTIONS_SCANNER, [], planned, () => {
      const found = unpinnedIn(root, { kind: "all" });
      return { kind: "counted", detail: unpinnedCountsOf(found, "tracked"), clean: found.length === 0 };
    }),
  ];
}

const STEPS_CHECK = "hook steps";

function stepsHealth({ steps, unchecked }: StepsState): Health[] {
  if (steps.length === 0) return [];
  if (unchecked.length === 0)
    return [{ name: STEPS_CHECK, state: "ok", detail: `a workflow runs ${steps.join(", ")}` }];
  return [
    {
      name: STEPS_CHECK,
      state: "warn",
      detail: `no workflow in ${WORKFLOWS_DIR} runs ${unchecked.join(", ")}, so CI never checks what it refuses`,
      fix: `add a workflow step that runs ${unchecked.join(", ")}`,
    },
  ];
}

function hooksPathHealth(hooksPath: HooksPathState): Health {
  const name = "hooksPath";
  switch (hooksPath.kind) {
    case "wired":
      return { name, state: "ok", detail: `core.hooksPath is ${HOOKS_DIR}` };
    case "unset":
      return {
        name,
        state: "fail",
        detail: `core.hooksPath is unset, so git never runs the gates in ${HOOKS_DIR}`,
        fix: REINSTALL,
      };
    case "occupied":
      return refusedHealth(name, hooksPath.refusal);
    default:
      return unreachable(hooksPath);
  }
}

function prepareHealth(prepare: PrepareState): Health {
  const name = "prepare";
  switch (prepare.kind) {
    case "absent":
      return {
        name,
        state: "ok",
        detail: `no package.json, so each contributor runs git config core.hooksPath ${HOOKS_DIR} once`,
      };
    case "wired":
      return { name, state: "ok", detail: "package.json's prepare wires the hooks on install" };
    case "missing":
      return {
        name,
        state: "warn",
        detail: "package.json has no prepare script, so a fresh clone runs no gate",
        fix: REINSTALL,
      };
    case "behind":
      return { name, state: "warn", detail: "package.json's prepare is an earlier wiring", fix: REINSTALL };
    case "occupied":
    case "unparseable":
      return refusedHealth(name, prepare.refusal);
    default:
      return unreachable(prepare);
  }
}

function judged(root: string): Health[] {
  const gates = installedGates(root);
  if (gates.length === 0)
    return [
      {
        name: "gates",
        state: "warn",
        detail: "no gate is installed",
        fix: INSTALL_GATES,
      },
      ...languagesHealth(root, []),
    ];
  const languages = installedLanguages(gates);
  const resolved = resolvedFills(root, NO_FILLS);
  const planned = plannedFiles(root, gates, resolved);
  return [
    { name: "gates", state: "ok", detail: gates.join(", ") },
    ...planned.map(fileHealth),
    hooksPathHealth(hooksPathState(root)),
    prepareHealth(prepareState(root)),
    ...fillsHealth(planned, resolved),
    ...(workflowsChosen(resolved) === "on" ? stepsHealth(stepsState(root, planned)) : []),
    ...languagesHealth(root, languages),
    ...backlogHealth(root, languages, planned),
    ...secretsHealth(root, gates, planned),
    ...actionsHealth(root, gates, planned),
  ];
}

export function gatesDoctor(root: string): DoctorReport {
  const checks = judged(root);
  const count = (state: Health["state"]) => checks.filter((check) => check.state === state).length;
  return { counts: { ok: count("ok"), warn: count("warn"), fail: count("fail") }, checks };
}
