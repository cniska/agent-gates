import type { Adapter } from "./no-comments-adapter";
import * as dart from "./no-comments-dart";
import * as javascript from "./no-comments-javascript";
import type { Language } from "./no-comments-languages";
import * as rust from "./no-comments-rust";
import * as shell from "./no-comments-shell";
import * as sql from "./no-comments-sql";

export const ADAPTERS: Readonly<Record<Language, Adapter>> = { javascript, dart, sql, shell, rust };
