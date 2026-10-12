import { refuser } from "./coded-error";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";

export type NoCommentsGate = `no-comments-${Language}`;

export function noCommentsGate(language: Language): NoCommentsGate {
  return `no-comments-${language}`;
}

export type GateName = "commit-subject" | NoCommentsGate;

export const GATE_NAMES: readonly GateName[] = ["commit-subject", ...LANGUAGE_NAMES.map(noCommentsGate)];

export function isGateName(name: string): name is GateName {
  return GATE_NAMES.some((gate) => gate === name);
}

const SHARED_PARTS = ["githooks", "no-comments"] as const;

type SharedPart = (typeof SHARED_PARTS)[number];

export type Part = GateName | SharedPart;

export function isSharedPart(name: string): name is SharedPart {
  return SHARED_PARTS.some((part) => part === name);
}

export function isPart(name: string): name is Part {
  return isSharedPart(name) || isGateName(name);
}

export const HOOKS_DIR = ".githooks";

export const PREPARE = `! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath ${HOOKS_DIR}`;

export const PAST_PREPARES: readonly string[] = [`git config core.hooksPath ${HOOKS_DIR}`];

export type FileState = "installed" | "missing" | "behind" | "changed" | "ahead" | "not-executable";

type GateVersion = { readonly version: number; readonly sha256: string };

export type GateFile = {
  readonly part: Part;
  readonly source: string;
  readonly target: string;
  readonly executable: boolean;
  readonly versions: readonly [GateVersion, ...GateVersion[]];
};

const GITATTRIBUTES: GateFile = {
  part: "githooks",
  source: "gitattributes",
  target: `${HOOKS_DIR}/.gitattributes`,
  executable: false,
  versions: [
    { version: 1, sha256: "ad36a0eb187fe7a496ae5268c924ae0c1d70451796700a133f1731d49d1d4a0c" },
    { version: 2, sha256: "4765ab668d4acf13110366595f389b0a2b09424903378faa02786f96ac64369b" },
  ],
};

export const PRE_COMMIT: GateFile = {
  part: "githooks",
  source: "pre-commit",
  target: `${HOOKS_DIR}/pre-commit`,
  executable: true,
  versions: [{ version: 1, sha256: "d5b3794f1b2c884f4ff3a9407059e436a01c5c190e7bc1cf44f581930653920f" }],
};

const NO_COMMENTS_SHARED: readonly GateFile[] = [
  {
    part: "no-comments",
    source: "no-comments/pre-commit",
    target: `${HOOKS_DIR}/pre-commit.d/no-comments`,
    executable: true,
    versions: [{ version: 1, sha256: "138a8e75142f58bc1a09418964b8a9cbd7944fc516920d307e58e00dd2a5290c" }],
  },
  {
    part: "no-comments",
    source: "no-comments/scan.cjs",
    target: `${HOOKS_DIR}/no-comments/scan.cjs`,
    executable: false,
    versions: [
      { version: 1, sha256: "6c7e734fa6c585451a823e4dcf8b85fe990e811e315d05f757ae5a52635eaefc" },
      { version: 2, sha256: "eb649b51cb538051af71579b679cead7cd3b0f6ccb3841164d9c3457eebdbcf8" },
    ],
  },
  {
    part: "no-comments",
    source: "no-comments.yml",
    target: ".github/workflows/no-comments.yml",
    executable: false,
    versions: [{ version: 1, sha256: "40c64a59e2409c91c2d07df092eeb9384811a991784e2f3300b8aa43e6c78dd9" }],
  },
];

function noCommentsFiles(language: Language, versions: GateFile["versions"]): readonly GateFile[] {
  return [
    GITATTRIBUTES,
    PRE_COMMIT,
    ...NO_COMMENTS_SHARED,
    {
      part: noCommentsGate(language),
      source: `no-comments/${language}.cjs`,
      target: `${HOOKS_DIR}/no-comments/${language}.cjs`,
      executable: false,
      versions,
    },
  ];
}

export const GATES: Readonly<Record<GateName, readonly GateFile[]>> = {
  "commit-subject": [
    {
      part: "commit-subject",
      source: "commit-msg",
      target: `${HOOKS_DIR}/commit-msg`,
      executable: true,
      versions: [
        { version: 1, sha256: "73ec5976bae1e77235a86ee02051f2d60c4abc0fe2d9d6dfd00e9599cfdafa46" },
        { version: 2, sha256: "79602ae373e09db09960aa1aa25cb36df35ed91a8c6780499e4434f082943d41" },
      ],
    },
    {
      part: "commit-subject",
      source: "commits.yml",
      target: ".github/workflows/commits.yml",
      executable: false,
      versions: [
        { version: 1, sha256: "cba3046993d4ca84942aa37b60c17cf77af0123f1a6152482db0301a933587ba" },
        { version: 2, sha256: "f5863ec0ebb55f68779bd8f5693406178e5adbfb1dfbe09db12550286487656f" },
      ],
    },
    GITATTRIBUTES,
  ],
  "no-comments-javascript": noCommentsFiles("javascript", [
    { version: 1, sha256: "fb0f19610a50648d653df231f19803b3843dfe0f24909621067c842563cf3696" },
    { version: 2, sha256: "0d043a7c6514e98e6c0b8e6c843e73fe39a733de9b31ac49254bc9ce7ca1d9d4" },
  ]),
  "no-comments-dart": noCommentsFiles("dart", [
    { version: 1, sha256: "25cc760fcd6ef317da0c52457e79e84926f4b87f81e67630b40dfd666f0feb2a" },
  ]),
  "no-comments-sql": noCommentsFiles("sql", [
    { version: 1, sha256: "261cd8dc159c4222234bd5bc2796723b803ecf0cf448a7d417471faea8c3ef13" },
    { version: 2, sha256: "53e8a1300d76f40adf25c20c4ec496821197977c72d4af0792db7d2b4d6ee50c" },
  ]),
};

export const INSTALL_GATES = `agent-gates install <gate>..., choosing from ${GATE_NAMES.join(", ")}`;

export const REINSTALL = "agent-gates install";

export const refuseGates = refuser<{
  readonly no_gates_chosen: { readonly root: string };
  readonly hooks_path_occupied: { readonly root: string; readonly hooksPath: string };
  readonly pre_commit_occupied: { readonly root: string };
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
  pre_commit_occupied: {
    message: ({ root }) =>
      `${root} has its own ${HOOKS_DIR}/pre-commit, which the gates that run before a commit would replace`,
    resolve: ({ root }) =>
      `stop and hand this error to the owner: ${root}'s ${HOOKS_DIR}/pre-commit must move to ${HOOKS_DIR}/pre-commit.d/<name> before the gates install`,
  },
  write_failed: {
    message: ({ path, detail }) => `${path} could not be written: ${detail}`,
    resolve: ({ path }) => `stop and hand this error to the owner: ${path} must be writable`,
  },
});
