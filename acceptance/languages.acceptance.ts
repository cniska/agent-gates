import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  commitAs,
  commitFiles,
  commitStaged,
  committing,
  gated,
  git,
  install,
  lines,
  PASSED,
  pathOf,
  refusedWith,
  removeScratchDirs,
  restart,
  writeFiles,
} from "./cli";
import {
  ALL_LANGUAGES,
  commentReply,
  KEEP_FILE,
  KEPT_DART,
  KEPT_JAVASCRIPT,
  KEPT_PYTHON,
  KEPT_RUST,
  KEPT_SQL,
  KEPT_SWIFT,
  KEPT_YAML,
  KEPT_YAML_BY_INSTALL,
} from "./no-comments";

afterEach(removeScratchDirs);

const ALL_NONE = [
  KEPT_JAVASCRIPT,
  KEPT_DART,
  KEPT_SQL,
  "kept in shell: none",
  KEPT_RUST,
  KEPT_PYTHON,
  KEPT_YAML,
  KEPT_SWIFT,
];

const KEEP = lines([
  "shell # agent-gate:[a-z-]+:[0-9]+",
  'javascript /// <reference types="[a-z]+" />',
  "javascript // agent-gate:[a-z-]+:[0-9]+",
  "dart // agent-gate:[a-z-]+:[0-9]+",
  "sql -- agent-gate:[a-z-]+:[0-9]+",
  "sql --> statement-breakpoint",
  "rust // agent-gate:[a-z-]+:[0-9]+",
  "python # agent-gate:[a-z-]+:[0-9]+",
  "yaml # agent-gate:[a-z-]+:[0-9]+",
  "swift // agent-gate:[a-z-]+:[0-9]+",
]);

const KEPT_BY_KEEP = [
  'kept in JavaScript and TypeScript: `/// <reference types="[a-z]+" />`, `// agent-gate:[a-z-]+:[0-9]+`',
  "kept in Dart: `// agent-gate:[a-z-]+:[0-9]+`",
  "kept in SQL: `-- agent-gate:[a-z-]+:[0-9]+`, `--> statement-breakpoint`",
  "kept in shell: `# agent-gate:[a-z-]+:[0-9]+`",
  "kept in Rust: `// agent-gate:[a-z-]+:[0-9]+`",
  "kept in Python: `# agent-gate:[a-z-]+:[0-9]+`",
  "kept in YAML: `# agent-gate:[a-z-]+:[0-9]+`",
  "kept in Swift: `// agent-gate:[a-z-]+:[0-9]+`",
];

const KEPT_FILES = {
  "k.ts":
    '#!/usr/bin/env node\n/// <reference types="node" />\n// agent-gate:no-comments:1\nexport const a = 1;\n',
  "k.dart": "#!/usr/bin/env dart\n// agent-gate:no-comments:1\nvoid main() {}\n",
  "k.sql": "-- agent-gate:no-comments:1\nselect 1;\n--> statement-breakpoint\nselect 2;\n",
  "k.sh": "#!/bin/sh\n# agent-gate:no-comments:1\necho hi\n",
  "k.rs": "#!/usr/bin/env rust-script\n// agent-gate:no-comments:1\nfn main() {}\n",
  "k.py": "#!/usr/bin/env python3\n# agent-gate:no-comments:1\nx = 1\n",
  "k.yml": "# agent-gate:no-comments:1\na: 1\n",
  "k.swift": "#!/usr/bin/env swift\n// agent-gate:no-comments:1\nprint(1)\n",
};

