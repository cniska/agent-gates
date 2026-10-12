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

function isSharedPart(name: string): name is SharedPart {
  return SHARED_PARTS.some((part) => part === name);
}

export function isPart(name: string): name is Part {
  return isSharedPart(name) || isGateName(name);
}

export const HOOKS_DIR = ".githooks";

export const PREPARE = `! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath ${HOOKS_DIR}`;

export const PAST_PREPARES: readonly string[] = [`git config core.hooksPath ${HOOKS_DIR}`];

export type FileState =
  | "installed"
  | "missing"
  | "behind"
  | "changed"
  | "ahead"
  | "not-executable"
  | "occupied";

export type WritableState = Exclude<FileState, "occupied">;

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

const PRE_COMMIT: GateFile = {
  part: "githooks",
  source: "pre-commit",
  target: `${HOOKS_DIR}/pre-commit`,
  executable: true,
  versions: [{ version: 1, sha256: "d5b3794f1b2c884f4ff3a9407059e436a01c5c190e7bc1cf44f581930653920f" }],
};

export const SCANNER_FILE: GateFile = {
  part: "no-comments",
  source: "no-comments/scan.cjs",
  target: `${HOOKS_DIR}/no-comments/scan.cjs`,
  executable: false,
  versions: [
    { version: 1, sha256: "6c7e734fa6c585451a823e4dcf8b85fe990e811e315d05f757ae5a52635eaefc" },
    { version: 2, sha256: "eb649b51cb538051af71579b679cead7cd3b0f6ccb3841164d9c3457eebdbcf8" },
    { version: 3, sha256: "c7c33503145fa76c400b3e55bed24d9d00fa64d2d186139828214b8cd17dcf44" },
    { version: 4, sha256: "b76f3404f9b7a17a0d9f12f3d61d475b4f0eceb2db80ec93b3aa305ebaa1f7c8" },
    { version: 5, sha256: "5481b108173a86206b2de03d8a4a72c3f14ca59eaa53722cdc52bda3f6666ce4" },
    { version: 6, sha256: "8fd5879e2857a5a372793b7c8decf0ca462ac76b151888d65162a2d6525813ef" },
    { version: 7, sha256: "fd45f4f0d2389327f95ae5b8b1bf35b01be32c60bc78db6990127a40df18aec3" },
    { version: 8, sha256: "187bb31304854e2cadd9a5a7bef8082895a966a1ac33131e8c608c9636029ce8" },
    { version: 9, sha256: "f1c9e9a8b294f0b52d906017f8429d94ec5e52a3c85d78c50b961fed7f472be0" },
    { version: 10, sha256: "87e1b9d76afd4f6f4db2ffeec90f845f743da50637eac543a2f53a7fb6264579" },
    { version: 11, sha256: "4591425d50723eadc16700697cb2ec4b06ba207dfe2b2cdfa693b4aa4e0ced62" },
    { version: 12, sha256: "b2a49bda7916ad313518d2f7871ccecd5773698e0df42259501d4d3b354d3064" },
  ],
};

const NO_COMMENTS_SHARED: readonly GateFile[] = [
  {
    part: "no-comments",
    source: "no-comments/pre-commit",
    target: `${HOOKS_DIR}/pre-commit.d/no-comments`,
    executable: true,
    versions: [
      { version: 1, sha256: "138a8e75142f58bc1a09418964b8a9cbd7944fc516920d307e58e00dd2a5290c" },
      { version: 2, sha256: "f182a3518696f42433f24c131376f0851cb976982af89cf52e4e11aaacf98d55" },
    ],
  },
  SCANNER_FILE,
  {
    part: "no-comments",
    source: "no-comments.yml",
    target: ".github/workflows/no-comments.yml",
    executable: false,
    versions: [
      { version: 1, sha256: "40c64a59e2409c91c2d07df092eeb9384811a991784e2f3300b8aa43e6c78dd9" },
      { version: 2, sha256: "3b83b0cbd4e92e31034e16bbc5d80bd285d41c0612c6ad3fb81239ffc99eb9a1" },
    ],
  },
];

function adapterFile(language: Language, versions: GateFile["versions"]): GateFile {
  return {
    part: noCommentsGate(language),
    source: `no-comments/${language}.cjs`,
    target: `${HOOKS_DIR}/no-comments/${language}.cjs`,
    executable: false,
    versions,
  };
}

