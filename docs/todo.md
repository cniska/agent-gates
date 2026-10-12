# Todo

What is not built, highest priority first. An entry is here only for a need this repo has now, and it is fixed at its cause, sized to the problem.

## Debt

- **The shell lexer does not know extglob** — `@(`, `!(` and `+(` patterns are lexed as plain words and parentheses, so a `#` after `|` inside one, as in `ls @(a|#b)`, is refused as a comment. Lex them as shfmt does.

## Owner decides

- Does the Go gate keep doc comments or refuse them?
