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
    const shell = "shell # agent-gate:[a-z-]+:[0-9]+";
    const marker = "yaml # agent-gate:[a-z-]+:[0-9]+";
    const trailer = "yaml # v?[0-9]+(\\.[0-9]+)*(-[0-9A-Za-z.]+)?";
    const all = `${shell}\n${marker}\n${trailer}\n`;
    expect(withInstallLines(null)).toBe(all);
    expect(withInstallLines("")).toBe(all);
    expect(withInstallLines("sql -- a")).toBe(`sql -- a\n${all}`);
    expect(withInstallLines(`${shell}\nsql -- a\n`)).toBe(`${shell}\nsql -- a\n${marker}\n${trailer}\n`);
    expect(withInstallLines(`${trailer}\n${marker}\n${shell}\nsql -- a\n`)).toBeNull();
    expect(withInstallLines(all.replaceAll("\n", "\r\n"))).toBeNull();
  });
});
