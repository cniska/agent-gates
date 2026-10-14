import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { invariant, unreachable } from "./assert";
import type { Refusal } from "./coded-error";
import { type GateName, noCommentsGate } from "./gate-parts";
import {
  fillsOf,
  type HooksPathState,
  hooksPathState,
  installedGates,
  type PlannedFile,
  plannedFiles,
} from "./gates";
import {
  ADAPTER_FILES,
  EACH_TRACKED_LANGUAGE,
  FILL_NAMES,
  FILLS,
  type Fill,
  type Fills,
  HOOKS_DIR,
  INSTALL_GATES,
  nameTheFill,
  REINSTALL,
  SCANNER_FILE,
} from "./gates-contract";
import { adaptersBeside, SWEEP_ALL } from "./no-comments-installed";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";
import { countsOf } from "./no-comments-report";
import { findings, judgedChange } from "./no-comments-scan";
import { trackedLanguages, trackedPerLanguage } from "./no-comments-tracked";
import { type PrepareState, prepareState } from "./package-manifest";

type Health = {
  readonly name: string;
  readonly state: "ok" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
};

type DoctorReport = { readonly checks: readonly Health[]; readonly failing: number };

function refusedHealth(name: string, error: Refusal): Health {
  return { name, state: "fail", detail: error.message, fix: error.resolve };
}

function fileHealth(planned: PlannedFile): Health {
  const name = planned.target;
  switch (planned.state) {
    case "installed":
      return { name, state: "ok", detail: "installed", fix: null };
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
    case "occupied":
    case "unresolved":
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

function fillHealth(fill: Fill, value: string | null): Health[] {
  const { check, offPath, unset } = FILLS[fill];
  if (value === null)
    return unset.kind === "required"
      ? []
      : [{ name: check, state: "warn", detail: unset.detail, fix: nameTheFill(fill) }];
  const program = programOf(value);
  if (onPath(program))
    return [{ name: check, state: "ok", detail: `\`${value}\`; ${program} is on PATH`, fix: null }];
  return [
    {
      name: check,
      state: offPath.state,
      detail: `\`${value}\`, but ${program} is not on PATH${offPath.effect}`,
      fix: `install ${program}, or ${nameTheFill(fill)}`,
    },
  ];
}

function fillsHealth(planned: readonly PlannedFile[], fills: Fills): Health[] {
  return FILL_NAMES.filter((fill) => planned.some(({ file }) => file.fills === fill)).flatMap((fill) =>
    fillHealth(fill, fills[fill]),
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
        fix: null,
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

const BACKLOG_CHECK = "no-comments backlog";

function staleSweepFiles(installed: readonly Language[], planned: readonly PlannedFile[]): string[] {
  const sweep = [SCANNER_FILE, ...installed.map((language) => ADAPTER_FILES[language])].map(
    ({ target }) => target,
  );
  return planned
    .filter(({ target, state }) => sweep.includes(target) && state !== "installed")
    .map(({ target }) => target);
}

function backlogHealth(
  root: string,
  installed: readonly Language[],
  planned: readonly PlannedFile[],
): Health[] {
  if (installed.length === 0) return [];
  const stale = staleSweepFiles(installed, planned);
  if (stale.length > 0)
    return [
      {
        name: BACKLOG_CHECK,
        state: "warn",
        detail: `not counted while these differ from this agent-gates, since the count runs them: ${stale.join(", ")}`,
        fix: REINSTALL,
      },
    ];
  const adapters = adaptersBeside(join(root, dirname(SCANNER_FILE.target)));
  const found = findings(judgedChange(root, { kind: "all" }), adapters);
  const detail = countsOf(found, "tracked");
  if (found.length === 0) return [{ name: BACKLOG_CHECK, state: "ok", detail, fix: null }];
  return [
    {
      name: BACKLOG_CHECK,
      state: "warn",
      detail,
      fix: `node ${SCANNER_FILE.target} ${SWEEP_ALL} lists each one`,
    },
  ];
}

function hooksPathHealth(hooksPath: HooksPathState): Health {
  const name = "hooksPath";
  switch (hooksPath.kind) {
    case "wired":
      return { name, state: "ok", detail: `core.hooksPath is ${HOOKS_DIR}`, fix: null };
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
        fix: null,
      };
    case "wired":
      return { name, state: "ok", detail: "package.json's prepare wires the hooks on install", fix: null };
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
  const planned = plannedFiles(root, gates);
  const fills = fillsOf(planned);
  return [
    { name: "gates", state: "ok", detail: gates.join(", "), fix: null },
    ...planned.map(fileHealth),
    hooksPathHealth(hooksPathState(root)),
    prepareHealth(prepareState(root)),
    ...fillsHealth(planned, fills),
    ...languagesHealth(root, languages),
    ...backlogHealth(root, languages, planned),
  ];
}

export function gatesDoctor(root: string): DoctorReport {
  const checks = judged(root);
  return { checks, failing: checks.filter(({ state }) => state === "fail").length };
}
