import type { CommentsOf } from "./no-comments-languages";
import { SHEBANG_PREFIX } from "./no-comments-route";
import {
  type Lexed,
  lineEnd,
  refusedComments,
  type Span,
  type Stopped,
  unterminated,
} from "./no-comments-spans";

const SHELLCHECK_DIRECTIVE = /^#\s*shellcheck\s/;

const BLANKS = new Set([" ", "\t"]);

const WORD_ENDS = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);

const KEEPS_COMMAND_POSITION = new Set([
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "{",
  "!",
  "time",
]);

const REGEX_OPERATOR = "=~";

const LINE_CONTINUATION = "\\\n";

const SPECIAL_PARAMETER = /^[#$?!@*\-0-9]$/;

const CASE_TERMINATOR = /^;;&?|^;&/;

const LEADING_TABS = /^\t+/;

const BACKTICK_ESCAPES = { unquoted: "\\`$", double: '\\`$"', heredoc: "\\`$" } as const;

type Quoting = keyof typeof BACKTICK_ESCAPES;

type Heredoc = {
  readonly start: number;
  readonly delimiter: string;
  readonly expands: boolean;
  readonly stripsTabs: boolean;
};

type CaseState = "subject" | "in" | "pattern" | "body";

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  const pending: Heredoc[] = [];
  let at = 0;

  function comment(): void {
    const start = at;
    at = lineEnd(text, at);
    spans.push({ start, end: at });
  }

  function singleQuoted(): Stopped | null {
    const close = text.indexOf("'", at + 1);
    if (close < 0) return unterminated(at, "quote");
    at = close + 1;
    return null;
  }

  function ansiQuoted(): Stopped | null {
    const start = at;
    at += 2;
    while (at < text.length) {
      const char = text[at];
      if (char === "\\") at += 2;
      else if (char === "'") {
        at++;
        return null;
      } else at++;
    }
    return unterminated(start, "quote");
  }

  function doubleQuoted(): Stopped | null {
    const start = at;
    at++;
    while (at < text.length) {
      if (text[at] === '"') {
        at++;
        return null;
      }
      const stopped = expansion("double");
      if (stopped !== null) return stopped;
    }
    return unterminated(start, "quote");
  }

  function backticked(quoting: Quoting): Stopped | null {
    const start = at + 1;
    let end = start;
    while (end < text.length && text[end] !== "`") end += text[end] === "\\" ? 2 : 1;
    if (end >= text.length) return unterminated(at, "backquote");
    const offsets: number[] = [];
    let inner = "";
    for (let index = start; index < end; index++) {
      if (text[index] === "\\" && BACKTICK_ESCAPES[quoting].includes(text[index + 1] ?? "")) index++;
      offsets.push(index);
      inner += text[index];
    }
    const nested = commentSpans(inner);
    if (nested.kind === "stopped") return { ...nested, at: offsets[nested.at] ?? end };
    for (const span of nested.spans)
      spans.push({ start: offsets[span.start] ?? end, end: (offsets[span.end - 1] ?? end) + 1 });
    at = end + 1;
    return null;
  }

  function expansion(quoting: Quoting): Stopped | null {
    const char = text[at];
    if (char === "\\") at += 2;
    else if (char === "$") return dollar(quoting);
    else if (char === "`") return backticked(quoting);
    else at++;
    return null;
  }

  function quotedOrExpansion(quoting: Quoting): Stopped | null {
    const char = text[at];
    if (char === "'" && quoting === "unquoted") return singleQuoted();
    if (char === '"' && quoting !== "heredoc") return doubleQuoted();
    return expansion(quoting);
  }

  function braced(quoting: Quoting): Stopped | null {
    const start = at;
    while (at < text.length) {
      if (text[at] === "}") {
        at++;
        return null;
      }
      const stopped = quotedOrExpansion(quoting);
      if (stopped !== null) return stopped;
    }
    return unterminated(start, "parameter expansion");
  }

  function arithmetic(open: string, close: string): Stopped | null {
    const start = at;
    let depth = 0;
    while (at < text.length) {
      const char = text[at];
      if (depth === 0 && text.startsWith(close, at)) {
        at += close.length;
        return null;
      }
      if (char === open) {
        depth++;
        at++;
      } else if (char === close[0]) {
        depth--;
        at++;
      } else {
        const stopped = quotedOrExpansion("unquoted");
        if (stopped !== null) return stopped;
      }
    }
    return unterminated(start, "arithmetic expansion");
  }

  function dollar(quoting: Quoting): Stopped | null {
    const next = text[at + 1];
    if (next === "'" && quoting === "unquoted") return ansiQuoted();
    if (text.startsWith("$((", at)) {
      at += 3;
      return arithmetic("(", "))");
    }
    if (next === "(") {
      at += 2;
      return code(true);
    }
    if (next === "{") {
      at += 2;
      return braced(quoting);
    }
    if (next === "[") {
      at += 2;
      return arithmetic("[", "]");
    }
    at += SPECIAL_PARAMETER.test(next ?? "") ? 2 : 1;
    return null;
  }

  function word(): string | Stopped {
    const start = at;
    while (at < text.length && !WORD_ENDS.has(text[at] ?? "")) {
      const stopped = quotedOrExpansion("unquoted");
      if (stopped !== null) return stopped;
    }
    return text.slice(start, at);
  }

  function heredocOperator(): void {
    const start = at;
    const stripsTabs = text[at] === "-";
    if (stripsTabs) at++;
    while (BLANKS.has(text[at] ?? "")) at++;
    let delimiter = "";
    let quoted = false;
    while (at < text.length && !WORD_ENDS.has(text[at] ?? "")) {
      const char = text[at] ?? "";
      const close = char === "'" || char === '"' ? text.indexOf(char, at + 1) : -1;
      if (close >= 0) {
        delimiter += text.slice(at + 1, close);
        quoted = true;
        at = close + 1;
      } else if (char === "\\") {
        delimiter += text[at + 1] ?? "";
        quoted = true;
        at += 2;
      } else {
        delimiter += char;
        at++;
      }
    }
    if (delimiter !== "") pending.push({ start, delimiter, expands: !quoted, stripsTabs });
  }

  function expandedLine(): Stopped | null {
    while (at < text.length) {
      if (text[at] === "\n") {
        at++;
        return null;
      }
      const stopped = expansion("heredoc");
      if (stopped !== null) return stopped;
    }
    return null;
  }

  function heredocBodies(): Stopped | null {
    for (const { start, delimiter, expands, stripsTabs } of pending.splice(0)) {
      for (;;) {
        if (at >= text.length) return unterminated(start, "heredoc");
        const end = lineEnd(text, at);
        const line = text.slice(at, end);
        if ((stripsTabs ? line.replace(LEADING_TABS, "") : line) === delimiter) {
          at = Math.min(end + 1, text.length);
          break;
        }
        if (!expands) at = end + 1;
        else {
          const stopped = expandedLine();
          if (stopped !== null) return stopped;
        }
      }
    }
    return null;
  }

  function redirect(): Stopped | null {
    if (text[at + 1] === "(") {
      at += 2;
      return code(true);
    }
    if (text.startsWith("<<", at)) {
      at += 2;
      heredocOperator();
    } else at++;
    return null;
  }

  function code(substitution: boolean): Stopped | null {
    const start = at;
    const cases: CaseState[] = [];
    let depth = 0;
    let wordStart = true;
    let commandPosition = true;
    let arithmeticNext = false;

    function setCase(state: CaseState): void {
      cases[cases.length - 1] = state;
    }

    function closesSubstitution(): boolean {
      at++;
      wordStart = true;
      if (cases.at(-1) === "pattern") {
        setCase("body");
        commandPosition = true;
        return false;
      }
      if (depth === 0 && substitution) return true;
      depth = Math.max(0, depth - 1);
      commandPosition = false;
      return false;
    }

    function openParen(): Stopped | null {
      wordStart = true;
      if ((commandPosition || arithmeticNext) && text[at + 1] === "(") {
        at += 2;
        commandPosition = false;
        arithmeticNext = false;
        return arithmetic("(", "))");
      }
      at++;
      if (cases.at(-1) !== "pattern") {
        depth++;
        commandPosition = true;
      }
      return null;
    }

    function separator(): void {
      const terminator = CASE_TERMINATOR.exec(text.slice(at, at + 3))?.[0];
      at += terminator?.length ?? 1;
      if (terminator !== undefined && cases.at(-1) === "body") setCase("pattern");
      wordStart = true;
      commandPosition = true;
    }

    function regexWord(): Stopped | null {
      while (BLANKS.has(text[at] ?? "")) at++;
      let groups = 0;
      while (at < text.length) {
        const char = text[at] ?? "";
        if (char === "(") {
          groups++;
          at++;
        } else if (char === ")" && groups > 0) {
          groups--;
          at++;
        } else if (groups === 0 && char !== "|" && WORD_ENDS.has(char)) break;
        else {
          const stopped = quotedOrExpansion("unquoted");
          if (stopped !== null) return stopped;
        }
      }
      return null;
    }

    function keyword(read: string): void {
      const caseState = cases.at(-1);
      arithmeticNext = read === "for";
      if (commandPosition && read === "case") {
        cases.push("subject");
        commandPosition = false;
      } else if (caseState === "subject") setCase("in");
      else if (caseState === "in" && read === "in") setCase("pattern");
      else if (read === "esac" && (caseState === "pattern" || (caseState === "body" && commandPosition))) {
        cases.pop();
        commandPosition = false;
      } else if (caseState !== "pattern")
        commandPosition = commandPosition && KEEPS_COMMAND_POSITION.has(read);
    }

    function wordAt(): Stopped | null {
      const read = word();
      if (typeof read !== "string") return read;
      if (read === REGEX_OPERATOR) {
        const stopped = regexWord();
        if (stopped !== null) return stopped;
      }
      wordStart = false;
      keyword(read);
      return null;
    }

    while (at < text.length) {
      const char = text[at] ?? "";
      let stopped: Stopped | null = null;
      if (char === "\n") {
        at++;
        stopped = heredocBodies();
        wordStart = true;
        commandPosition = true;
      } else if (BLANKS.has(char)) {
        at++;
        wordStart = true;
      } else if (text.startsWith(LINE_CONTINUATION, at)) at += LINE_CONTINUATION.length;
      else if (char === "#" && wordStart) comment();
      else if (char === ")") {
        if (closesSubstitution()) return null;
      } else if (char === "(") stopped = openParen();
      else if (char === ";" || char === "&" || char === "|") separator();
      else if (char === "<" || char === ">") {
        wordStart = text[at + 1] !== "(";
        commandPosition = false;
        stopped = redirect();
      } else stopped = wordAt();
      if (stopped !== null) return stopped;
    }
    if (substitution) return unterminated(start, "substitution");
    const [heredoc] = pending;
    if (heredoc !== undefined) return unterminated(heredoc.start, "heredoc");
    return null;
  }

  return code(false) ?? { kind: "lexed", spans };
}

function isKept(text: string, { start, end }: Span): boolean {
  const body = text.slice(start, end);
  return (start === 0 && body.startsWith(SHEBANG_PREFIX)) || SHELLCHECK_DIRECTIVE.test(body);
}

export const comments: CommentsOf = refusedComments(commentSpans, isKept);
