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
    { version: 13, sha256: "31afdb20742637f34672f836458e7a6d1a4bd9ce85e1ecca9b8f43050860169e" },
    { version: 14, sha256: "ff59819cac42f134ad5d9c2af3764a622ddedafa12710ebe1a51057fd24c8ff1" },
    { version: 15, sha256: "edeb998d6e432ba222c7328afc2b3b1463ff559a25c30db96a4eda8e17d722ad" },
    { version: 16, sha256: "ffab275e0635da838d04835a8a57827ad857bf562397ab28dcb43ab09a4309ba" },
    { version: 17, sha256: "18003038581ec389d7ce4e6407cedb94dab39d604d48d6b760e01ef94b16375d" },
    { version: 18, sha256: "61e3a64ba341a3c9617a235604012e5a907e92d6cd4522b977d1de24ff5097f2" },
    { version: 19, sha256: "a00e2bc6294d6d3c6d8a824749190307015e999c17616903a3e4b6bb495d63cc" },
    { version: 20, sha256: "e33a12f6c8989f3e1c4002d3a6a56b3c717a217702a350025c8aaa6935064848" },
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
      { version: 3, sha256: "e226a011a732f4af4a218046de9df61ab64920ab242251e61a5dd889b1fa4246" },
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
    { version: 4, sha256: "1d536a0ea23d15363d62b7689fd4a1ed49b53f12aaac37bc25548a839b9c4016" },
    { version: 5, sha256: "fe3f5d45a2d75b68ae529b98a676e14c56f649d185af4b7d2ff90f0109d27043" },
    { version: 6, sha256: "e5b90a207137dd3d261230d738aa0f448f1fc51d6b80bc83f3a955a17c7c5cc1" },
    { version: 7, sha256: "b09bddcddad37ee5b63fbd7327dde6ad94b4b8acf973dd3559b4aecb3607bdca" },
    { version: 8, sha256: "9c54371fb942d9c71a769ed6e1a1a5c867ca933b4de6321023bc9895afafabfc" },
    { version: 9, sha256: "7bff8371e1a4854a7e9795b82bd8f747f6644d08c3ee7904604a530af83467ea" },
  ]),
  dart: adapterFile("dart", [
    { version: 1, sha256: "25cc760fcd6ef317da0c52457e79e84926f4b87f81e67630b40dfd666f0feb2a" },
    { version: 2, sha256: "92df54b913391968c95d2ac104444ca357925045e79031e6f6351aa9e8e83ba3" },
    { version: 3, sha256: "54036326e9dabcaa7d6c1f30b5d82d7c84c9c4873d152a1687445bbd9ec47017" },
    { version: 4, sha256: "964486eb57d78a359633f9b34839455b736d553b8ee8ae31e3b716ee05997fde" },
    { version: 5, sha256: "e49d805733de57c59b59112a7dcffd7a1614c8f7dd6553739ec347732988edeb" },
    { version: 6, sha256: "5f0e73b8fef58849677f4badafbf73f38a2b9cc41958dae270bc54d45a7a7b5d" },
    { version: 7, sha256: "8047ce3f8bae6c6a7098a46bb69287cc2fc673a33d0a95464a2568ec9823181c" },
    { version: 8, sha256: "0783cd4626dff88c481bc95ef9c7122a0411ccfcfd1ac2ee84a52ef9ea9e9825" },
    { version: 9, sha256: "2b77929ef886cb1c4b5df73aa19ce59528401ced1cbba59af690bb8d0abcfea2" },
    { version: 10, sha256: "16c0d4be3865d5c13ea9390f4c66f8e74e8deacd4474aca8e5a5cae22a6084d5" },
    { version: 11, sha256: "3c358c5a449fc59f0f497134eae44f247f79b9e44195b31649eeac3250e5873a" },
  ]),
  sql: adapterFile("sql", [
    { version: 1, sha256: "261cd8dc159c4222234bd5bc2796723b803ecf0cf448a7d417471faea8c3ef13" },
    { version: 2, sha256: "53e8a1300d76f40adf25c20c4ec496821197977c72d4af0792db7d2b4d6ee50c" },
    { version: 3, sha256: "a046c8e22cf48a2eb8fd42a518a0d6f8fb4b6dbefd6f1bca9711455a74616deb" },
    { version: 4, sha256: "c3035a336ca5f556ab3a5eb188463e79fe1cf3afd2ff168fb9f3320c6d6cc077" },
    { version: 5, sha256: "7804a1cdf0715495ad67b08312e11849169ad90d0d89fd428b53d46e5fea8bfb" },
    { version: 6, sha256: "711bdf71c18631a5205f043567e1b7c7f3c276fa999b90a5372cf0d2df3c09b9" },
    { version: 7, sha256: "132693681e45619b1e4c2f259d0d8052100c7b27ae42d23f7b39418706dd297f" },
    { version: 8, sha256: "55fac03f14ff79c09f67736eaa44ee9908006548f2b76476444aac1285129f40" },
    { version: 9, sha256: "3e39a509164a0213cee67a84dbd5970563e57f50ffe6d315a261890c5eb7b20e" },
    { version: 10, sha256: "cc2348334d375488c02204f0c9cff51cec60ae2065a358a50c4b99d6f94faa86" },
    { version: 11, sha256: "49094c80b6328b34b838db26a3b44193fe08a26fcc99a7b218d91d82e8611000" },
    { version: 12, sha256: "32c7669079422f0b024417044d002c3d5cad502ff8211272c54b0be9defeff18" },
  ]),
  shell: adapterFile("shell", [
    { version: 1, sha256: "89a9bdde90915a96d5110890ac7dd715a098676cf44976c0bc2301b4012ab1b2" },
    { version: 2, sha256: "5476432be3f3aa04c3166c32991414f6438d399730b5f0d3bcebe73ee63e4b80" },
    { version: 3, sha256: "440f348f033528b6281b9af016eb0b4f2902b812dd8e60e34fd20eb6c43c1989" },
    { version: 4, sha256: "e052ffc1dcafa3aaf4cda173aaaba1d79ffb75ddaa80bbf94aec5ea31e20b73c" },
    { version: 5, sha256: "4fb93d0ae8dfc4acc479c20fc52199f97857c73bbe9e946368fdebd2f93a0b03" },
    { version: 6, sha256: "944b7469bc2f363529693a056650620e24f652ef3617e78c6c059f5744f049e8" },
    { version: 7, sha256: "357b83ed28c82b4e0fbe168e92d32cfc8ba817d552b026802d78b6b5c1dd94c5" },
    { version: 8, sha256: "70e69db41b87eebf711ea11cd41451ae66f25c61f9dc3574d96f5867b6c5e1da" },
    { version: 9, sha256: "5de5dce7045aca70c7bf8d568dadaadd108bb4175045494c8a81f618e870f039" },
    { version: 10, sha256: "4a5ee28cfca707dee82a1e8ffde463e4c0465f35fa8bc31d0b83011d6103d9a3" },
    { version: 11, sha256: "44df1bb7c417b2cae6be77209ba1e818df257c09d568dd8ed0202088408c8ecd" },
  ]),
  rust: adapterFile("rust", [
    { version: 1, sha256: "f7d0dd77af2f515cca76525640e20f72984a24e995031360b190b31478634daa" },
    { version: 2, sha256: "9e73f2d918880da44d3e7980a8fb9b07a58f325bc59a9374faaceba1373c4176" },
    { version: 3, sha256: "1d30c5169f78c97c3fbe2e652df2a0325a0b1cf3f2fcd86ff7c86f20e0e22157" },
    { version: 4, sha256: "2a636f4664ddcc1bc2950f54e884103837d04a1191b0fca88fbd5b5721426ae3" },
    { version: 5, sha256: "9b1e16e0014bc7ad52f03da23582577fabea6e5e01f587dbff882daf0447bac8" },
    { version: 6, sha256: "339e71b25a77824f7f29b530737490980f85b01300a77d4866779720ff4ef073" },
    { version: 7, sha256: "ef91663e34123a7977559af043f8d7c7c3bcff65a5b5d8ffd2f3bad66c99dccf" },
    { version: 8, sha256: "d448dacb4576d6ed47314698cea9eae3c0cf8a49e301d0d591eee0eb0db6ecff" },
    { version: 9, sha256: "0b23851171909b278dcaaef824e173c5776fdf93b63f1d757d51dd223da67b82" },
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
