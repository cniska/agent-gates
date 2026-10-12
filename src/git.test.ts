import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { CodedError } from "./coded-error";
import { blobsOf } from "./git";
import { removeScratchDirs, repo } from "./repo.test-support";

afterEach(removeScratchDirs);

function stored(dir: string, text: string): string {
  return execFileSync("git", ["-C", dir, "hash-object", "-w", "--stdin"], {
    input: text,
    encoding: "utf8",
  }).trim();
}

describe("blobsOf", () => {
  test("reads each blob by its length, in the order asked, newlines and NULs inside included", () => {
    const dir = repo();
    const texts = ["", "one\n", "two\nlines\n\n", "\0bin\nary\0", "one\n"];
    const blobs = texts.map((text) => stored(dir, text));
    expect(blobsOf(dir, blobs).map((blob) => blob.toString())).toEqual(texts);
    expect(blobsOf(dir, [])).toEqual([]);
  });

  test("faults on a blob the object store does not hold", () => {
    const dir = repo();
    const missing = "0123456789abcdef0123456789abcdef01234567";
    let caught: unknown = null;
    try {
      blobsOf(dir, [stored(dir, "here\n"), missing]);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof CodedError ? [caught.kind, caught.code, caught.meta] : caught).toEqual([
      "fault",
      "blob_missing",
      { repo: dir, blob: missing },
    ]);
  });
});