export const ADAPTER_FILES: Readonly<Record<Language, GateFile>> = {
  javascript: adapterFile("javascript", [
    { version: 1, sha256: "fb0f19610a50648d653df231f19803b3843dfe0f24909621067c842563cf3696" },
    { version: 2, sha256: "0d043a7c6514e98e6c0b8e6c843e73fe39a733de9b31ac49254bc9ce7ca1d9d4" },
    { version: 3, sha256: "50948edf0aecd083d247a6f48bd83afa0ddff05dffbc32bff5b5bc6ac97b83b0" },
  ]),
  dart: adapterFile("dart", [
    { version: 1, sha256: "25cc760fcd6ef317da0c52457e79e84926f4b87f81e67630b40dfd666f0feb2a" },
    { version: 2, sha256: "92df54b913391968c95d2ac104444ca357925045e79031e6f6351aa9e8e83ba3" },
    { version: 3, sha256: "54036326e9dabcaa7d6c1f30b5d82d7c84c9c4873d152a1687445bbd9ec47017" },
    { version: 4, sha256: "964486eb57d78a359633f9b34839455b736d553b8ee8ae31e3b716ee05997fde" },
  ]),
  sql: adapterFile("sql", [
    { version: 1, sha256: "261cd8dc159c4222234bd5bc2796723b803ecf0cf448a7d417471faea8c3ef13" },
    { version: 2, sha256: "53e8a1300d76f40adf25c20c4ec496821197977c72d4af0792db7d2b4d6ee50c" },
    { version: 3, sha256: "a046c8e22cf48a2eb8fd42a518a0d6f8fb4b6dbefd6f1bca9711455a74616deb" },
    { version: 4, sha256: "c3035a336ca5f556ab3a5eb188463e79fe1cf3afd2ff168fb9f3320c6d6cc077" },
    { version: 5, sha256: "7804a1cdf0715495ad67b08312e11849169ad90d0d89fd428b53d46e5fea8bfb" },
    { version: 6, sha256: "711bdf71c18631a5205f043567e1b7c7f3c276fa999b90a5372cf0d2df3c09b9" },
    { version: 7, sha256: "132693681e45619b1e4c2f259d0d8052100c7b27ae42d23f7b39418706dd297f" },
  ]),
  shell: adapterFile("shell", [
    { version: 1, sha256: "89a9bdde90915a96d5110890ac7dd715a098676cf44976c0bc2301b4012ab1b2" },
    { version: 2, sha256: "5476432be3f3aa04c3166c32991414f6438d399730b5f0d3bcebe73ee63e4b80" },
    { version: 3, sha256: "440f348f033528b6281b9af016eb0b4f2902b812dd8e60e34fd20eb6c43c1989" },
    { version: 4, sha256: "e052ffc1dcafa3aaf4cda173aaaba1d79ffb75ddaa80bbf94aec5ea31e20b73c" },
    { version: 5, sha256: "4fb93d0ae8dfc4acc479c20fc52199f97857c73bbe9e946368fdebd2f93a0b03" },
  ]),
  rust: adapterFile("rust", [
    { version: 1, sha256: "f7d0dd77af2f515cca76525640e20f72984a24e995031360b190b31478634daa" },
    { version: 2, sha256: "9e73f2d918880da44d3e7980a8fb9b07a58f325bc59a9374faaceba1373c4176" },
    { version: 3, sha256: "1d30c5169f78c97c3fbe2e652df2a0325a0b1cf3f2fcd86ff7c86f20e0e22157" },
  ]),
};

function noCommentsFiles(language: Language): readonly GateFile[] {
  return [GITATTRIBUTES, PRE_COMMIT, ...NO_COMMENTS_SHARED, ADAPTER_FILES[language]];
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
        { version: 3, sha256: "f28727dbb2e815970fe0e9233c753274cf66c04ae8ac608da31d433e97c3df87" },
      ],
    },
    GITATTRIBUTES,
  ],
  "no-comments-javascript": noCommentsFiles("javascript"),
  "no-comments-dart": noCommentsFiles("dart"),
  "no-comments-sql": noCommentsFiles("sql"),
  "no-comments-shell": noCommentsFiles("shell"),
  "no-comments-rust": noCommentsFiles("rust"),
};

export const INSTALL_GATES = `agent-gates install <gate>..., choosing from ${GATE_NAMES.join(", ")}`;

export const REINSTALL = "agent-gates install";
