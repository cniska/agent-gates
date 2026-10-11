import { unreachable } from "./assert";
import type { CodedError } from "./coded-error";
import { type HooksPathState, hooksPathState, installedGates, type PlannedFile, plannedFiles } from "./gates";
import { HOOKS_DIR, INSTALL_GATES, REINSTALL } from "./gates-contract";
import { type PrepareState, prepareState } from "./package-manifest";

type Health = {
  readonly name: string;
  readonly state: "ok" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
};

type DoctorReport = { readonly checks: readonly Health[]; readonly failing: number };

function refusedHealth(name: string, error: CodedError): Health {
  return { name, state: "fail", detail: error.message, fix: error.resolve };
}

function fileHealth({ target: name, state }: PlannedFile): Health {
  switch (state) {
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
    default:
      return unreachable(state);
  }
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
  ];
}

export function gatesDoctor(root: string): DoctorReport {
  const checks = judged(root);
  return { checks, failing: checks.filter(({ state }) => state === "fail").length };
}
