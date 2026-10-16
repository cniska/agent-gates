import { GATE_NAMES, type GateName, noCommentsGate, type Part } from "./gate-parts";
import type { Language } from "./no-comments-languages";

export const HOOKS_DIR = ".githooks";

export const PRE_COMMIT_STEPS = `${HOOKS_DIR}/pre-commit.d`;

export const PRE_PUSH_STEPS = `${HOOKS_DIR}/pre-push.d`;

export const STEP_DIRS: readonly string[] = [PRE_COMMIT_STEPS, PRE_PUSH_STEPS];

export const WORKFLOWS_DIR = ".github/workflows";

export const PREPARE = `! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath ${HOOKS_DIR}`;

export const PAST_PREPARES: readonly string[] = [`git config core.hooksPath ${HOOKS_DIR}`];

export type FileState =
  | "installed"
  | "missing"
  | "behind"
  | "changed"
  | "ahead"
  | "not-executable"
  | "reconfigured"
  | "occupied";

export type WritableState = Exclude<FileState, "occupied">;

export const FILL_NAMES = ["command", "prefixes"] as const;

export type Fill = (typeof FILL_NAMES)[number];

export type Fills = { readonly [F in Fill]: string | null };

export function eachFill<T>(of: (fill: Fill) => T): Readonly<Record<Fill, T>> {
  return { command: of("command"), prefixes: of("prefixes") };
}

export const NO_FILLS: Fills = eachFill(() => null);

type FillSpec = {
  readonly gate: GateName;
  readonly flag: string;
  readonly placeholder: string;
  readonly example: string;
  readonly check: string;
  readonly pattern: { readonly matches: RegExp; readonly form: string } | null;
  readonly program: { readonly offPathEffect: string } | null;
  readonly unset: { readonly kind: "required" } | { readonly kind: "defaulted"; readonly detail: string };
};

export const FILLS: Readonly<Record<Fill, FillSpec>> = {
  command: {
    gate: "format",
    flag: "--command",
    placeholder: "<command>",
    example: "npm run lint:fix",
    check: "format command",
    pattern: null,
    program: { offPathEffect: ", so the format hook refuses every commit" },
    unset: { kind: "required" },
  },
  prefixes: {
    gate: "commit-subject",
    flag: "--prefixes",
    placeholder: "<a,b,c>",
    example: "feat,fix,docs",
    check: "commit prefixes",
    pattern: { matches: /^[a-z]+(,[a-z]+)*$/, form: "lowercase words joined by commas" },
    program: null,
    unset: { kind: "defaulted", detail: "none installed, so the gate allows its default set" },
  },
};

export function nameTheFill(fill: Fill): string {
  const { gate, flag, placeholder, example } = FILLS[fill];
  return `agent-gates install ${gate} ${flag} "${placeholder}", such as ${flag} "${example}"`;
}

type GateVersion = { readonly version: number; readonly sha256: string };

export type GateFile = {
  readonly part: Part;
  readonly source: string;
  readonly target: string;
  readonly executable: boolean;
  readonly fills: Fill | null;
  readonly versions: readonly [GateVersion, ...GateVersion[]];
};

const GITATTRIBUTES: GateFile = {
  part: "githooks",
  source: "gitattributes",
  target: `${HOOKS_DIR}/.gitattributes`,
  executable: false,
  fills: null,
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
  fills: null,
  versions: [
    { version: 1, sha256: "d5b3794f1b2c884f4ff3a9407059e436a01c5c190e7bc1cf44f581930653920f" },
    { version: 2, sha256: "dc99bf91ca9a05b7d3a50aeb1e4bf74eed8236e1a1c9aeeceb84d51fba2b6c73" },
  ],
};

const PRE_PUSH: GateFile = {
  part: "githooks",
  source: "pre-push",
  target: `${HOOKS_DIR}/pre-push`,
  executable: true,
  fills: null,
  versions: [{ version: 1, sha256: "443fe4074befc4de131324f78f78b12c5d2c746febb87f17bb43aa150a857cf9" }],
};

