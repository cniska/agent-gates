import { unreachable } from "./assert";
import type { Refusal } from "./coded-error";
import { type HooksPathState, hooksPathState, installedGates, type PlannedFile, plannedFiles } from "./gates";
import {
  ADAPTER_FILES,
  type GateName,
  HOOKS_DIR,
  INSTALL_GATES,
  noCommentsGate,
  REINSTALL,
} from "./gates-contract";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";
import { trackedPerLanguage } from "./no-comments-tracked";
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
    case "occupied":
      return refusedHealth(name, planned.refusal);
    default:
      return unreachable(planned);
  }
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
  const install =
    missing.length === 0 ? [] : [`agent-gates install ${missing.map(noCommentsGate).join(" ")}`];
  const remove =
    unused.length === 0
      ? []
      : [`delete ${unused.map((language) => ADAPTER_FILES[language].target).join(" ")}`];
  return [...install, ...remove].join("; ");
}

function languagesHealth(root: string, gates: readonly GateName[]): Health[] {
  const installed = LANGUAGE_NAMES.filter((language) => gates.includes(noCommentsGate(language)));
  if (installed.length === 0) return [];
  const tracked = trackedPerLanguage(root);
  const tracks = (language: Language) => (tracked.get(language) ?? 0) > 0;
  const missing = LANGUAGE_NAMES.filter((language) => !installed.includes(language) && tracks(language));
  const unused = installed.filter((language) => !tracks(language));
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
    ];
  return [
    { name: "gates", state: "ok", detail: gates.join(", "), fix: null },
    ...plannedFiles(root, gates).map(fileHealth),
    hooksPathHealth(hooksPathState(root)),
    prepareHealth(prepareState(root)),
    ...languagesHealth(root, gates),
  ];
}

export function gatesDoctor(root: string): DoctorReport {
  const checks = judged(root);
  return { checks, failing: checks.filter(({ state }) => state === "fail").length };
}
