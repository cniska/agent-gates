import { refuser } from "./coded-error";

export const GATE_NAMES = ["commit-subject"] as const;

export type GateName = (typeof GATE_NAMES)[number];

export function isGateName(name: string): name is GateName {
  return GATE_NAMES.some((gate) => gate === name);
}

const SHARED_PART = "githooks";

export type Part = GateName | typeof SHARED_PART;

export function isPart(name: string): name is Part {
  return name === SHARED_PART || isGateName(name);
}

export const HOOKS_DIR = ".githooks";

export const PREPARE = `! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath ${HOOKS_DIR}`;

export const PAST_PREPARES: readonly string[] = [`git config core.hooksPath ${HOOKS_DIR}`];

export type FileState = "installed" | "missing" | "behind" | "changed" | "ahead" | "not-executable";

type GateVersion = { readonly version: number; readonly sha256: string };

export type GateFile = {
  readonly source: string;
  readonly target: string;
  readonly executable: boolean;
  readonly versions: readonly [GateVersion, ...GateVersion[]];
};

export const GATES: Readonly<Record<GateName, readonly GateFile[]>> = {
  "commit-subject": [
    {
      source: "commit-msg",
      target: `${HOOKS_DIR}/commit-msg`,
      executable: true,
      versions: [
        { version: 1, sha256: "73ec5976bae1e77235a86ee02051f2d60c4abc0fe2d9d6dfd00e9599cfdafa46" },
        { version: 2, sha256: "79602ae373e09db09960aa1aa25cb36df35ed91a8c6780499e4434f082943d41" },
      ],
    },
    {
      source: "commits.yml",
      target: ".github/workflows/commits.yml",
      executable: false,
      versions: [
        { version: 1, sha256: "cba3046993d4ca84942aa37b60c17cf77af0123f1a6152482db0301a933587ba" },
        { version: 2, sha256: "f5863ec0ebb55f68779bd8f5693406178e5adbfb1dfbe09db12550286487656f" },
      ],
    },
    {
      source: "gitattributes",
      target: `${HOOKS_DIR}/.gitattributes`,
      executable: false,
      versions: [
        { version: 1, sha256: "ad36a0eb187fe7a496ae5268c924ae0c1d70451796700a133f1731d49d1d4a0c" },
        { version: 2, sha256: "4765ab668d4acf13110366595f389b0a2b09424903378faa02786f96ac64369b" },
      ],
    },
  ],
};

export const INSTALL_GATES = `agent-gates install <gate>..., choosing from ${GATE_NAMES.join(", ")}`;

export const REINSTALL = "agent-gates install";

export const refuseGates = refuser<{
  readonly no_gates_chosen: { readonly root: string };
  readonly hooks_path_occupied: { readonly root: string; readonly hooksPath: string };
  readonly write_failed: { readonly path: string; readonly detail: string };
}>({
  no_gates_chosen: {
    message: ({ root }) =>
      `${root} has no gates installed and none were named, so there is nothing to install`,
    resolve: () => `stop and ask the owner which gates the project runs, then ${INSTALL_GATES}`,
  },
  hooks_path_occupied: {
    message: ({ root, hooksPath }) =>
      `${root} runs its git hooks from ${hooksPath}, so the gates in ${HOOKS_DIR} would never run`,
    resolve: ({ root }) =>
      `stop and hand this error to the owner: ${root}'s hooks must move to ${HOOKS_DIR} before the gates install`,
  },
  write_failed: {
    message: ({ path, detail }) => `${path} could not be written: ${detail}`,
    resolve: ({ path }) => `stop and hand this error to the owner: ${path} must be writable`,
  },
});