const JUDGE_PUSH: GateFile = {
  part: "githooks",
  source: "judge-push",
  target: `${HOOKS_DIR}/judge-push`,
  executable: false,
  fills: null,
  versions: [
    { version: 1, sha256: "96729bf4e237ca325315e1fe8f456d03b2b2705c501a4488fe7976b178f535eb" },
    { version: 2, sha256: "620f7d269ad6f3659d8f8ed8c83bdd639141b50a627ab4e6341467318b6f73dd" },
  ],
};

export const SCANNER_FILE: GateFile = {
  part: "no-comments",
  source: "no-comments/scan.cjs",
  target: `${HOOKS_DIR}/no-comments/scan.cjs`,
  executable: false,
  fills: null,
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
    { version: 21, sha256: "d03456acb428d0c89b384ba675ac5d09ee6b0b00e80b2c0def1818bdeeac40d8" },
    { version: 22, sha256: "722964462b7354334fe7fa3e0c505afb2424970a934593f3727d0f8d55a276c7" },
    { version: 23, sha256: "037e445e2ca241466bcbd98900bd5dbbd765ecf6d736880c71066d97ec913f7c" },
    { version: 24, sha256: "c4ecbb358448d994394f7a6eadc24d0e3d72588b801cc0615bb1325fc55e90a3" },
    { version: 25, sha256: "66c4de011c1abb5c22bf3cbbc89f9beaca9e7588ea47c45e2e62d189405f82fd" },
    { version: 26, sha256: "f77162148eb6575afd6a04b8667d6f998a308a035d561eb37ca89e1479b0791e" },
    { version: 27, sha256: "213db25faefcc3513f1ac10c83a0c02c0e6c757de0bd7ea8756e5a13753fa8fd" },
    { version: 28, sha256: "eab2f02cd65459e687ae9339a03f3af724749b41ff080f3a27cc7c1a0e901e77" },
    { version: 29, sha256: "6cb014d02ee91a109cd0176e293812b451d65089817438785d2e7653f25f5186" },
  ],
};

const NO_COMMENTS_SHARED: readonly GateFile[] = [
  {
    part: "no-comments",
    source: "no-comments/pre-commit",
    target: `${PRE_COMMIT_STEPS}/no-comments`,
    executable: true,
    fills: null,
    versions: [
      { version: 1, sha256: "138a8e75142f58bc1a09418964b8a9cbd7944fc516920d307e58e00dd2a5290c" },
      { version: 2, sha256: "f182a3518696f42433f24c131376f0851cb976982af89cf52e4e11aaacf98d55" },
    ],
  },
  {
    part: "no-comments",
    source: "no-comments/pre-push",
    target: `${PRE_PUSH_STEPS}/no-comments`,
    executable: true,
    fills: null,
    versions: [{ version: 1, sha256: "9ed4a0cfe0d573f9058c93c13cab4995c331b640c5704d61a269238576359448" }],
  },
  SCANNER_FILE,
  {
    part: "no-comments",
    source: "no-comments.yml",
    target: `${WORKFLOWS_DIR}/no-comments.yml`,
    executable: false,
    fills: null,
    versions: [
      { version: 1, sha256: "40c64a59e2409c91c2d07df092eeb9384811a991784e2f3300b8aa43e6c78dd9" },
      { version: 2, sha256: "3b83b0cbd4e92e31034e16bbc5d80bd285d41c0612c6ad3fb81239ffc99eb9a1" },
      { version: 3, sha256: "e226a011a732f4af4a218046de9df61ab64920ab242251e61a5dd889b1fa4246" },
      { version: 4, sha256: "a76f92319ca5213895528ab08cf71b4574b8be2146af931d65b412daef4214c5" },
    ],
  },
];

