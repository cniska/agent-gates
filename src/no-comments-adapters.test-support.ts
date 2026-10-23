import type { Adapter } from "./no-comments-adapter";
import * as dart from "./no-comments-dart";
import * as javascript from "./no-comments-javascript";
import type { Language } from "./no-comments-languages";
import * as python from "./no-comments-python";
import * as rust from "./no-comments-rust";
import * as shell from "./no-comments-shell";
import * as sql from "./no-comments-sql";
import * as yaml from "./no-comments-yaml";

export const ADAPTERS: Readonly<Record<Language, Adapter>> = {
  javascript,
  dart,
  sql,
  shell,
  rust,
  python,
  yaml,
};