test("AC-26 keeps a comment only through a .no-comments-keep pattern of its language", () => {
  const dir = gated(ALL_LANGUAGES);
  expect(commitFiles(dir, { [KEEP_FILE]: KEEP, ...KEPT_FILES })).toEqual(PASSED);

  expect(
    commitFiles(restart(dir), {
      "r.ts": lines([
        "#!/usr/bin/env node # runs it",
        '/// <reference types="node" /> for the types',
        "// agent-gate:no-comments:1 kept",
        "/* agent-gate:no-comments:1",
        "*/",
        "/** The answer. */",
        "// eslint-disable-next-line no-console",
        "// @ts-ignore",
        "// prettier-ignore",
        "export const b = 2;",
      ]),
      "r.dart": "#!/usr/bin/env dart \\c\n/// The entry.\n// ignore: unused_local_variable\nvoid main() {}\n",
      "r.sql": "--> statement-breakpoint here\nselect 1;\n-- sqlfluff:noqa\nselect 2;\n",
      "r.sh": "#!/bin/sh # strict\n# shellcheck disable=SC2034\necho hi\n",
      "r.rs": "/// The entry.\n//! The crate.\n// agent-gate:no-comments:1 kept\nfn main() {}\n",
      "r.py": "# -*- coding: utf-8 -*-\nx = 1  # type: ignore\ny = 2  # noqa: E501\n",
      "r.swift": lines([
        "/// The entry.",
        "/** A doc block. */",
        "// agent-gate:no-comments:1 kept",
        "/* agent-gate:no-comments:1",
        "*/",
        "// swiftlint:disable:next force_cast",
        "let a = 1",
      ]),
      "r.yml":
        "# yaml-language-server: $schema=a.json\n# agent-gate:no-comments:1 kept\nb: 2 # prettier-ignore\n",
    }),
  ).toEqual(
    refusedWith(
      commentReply(KEPT_BY_KEEP, [
        [
          "r.dart",
          ["1  #!/usr/bin/env dart \\c", "2  /// The entry.", "3  // ignore: unused_local_variable"],
        ],
        ["r.py", ["1  # -*- coding: utf-8 -*-", "2  # type: ignore", "3  # noqa: E501"]],
        ["r.rs", ["1  /// The entry.", "2  //! The crate.", "3  // agent-gate:no-comments:1 kept"]],
        ["r.sh", ["1  #!/bin/sh # strict", "2  # shellcheck disable=SC2034"]],
        ["r.sql", ["1  --> statement-breakpoint here", "3  -- sqlfluff:noqa"]],
        [
          "r.swift",
          [
            "1  /// The entry.",
            "2  /** A doc block. */",
            "3  // agent-gate:no-comments:1 kept",
            "4  /* agent-gate:no-comments:1",
            "6  // swiftlint:disable:next force_cast",
          ],
        ],
        [
          "r.ts",
          [
            "1  #!/usr/bin/env node # runs it",
            '2  /// <reference types="node" /> for the types',
            "3  // agent-gate:no-comments:1 kept",
            "4  /* agent-gate:no-comments:1",
            "6  /** The answer. */",
            "7  // eslint-disable-next-line no-console",
            "8  // @ts-ignore",
            "9  // prettier-ignore",
          ],
        ],
        [
          "r.yml",
          [
            "1  # yaml-language-server: $schema=a.json",
            "2  # agent-gate:no-comments:1 kept",
            "3  # prettier-ignore",
          ],
        ],
      ]),
    ),
  );

  restart(dir, "HEAD~1");
  rmSync(join(dir, KEEP_FILE));
  expect(commitFiles(dir, KEPT_FILES)).toEqual(
    refusedWith(
      commentReply(ALL_NONE, [
        ["k.dart", ["2  // agent-gate:no-comments:1"]],
        ["k.py", ["2  # agent-gate:no-comments:1"]],
        ["k.rs", ["2  // agent-gate:no-comments:1"]],
        ["k.sh", ["2  # agent-gate:no-comments:1"]],
        ["k.sql", ["1  -- agent-gate:no-comments:1", "3  --> statement-breakpoint"]],
        ["k.swift", ["2  // agent-gate:no-comments:1"]],
        ["k.ts", ['2  /// <reference types="node" />', "3  // agent-gate:no-comments:1"]],
        ["k.yml", ["1  # agent-gate:no-comments:1"]],
      ]),
    ),
  );
});