function adapterFile(language: Language, versions: GateFile["versions"]): GateFile {
  return {
    part: noCommentsGate(language),
    source: `no-comments/${language}.cjs`,
    target: `${HOOKS_DIR}/no-comments/${language}.cjs`,
    executable: false,
    fills: null,
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
    { version: 10, sha256: "6cf4f5d0899d9b8cb98749cda81c55fc5af97d6b0ed47ed1bf7cc0a40dea71c7" },
    { version: 11, sha256: "35abc16be9bbec3195f4e4ecaaead440c1f2dc5bfb0e0a14dbbc030ccee3335e" },
    { version: 12, sha256: "7a2e760147894b13c592647e434450e01b3dc82c14c610c66a6577a2bd8d6aae" },
    { version: 13, sha256: "478e6e927cfbcd8265f1f38d6fb97dcd1355bed9cd4f94af42d27951274b883b" },
    { version: 14, sha256: "d6387829d80f5eab43f1434a3da51682faa9aa38b5a84f4f7583a2b1dba9563d" },
    { version: 15, sha256: "3069319c98e761bef077ed4d2cb22eb1d5b58351deb9e3b26e86f435d9bf82b6" },
    { version: 16, sha256: "97122de937f2bddbf93bab52bf2a73f35cf7a2682456bd8b615ac3bb0dfbeb34" },
    { version: 17, sha256: "104e652efe9d20fdb4039a55bc5e0e5ceadd38dbb1a433d3414e8a73796637b0" },
    { version: 18, sha256: "a816957029a531e031f48d084cdffb94eac0f5d793ac886e06b21a6f0a302898" },
    { version: 19, sha256: "f6e877cc5eb4c4e4b543043b25901688a63c6f48fab5492915395c2c7c4710ad" },
    { version: 20, sha256: "d319a53d948bce7a70b52fec227c47c95e97b85ab2fad691f4c84d5dfcd178be" },
    { version: 21, sha256: "bb79226d4ab84d42b8652ad730fa9c6ec25ae60274f3991dcc0a13d63e109a07" },
    { version: 22, sha256: "792d88973ce2aa147deab471f74b7bbfcdde03262ea650c35275fb1272898cc5" },
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
    { version: 12, sha256: "6df5549070cb145ceb765334315a0d107fcf124f224410785f1a34f59e83c33a" },
    { version: 13, sha256: "f0187d5816e381edc9181b7f10243dfda243fe2424bb2c41035e45ae303a3c8d" },
    { version: 14, sha256: "0d6cc04825fbd9045975e67ad36e7b3cf1884a0382bd0d9244deb0c810199c2b" },
    { version: 15, sha256: "6478de2df0bf3ef55c38de082eb2295cea22d3fe3e4dc82501270fec056a60a9" },
    { version: 16, sha256: "afbeb7aace14606f714b293003354eb4367a3aedf4af5bfc4e753d96b95c6435" },
    { version: 17, sha256: "27eb99e3392c515eee46e0bc383fe2a75a65e357f666a731c817fc78e21b5cec" },
    { version: 18, sha256: "cead83858a0d93d1305c28597434136f0468406cf1db5a60338e3266c636b2ac" },
    { version: 19, sha256: "01288f901ae9bb765b9df167fdc7f17c40ba1c27a545f55a0b722e92733f5345" },
    { version: 20, sha256: "cb5592bb927750ba89d90fea28f62192dca53ae4898ac8c8171c76a70dd4e963" },
    { version: 21, sha256: "01d227c3eb564602895af3b9fc2268e4d856988136d687d3a24d91773dc354cd" },
    { version: 22, sha256: "66c089ae169af8176d1b8fcbccd89ec2a304571649f9b8ef584ab7f0ab0c519c" },
    { version: 23, sha256: "48db2e6b5edadc1c1450d069c1054ed0481520ea1b5c6b1e1efd5278e503759d" },
    { version: 24, sha256: "15ecd8dd8aade2868122ea923d991168c846d8967c5a5ada55822f5628c7f94b" },
    { version: 25, sha256: "db3aee68ded72f0c25a44d19639927c0f51f70a8ffc3d648880c21243adde9e2" },
    { version: 26, sha256: "5dfe642be73be4d56a124e42cd8720b6a8ad9d0e213e8ffb0b42bac9b8c99460" },
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
    { version: 13, sha256: "8dc6894ee942a61a0e47667554580944c4fbef5b2a370d8ce9c6ece5b8229f62" },
    { version: 14, sha256: "249edf26452c328c7bd583fb685d7790a388da5c2cc1981a02d7d626ef97c304" },
    { version: 15, sha256: "725b1697659a42994074e4514b611e24c7e06b74363459e7404a761b59b816ef" },
    { version: 16, sha256: "bf515793327108c0a5166edec4584daca771df024429037a296ff22c0ca116cf" },
    { version: 17, sha256: "8872a17e172fdc64c86cd9f6a2658cd449b8ff5a33aa131b5877a0625dc1cf05" },
    { version: 18, sha256: "21aa97e07e7a70a3fa51ba78b62a0b6f7b72b52b55d726e1e5dfcc629b904cb0" },
    { version: 19, sha256: "37c20090cf2cc6502849798d25881a446de380549153556f577ce3c87aa094bc" },
    { version: 20, sha256: "82eaf439c32f895bff74715063e08ec75db563751669572577c3dbdab34102a2" },
    { version: 21, sha256: "95e2f7b64741f667c3187ed8ea8efed6756127f18def3cfd53f431f330b19caa" },
    { version: 22, sha256: "65e12512a44fe086d0438398b6eaa3524346afbc3c3615ff940b89186e932a47" },
    { version: 23, sha256: "4d793b0a2594f01799f817e31f9909e384b475bdd9e5ece85a737a74ff03c3e5" },
    { version: 24, sha256: "76a8b638e92893548b58ee7f587f33733fdcb8fec94df7a7cd3e436e6d54cf1a" },
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
    { version: 12, sha256: "2020535dc6549c536d1e7bd9219c7abd35fef944a9ce61a38a8217ebaf09e8ea" },
    { version: 13, sha256: "9d09cb3ad8cbcd9708518cb46292d959eb6014420830e2b1e194e7a498cccb68" },
    { version: 14, sha256: "9d3c9e344cbb0a2fa6eedfb22937fb4360e621985d88c127b0800396fdf642b0" },
    { version: 15, sha256: "5f1ac177c1cb004a0a39d952d73beef1a7773c7514c26de4848bc8938b8a7d40" },
    { version: 16, sha256: "1940cecfdd301c8c2c56b40d4bfafc2f6db3c558c608a089494dd755f0993a7a" },
    { version: 17, sha256: "9902fc1e98d26301b83c350942e2433f5b48cd5ac3fcd349f985b0cb73d0e8b5" },
    { version: 18, sha256: "83d82f13d20bda123ce85a115c8285c05679c6ee647d4feb866396a75f5a5ef5" },
    { version: 19, sha256: "b1342ff62884afa3e1449f67c090bcae378207dfd95e561b4c443d545c7dafa6" },
    { version: 20, sha256: "f78ed2bb9a8c844393de41f2c92eadd69827269ec13b563d25bdaf90c75bf291" },
    { version: 21, sha256: "357b8cbfd588966ac3b39ed5370ae7a213d512034c2e69ff1df89b45ac899dcb" },
    { version: 22, sha256: "f0bc24260eee88f3676618cb5b7f1c43b8be4b6ec8a0b42fff2e09566644d2e9" },
    { version: 23, sha256: "8c79b16e593b9065634c1cc7e1a2ad1f642d9f4a467178e46a49e61a4c2c54eb" },
    { version: 24, sha256: "0f9d795b4ad2f71db6e5a3b1486a9b7729538698bf204785c16bc6ba7a22f44a" },
    { version: 25, sha256: "2fe12b12e07092303fe57405faea198670f807e0679f91ae0b3a48c4197109d6" },
    { version: 26, sha256: "64559a93d1fa4bb054508e2048642bb410d49ce2f9b05239a3cc34263ce45993" },
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
    { version: 10, sha256: "587f80d13aa723c2e2e24f7cfdea45c608535baaf1c1fafc88988e0a4bc1f109" },
    { version: 11, sha256: "a42e2cc7b173d74cba2e8c6619add1b98f717cdf25b273d415d185440d48b6ad" },
    { version: 12, sha256: "0dd70404c4efe5800d7b1ae0f10b38c5f5727bfbb511a0b9455ddb270881c857" },
    { version: 13, sha256: "bc2048b6439126a4cabdc24f84433cc87d76e835854f77b64be23bf49ff94065" },
    { version: 14, sha256: "45a014937d4c2a3d57bc1ca1507329199790649752e02f42c8e972eb9d8aff6b" },
    { version: 15, sha256: "81b4955dd987ef2f12b410686a410d490f68afe19ebb0ad56ee298e9bf5800fe" },
    { version: 16, sha256: "60f2a638d86c3e904a2a203252d282bd8fb18c27e88a632738296c3b5d0652f8" },
    { version: 17, sha256: "8983326f5a6c148461a33489b54ec345f3c40acabf335265f38a92be3ce5f1cf" },
    { version: 18, sha256: "d0a2ade99c60f50ae6c0af68002abb98f3bdd9b9a4419d78ae742ebcd66ef889" },
    { version: 19, sha256: "8f2843dbf1820d866d26d77e9fce9ad482bf260afcc96da9deef2dc9bf18b51b" },
    { version: 20, sha256: "fadf4064f8cac619f489aedecb32384afb8663658e7637e0ccf0c76d425f2a71" },
    { version: 21, sha256: "7abdd85846753ea9fa8ba4dab1c0b77466770c31e384d8e19e7f45ca2dea75a1" },
    { version: 22, sha256: "876fdeb06ffb37ffab1bf1306d31522324517f1ef9da982a7b55d8520349af82" },
    { version: 23, sha256: "94bb4f4b5ceee5abc706b6359e8532a8becc5344dc6ff7fd29cdb3d1d569b124" },
    { version: 24, sha256: "6332a2e791e78ec1474d7aaab4cd018f29ab4a8aea7b3cc6a7a8e2ec37c96819" },
    { version: 25, sha256: "cbb9b5aa9dd7c65e35a6fb19971d6d3e8d5642f3c002ba3f550a868d1cf4ab21" },
  ]),
  python: adapterFile("python", [
    { version: 1, sha256: "0a9e1622e9cbb6d697e50947de8488666247a3ba7505c986eff90bdb63e08152" },
    { version: 2, sha256: "4575c86e1955e6ea7788066b4b0ad382ea702e4e55b6adb21f124dc9cf8e1a35" },
    { version: 3, sha256: "22c79d3f56e2ec8ee574e0062785d35a45f560fbb197aa09641a8e7290ced0cc" },
    { version: 4, sha256: "7156ebbf6d38f09d4066d16a801adefd39e639efe14c08613a5a480bdbc4c73d" },
    { version: 5, sha256: "bdb930b65183dd22a6476614a31fb2c4e90fd10a5dcca3f21463581f70938a03" },
    { version: 6, sha256: "804bf24beb8b9a5b6f3d1f2d3932a49b0d668b899469477e8a4b8471c8752c62" },
    { version: 7, sha256: "710be855e949f42260e6ad9ce15a6a1cf6e244ea079af211d542a7eeb786f738" },
    { version: 8, sha256: "fd46dd82209c5ffa0c56e9a0a293b1e925a076c119a5f7ac382b2381937e87c2" },
    { version: 9, sha256: "2a4afa1830c295fa00556f814f54ad98d800b3301e46262454f89d90466de82a" },
    { version: 10, sha256: "e8d06406d193bdaf0d4a49d59a7394e055b0326f216f6d6d0223baaf9e1007ed" },
    { version: 11, sha256: "3350771460f2a27b2f22840793ec170e2b53ea2fbd1b01b5394486eabc121d04" },
    { version: 12, sha256: "04b78f897cd42960a884cad5ab2b3a28a52babc698734e9dfab57fd66aa13c59" },
    { version: 13, sha256: "5a2935b1955f99eb30ca8b435c4656290db4b2a448de547ab6b676c7706e52f9" },
    { version: 14, sha256: "5e98994ff75d8606df7b0559c88eae8ef7e655abe9fb4b5e0a04bfb077bf1387" },
    { version: 15, sha256: "f705ea66671db73f6093f3e5842253b10c41e5bab5a83d9b2aac2e82bc2e104a" },
    { version: 16, sha256: "6244859862034a971f2861492540de132de144c0855a5b80a7579ddf6043b03f" },
    { version: 17, sha256: "44bcecae2a94e194d8a06335e48e057cbd92b3a54e21e63de54eb107622c441e" },
    { version: 18, sha256: "e4b064d4a77ca349bebd8e544fc3457f9420235d920ff8a25b2a65ad458a5bea" },
    { version: 19, sha256: "6214b0daf7ac833a243a1ebfa80311ad6f8e72f4fefd243a1183463ec2274092" },
    { version: 20, sha256: "954b7f0325fc67ee84a5db52f44a1e532720a1d7a46f1f245e756f2f7644229d" },
    { version: 21, sha256: "3df112082176292836dc3a3ff861bb492f1d78c5babc013b077850c5e006482d" },
    { version: 22, sha256: "865076364af3c99e147b2d788794b78ad155ea6947d3227ee53c3a1ce0acae77" },
  ]),
};

