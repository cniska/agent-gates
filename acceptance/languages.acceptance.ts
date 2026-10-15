import { afterEach, expect, test } from "bun:test";
import {
  commitAs,
  committing,
  git,
  install,
  PASSED,
  pathOf,
  refusedWith,
  removeScratch,
  writeFiles,
} from "./cli";
import {
  ALL_LANGUAGES,
  commentReply,
  commitFiles,
  commitStaged,
  gated,
  KEPT_DART,
  KEPT_JAVASCRIPT,
  KEPT_PYTHON,
  KEPT_RUST,
  KEPT_SHELL,
  KEPT_SQL,
  restart,
} from "./no-comments";

afterEach(removeScratch);

const ALL_KEPT = [KEPT_JAVASCRIPT, KEPT_DART, KEPT_SQL, KEPT_SHELL, KEPT_RUST, KEPT_PYTHON];

test("AC-26 keeps only the forms a tool reads, alone in their comment", () => {
  const dir = gated(ALL_LANGUAGES);
  expect(
    commitFiles(dir, {
      "k.ts":
        '#!/usr/bin/env node\n/// <reference types="node" />\n// agent-gate:no-comments:1\n// tool-gate:part:2\n// tool-gate:3\nexport const a = 1;\n',
      "k.dart": "#!/usr/bin/env dart\n// agent-gate:no-comments:1\nvoid main() {}\n",
      "k.sql": "-- agent-gate:no-comments:1\nselect 1;\n--> statement-breakpoint\nselect 2;\n",
      "k.sh": "#!/bin/sh\n# agent-gate:no-comments:1\necho hi\n",
      "k.rs": "#!/usr/bin/env rust-script\n// agent-gate:no-comments:1\nfn main() {}\n",
      "k.py": "#!/usr/bin/env python3\n# agent-gate:no-comments:1\nx = 1\n",
    }),
  ).toEqual(PASSED);

  expect(
    commitFiles(restart(dir), {
      "r.ts": [
        "#!/usr/bin/env node # runs it",
        '/// <reference types="node" /> for the types',
        "// agent-gate:no-comments:1 kept",
        "/* agent-gate:no-comments:1",
        "*/",
        "export const a = 1; // agent-gate:no-comments:1",
        "/** The answer. */",
        "// eslint-disable-next-line no-console",
        "// @ts-ignore",
        "// prettier-ignore",
        "export const b = 2;",
        "",
      ].join("\n"),
      "r.dart": "#!/usr/bin/env dart \\c\n/// The entry.\n// ignore: unused_local_variable\nvoid main() {}\n",
      "r.sql": "--> statement-breakpoint here\nselect 1;\n-- sqlfluff:noqa\nselect 2;\n",
      "r.sh": "#!/bin/sh # strict\n# shellcheck disable=SC2034\necho hi\n",
      "r.rs": "/// The entry.\n//! The crate.\n// agent-gate:no-comments:1 kept\nfn main() {}\n",
      "r.py": "# -*- coding: utf-8 -*-\nx = 1  # type: ignore\ny = 2  # noqa: E501\n",
    }),
  ).toEqual(
    refusedWith(
      commentReply(ALL_KEPT, [
        [
          "r.dart",
          ["1  #!/usr/bin/env dart \\c", "2  /// The entry.", "3  // ignore: unused_local_variable"],
        ],
        ["r.py", ["1  # -*- coding: utf-8 -*-", "2  # type: ignore", "3  # noqa: E501"]],
        ["r.rs", ["1  /// The entry.", "2  //! The crate.", "3  // agent-gate:no-comments:1 kept"]],
        ["r.sh", ["1  #!/bin/sh # strict", "2  # shellcheck disable=SC2034"]],
        ["r.sql", ["1  --> statement-breakpoint here", "3  -- sqlfluff:noqa"]],
        [
          "r.ts",
          [
            "1  #!/usr/bin/env node # runs it",
            '2  /// <reference types="node" /> for the types',
            "3  // agent-gate:no-comments:1 kept",
            "4  /* agent-gate:no-comments:1",
            "6  // agent-gate:no-comments:1",
            "7  /** The answer. */",
            "8  // eslint-disable-next-line no-console",
            "9  // @ts-ignore",
            "10  // prettier-ignore",
          ],
        ],
      ]),
    ),
  );
});

test("AC-27 reads comments where each language's tokenizer does", () => {
  const dir = gated(ALL_LANGUAGES);
  expect(
    commitFiles(dir, {
      "t.ts": [
        'export const s = "// not a comment";',
        `export const t = \`/* nor \${s} this */\`;`,
        "declare function dec(target: unknown): void;",
        "@dec export class A {}",
        "export @dec class B {}",
        "",
      ].join("\n"),
      "t.dart": "void main() {\n  var s = '// not';\n  var r = r'/* nor */';\n}\n",
      "t.sh": [
        'echo "# not a comment"',
        "echo it#s",
        `x="\${HOME#/}"`,
        'y=$(echo "# nor")',
        "cat <<EOF",
        "# inside a heredoc",
        "EOF",
        "",
      ].join("\n"),
      "t.sql": "select '-- not a comment';\nselect $$ (an aside -- text $$;\n",
      "t.rs":
        'fn main() {\n    let s = "// not";\n    let r = r#"/* nor */"#;\n}\n#[doc(hidden)]\nfn hidden() {}\n',
      "t.py": 'x = "# not a comment"\ny = f"{x} # nor"\n',
    }),
  ).toEqual(PASSED);

  expect(
    commitFiles(restart(dir), {
      "f.sql": "create function f() returns int as $$\n  select 1; -- inside\n$$ language sql;\n",
      "f.rs": '#[cfg_attr(test, doc = "Tested.")]\nfn tested() {}\n',
      "f.py": 'def f():\n    """Answer."""\n    return 1\n',
    }),
  ).toEqual(
    refusedWith(
      commentReply(
        [KEPT_SQL, KEPT_RUST, KEPT_PYTHON],
        [
          ["f.py", ['2  """Answer."""']],
          ["f.rs", ['1  #[cfg_attr(test, doc = "Tested.")]']],
          ["f.sql", ["2  -- inside"]],
        ],
      ),
    ),
  );
});

const SHELL_UTILITIES = ["sh", "sed", "tr", "head", "tail", "grep", "wc", "dirname", "od", "awk"];

test("AC-28 runs the hooks with git, a shell and node alone", () => {
  const dir = gated(["commit-subject", ...ALL_LANGUAGES], { "a.ts": "export const a = 1;\n" });
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
