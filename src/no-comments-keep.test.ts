import { describe, expect, test } from "bun:test";
import { isKept, keepRead, keptShown, withInstallLines } from "./no-comments-keep";

function refusalOf(text: string) {
  const read = keepRead(text);
  return read.kind === "malformed" ? { code: read.refusal.code, message: read.refusal.message } : null;
}

describe("the keep file", () => {
  test("reads one pattern per line after its language, blank lines skipped", () => {
    const read = keepRead("shell # x\n\n  \njavascript // [a-z] y\nshell # z\n");
    expect(read.kind === "parsed" && keptShown(read.keep, "shell")).toEqual(["# x", "# z"]);
    expect(read.kind === "parsed" && keptShown(read.keep, "javascript")).toEqual(["// [a-z] y"]);
    expect(read.kind === "parsed" && keptShown(read.keep, "sql")).toEqual([]);
    expect(keepRead(null)).toEqual({ kind: "parsed", keep: [] });
    const crlf = keepRead("shell # x\r\n");
    expect(crlf.kind === "parsed" && keptShown(crlf.keep, "shell")).toEqual(["# x"]);
    expect(crlf.kind === "parsed" && isKept(crlf.keep, "shell", "# x")).toBe(true);
  });

  test("refuses each malformed line, naming its number and text", () => {
    expect(refusalOf("shell # x\ncobol # y\n")).toEqual({
      code: "malformed_keep_line",
      message: ".no-comments-keep line 2 names no language the gates read: cobol # y",
    });
    expect(refusalOf("\nshell\n")).toEqual({
      code: "malformed_keep_line",
      message: ".no-comments-keep line 2 holds no regex after its language: shell",
    });
    expect(refusalOf("shell \n")).toEqual({
      code: "malformed_keep_line",
      message: ".no-comments-keep line 1 holds no regex after its language: shell",
    });
    expect(refusalOf("sql --> x\npython # (\n")).toEqual({
      code: "malformed_keep_line",
      message: ".no-comments-keep line 2 holds a regex that does not compile: python # (",
    });
    expect(refusalOf("[shell]\n")).toEqual({
      code: "malformed_keep_line",
      message: ".no-comments-keep line 1 names no language the gates read: [shell]",
    });
  });
});

describe("install's keep lines", () => {
  test("append each missing line at the end, keeping every line the file holds", () => {
    const line = "shell # agent-gate:[a-z-]+:[0-9]+";
    expect(withInstallLines(null)).toBe(`${line}\n`);
    expect(withInstallLines("")).toBe(`${line}\n`);
    expect(withInstallLines("sql -- a")).toBe(`sql -- a\n${line}\n`);
    expect(withInstallLines(`${line}\nsql -- a\n`)).toBeNull();
    expect(withInstallLines(`${line}\r\n`)).toBeNull();
  });
});