export const NO_SECRETS_SCANNER: GateFile = {
  part: "no-secrets",
  source: "no-secrets/scan.cjs",
  target: `${HOOKS_DIR}/no-secrets/scan.cjs`,
  executable: false,
  fills: null,
  versions: [
    { version: 1, sha256: "54ab03a3e26aaabf319d6748ac135a2ab336265a439b68e1353e28d7fa1fe821" },
    { version: 2, sha256: "981be0e5a81d118d253673eafb119a81d92ca99fa33963c859c77b325e4f3605" },
    { version: 3, sha256: "8ea572f418a386b6bcf56abf160d11434d53a4888822bcd8f3d77b446107c2fe" },
  ],
};

const NO_SECRETS_FILES: readonly GateFile[] = [
  GITATTRIBUTES,
  PRE_COMMIT,
  PRE_PUSH,
  {
    part: "no-secrets",
    source: "no-secrets/pre-commit",
    target: `${PRE_COMMIT_STEPS}/no-secrets`,
    executable: true,
    fills: null,
    versions: [{ version: 1, sha256: "81a38b031c8ca267d651e1f647e25c9cc72d685c6b8a6e0f6af9a61214a877c1" }],
  },
  {
    part: "no-secrets",
    source: "no-secrets/pre-push",
    target: `${PRE_PUSH_STEPS}/no-secrets`,
    executable: true,
    fills: null,
    versions: [{ version: 1, sha256: "a19cb8ac14b231b624d51653bef81b4a23d2475c11fc0e71ee5a175ee9918282" }],
  },
  NO_SECRETS_SCANNER,
  {
    part: "no-secrets",
    source: "no-secrets.yml",
    target: `${WORKFLOWS_DIR}/no-secrets.yml`,
    executable: false,
    fills: null,
    versions: [{ version: 1, sha256: "08b8f010ec98a913fda1ae66590dfe581af4ede474c42d4a8bc8e74122998afd" }],
  },
  JUDGE_PUSH,
];

