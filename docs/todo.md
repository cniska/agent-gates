# Todo

What is not built, highest priority first. An entry is here only for a need this repo has now, and it is fixed at its cause, sized to the problem.

## Debt

- **Dart and SQL let unbalanced files through** — their lexers refuse only an unclosed string, comment or dollar quote, so a file with unbalanced brackets or a bare `$` is judged as if it parsed. Refuse what the language's own parser refuses.
- **The shell lexer does not know extglob** — `@(`, `!(` and `+(` patterns are lexed as plain words and parentheses, so a `#` after `|` inside one, as in `ls @(a|#b)`, is refused as a comment. Lex them as shfmt does.

## Owner decides

- Does the Go gate keep doc comments or refuse them?
