#!/usr/bin/env bash
set -uo pipefail

readonly SCANNER=".githooks/no-comments/scan.cjs"
readonly REFUSED=1

note() {
  printf 'cniska-gates: %s\n' "$1" >&2
}

edited_file() {
  jq -r '(.tool_input.file_path // "") as $file | if ($file | startswith("/")) or $file == "" then $file else "\(.cwd)/\($file)" end' 2>/dev/null
}

main() {
  if ! jq --version >/dev/null 2>&1; then
    note "jq is not on PATH, so the edit's comments were not judged"
    return 0
  fi
  local file
  if ! file="$(edited_file)"; then
    note "the hook input did not parse as JSON, so the edit's comments were not judged"
    return 0
  fi
  [ -n "$file" ] || return 0
  local dir
  dir="${file%/*}"
  [ -d "$dir" ] || return 0
  local root
  root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -f "$root/$SCANNER" ] || return 0
  if ! node --version >/dev/null 2>&1; then
    note "node is not on PATH, so the edit's comments were not judged"
    return 0
  fi
  local reply status
  reply="$(cd "$root" && node "$SCANNER" --file "$file" 2>&1 >/dev/null)"
  status=$?
  [ "$status" -eq 0 ] && return 0
  if [ "$status" -ne "$REFUSED" ]; then
    note "the no-comments scanner exited $status, so the edit's comments were not judged: $reply"
    return 0
  fi
  jq -cn --arg context "$reply" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}}'
}

main
exit 0