function noCommentsFiles(language: Language): readonly GateFile[] {
  return [GITATTRIBUTES, PRE_COMMIT, PRE_PUSH, ...NO_COMMENTS_SHARED, JUDGE_PUSH, ADAPTER_FILES[language]];
}

export const GATES: Readonly<Record<GateName, readonly GateFile[]>> = {
  "commit-subject": [
    {
      part: "commit-subject",
      source: "commit-msg",
      target: `${HOOKS_DIR}/commit-msg`,
      executable: true,
      fills: "prefixes",
      versions: [
        { version: 1, sha256: "73ec5976bae1e77235a86ee02051f2d60c4abc0fe2d9d6dfd00e9599cfdafa46" },
        { version: 2, sha256: "79602ae373e09db09960aa1aa25cb36df35ed91a8c6780499e4434f082943d41" },
        { version: 3, sha256: "946e91a80c62699b564b92e731cd3fa84caccbaa55bac450a85e7823232f5629" },
      ],
    },
    {
      part: "commit-subject",
      source: "commits.yml",
      target: `${WORKFLOWS_DIR}/commits.yml`,
      executable: false,
      fills: null,
      versions: [
        { version: 1, sha256: "cba3046993d4ca84942aa37b60c17cf77af0123f1a6152482db0301a933587ba" },
        { version: 2, sha256: "f5863ec0ebb55f68779bd8f5693406178e5adbfb1dfbe09db12550286487656f" },
        { version: 3, sha256: "f28727dbb2e815970fe0e9233c753274cf66c04ae8ac608da31d433e97c3df87" },
        { version: 4, sha256: "b9cfeeffce066c96a0982c4d29f7832ff9148f5527349ae16602e5f484d59d8d" },
      ],
    },
    GITATTRIBUTES,
    PRE_PUSH,
    {
      part: "commit-subject",
      source: "commit-subject/pre-push",
      target: `${PRE_PUSH_STEPS}/commit-subject`,
      executable: true,
      fills: null,
      versions: [{ version: 1, sha256: "eba04ee129872ff8b8305b51a0679d540420e71ee7f94361ac880c6910b0b5f6" }],
    },
    JUDGE_PUSH,
  ],
  format: [
    {
      part: "format",
      source: "format/pre-commit",
      target: `${PRE_COMMIT_STEPS}/format`,
      executable: true,
      fills: "command",
      versions: [
        { version: 1, sha256: "b8f15bc902e2269640aae3022e919b8822fc85340fbd42c1f28c2bb028a2451d" },
        { version: 2, sha256: "761da3bc5de74f1b9204a36f9581fed6196e720cd57b3c9ae207d9f32681adbe" },
        { version: 3, sha256: "aa8b4000beb086ca52091754f1998bd186be4bf781720ccf9f023af2e0040fa6" },
      ],
    },
    GITATTRIBUTES,
    PRE_COMMIT,
  ],
  "no-comments-javascript": noCommentsFiles("javascript"),
  "no-comments-dart": noCommentsFiles("dart"),
  "no-comments-sql": noCommentsFiles("sql"),
  "no-comments-shell": noCommentsFiles("shell"),
  "no-comments-rust": noCommentsFiles("rust"),
  "no-comments-python": noCommentsFiles("python"),
  "no-secrets": NO_SECRETS_FILES,
};

export const EACH_TRACKED_LANGUAGE = "no-comments";

const GATE_CHOICES = [...GATE_NAMES, `${EACH_TRACKED_LANGUAGE} (each language the tracked files hold)`].join(
  ", ",
);

export const INSTALL_USAGE = `agent-gates install [<gate>] [${FILLS.command.flag} <format command>] [${FILLS.prefixes.flag} ${FILLS.prefixes.placeholder}], choosing from ${GATE_CHOICES}`;

export const INSTALL_GATES = `agent-gates install <gate>, once per gate, choosing from ${GATE_CHOICES}`;

export const REINSTALL = "agent-gates install";