test("AC-27 reads comments where each language's tokenizer does", () => {
  const dir = gated(ALL_LANGUAGES);
  expect(
    commitFiles(dir, {
      "t.ts": lines([
        'export const s = "// not a comment";',
        `export const t = \`/* nor \${s} this */\`;`,
        "declare function dec(target: unknown): void;",
        "@dec export class A {}",
        "export @dec class B {}",
      ]),
      "t.dart": "void main() {\n  var s = '// not';\n  var r = r'/* nor */';\n}\n",
      "t.sh": lines([
        'echo "# not a comment"',
        "echo it#s",
        `x="\${HOME#/}"`,
        'y=$(echo "# nor")',
        "cat <<EOF",
        "# inside a heredoc",
        "EOF",
      ]),
      "t.sql": "select '-- not a comment';\nselect $$ (an aside -- text $$;\n",
      "t.rs":
        'fn main() {\n    let s = "// not";\n    let r = r#"/* nor */"#;\n}\n#[doc(hidden)]\nfn hidden() {}\n',
      "t.py": 'x = "# not a comment"\ny = f"{x} # nor"\n',
      "t.swift": lines([
        'let s = "// not a comment"',
        'let t = "\\(s.count + 1) /* nor this */"',
        'let r = #"raw \\" // still text"#',
        'let m = """',
        "  /* inside a multi-line string */",
        '  """',
        "let u = #/https?:\\/\\/x/#",
        "let v = /a\\/\\//",
        "let w = 6 / 3 / 2",
      ]),
    }),
  ).toEqual(PASSED);

  expect(
    commitFiles(restart(dir), {
      "f.sql": "create function f() returns int as $$\n  select 1; -- inside\n$$ language sql;\n",
      "f.rs": '#[cfg_attr(test, doc = "Tested.")]\nfn tested() {}\n',
      "f.py": 'def f():\n    """Answer."""\n    return 1\n',
      "f.yml": 'q: "a # not"\nrun: |\n  echo # not\nlist:\n  # in a sequence\n  - a # after\n',
      "f.swift": 'let t = "\\(s.count /* in the interpolation */ + 1) // not"\n',
    }),
  ).toEqual(
    refusedWith(
      commentReply(
        [KEPT_SQL, KEPT_RUST, KEPT_PYTHON, KEPT_YAML_BY_INSTALL, KEPT_SWIFT],
        [
          ["f.py", ['2  """Answer."""']],
          ["f.rs", ['1  #[cfg_attr(test, doc = "Tested.")]']],
          ["f.sql", ["2  -- inside"]],
          ["f.swift", ["1  /* in the interpolation */"]],
          ["f.yml", ["5  # in a sequence", "6  # after"]],
        ],
      ),
    ),
  );
});

const SHELL_UTILITIES = ["sh", "sed", "tr", "head", "tail", "grep", "wc", "dirname", "od", "awk"];

test("AC-28 runs the hooks with git, a shell and node alone", () => {
  const dir = gated(["commit-subject", ...ALL_LANGUAGES, "no-secrets", "pinned-actions"], {
    "a.ts": "export const a = 1;\n",
  });
  install(dir, ["format", "--command", "true"]);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: format");
  const bare = { PATH: pathOf(["git", "node", ...SHELL_UTILITIES]) };

  writeFiles(dir, { "a.ts": "export const a = 2;\n" });
  git(dir, ["add", "-A"]);
  expect(committing(dir, ["-q", "-m", "Change a"], bare)).toEqual(
    refusedWith(
      "commit-msg: subject is not a Conventional Commit (type(scope): what changed); types: build,chore,ci,docs,feat,fix,perf,refactor,revert,style,test.\n  got: Change a\n",
    ),
  );
  expect(commitStaged(dir, [], bare)).toEqual(PASSED);

  writeFiles(dir, { "a.ts": "export const a = 3; // three\n" });
  git(dir, ["add", "-A"]);
  expect(commitStaged(dir, [], bare)).toEqual(
    refusedWith(commentReply([KEPT_JAVASCRIPT], [["a.ts", ["1  // three"]]])),
  );
});
