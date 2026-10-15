#!/usr/bin/env bash
set -uo pipefail

readonly SCANNER=".githooks/no-comments/scan.cjs"
readonly REFUSED=1
readonly FORMAT_HOOK=".githooks/pre-commit.d/format"
readonly FORMAT_MARKER="# agent-gate:format:"
readonly FORMAT_RUN_SINCE=3
readonly FORMAT_BOUND_SECONDS=30
readonly STOPPED_STATUS=143
readonly QUOTE="'"
readonly ESCAPED_QUOTE="'\\''"

told=()
format_outcome=""

note() {
  printf 'cniska-gates: %s\n' "$1" >&2
}

tell() {
  told+=("$1")
}

edited_file() {
  jq -r '(.tool_input.file_path // "") as $file | if ($file | startswith("/")) or $file == "" then $file else "\(.cwd)/\($file)" end' 2>/dev/null
}

format_version() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "$FORMAT_MARKER"*)
        line="${line#"$FORMAT_MARKER"}"
        case "$line" in
          '' | *[!0-9]*) return 1 ;;
        esac
        printf '%s' "$line"
        return 0
        ;;
    esac
  done <"$1"
  return 1
}

format_command() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "command='"*"'")
        line="${line#command=\'}"
        line="${line%\'}"
        printf '%s' "${line//"$ESCAPED_QUOTE"/$QUOTE}"
        return 0
        ;;
    esac
  done <"$1"
}

bounded_format() {
  local root="$1" started="$SECONDS" run watchdog status
  set -m
  (cd "$root" && exec sh "$FORMAT_HOOK" --run) >/dev/null 2>&1 </dev/null &
  run=$!
  { sleep "$FORMAT_BOUND_SECONDS" && kill -TERM -- -"$run"; } >/dev/null 2>&1 &
  watchdog=$!
  set +m
  wait "$run" 2>/dev/null
  status=$?
  kill -TERM -- -"$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  if [ "$status" -eq "$STOPPED_STATUS" ] && ((SECONDS - started >= FORMAT_BOUND_SECONDS)); then
    format_outcome=stopped
  else
    format_outcome="$status"
  fi
}

format_step() {
  local root="$1"
  local hook="$root/$FORMAT_HOOK"
  [ -f "$hook" ] || return 0
  local version
  if ! version="$(format_version "$hook")" || [ "$version" -lt "$FORMAT_RUN_SINCE" ]; then
    note "$FORMAT_HOOK has no --run before ${FORMAT_MARKER#\# }$FORMAT_RUN_SINCE, so the edit was not formatted; agent-gates install updates it"
    return 0
  fi
  bounded_format "$root"
  [ "$format_outcome" = 0 ] && return 0
  local command
  command="$(format_command "$hook")"
  if [ "$format_outcome" = stopped ]; then
    tell "format: \`$command\` ran past $FORMAT_BOUND_SECONDS s and was stopped, so the edited file was not formatted"
  else
    tell "format: \`$command\` exited $format_outcome, so the edited file was not formatted"
  fi
}

scan_step() {
  local root="$1" file="$2"
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
  tell "$reply"
}

main() {
  if ! jq --version >/dev/null 2>&1; then
    note "jq is not on PATH, so the edit was neither formatted nor judged"
    return 0
  fi
  local file
  if ! file="$(edited_file)"; then
    note "the hook input did not parse as JSON, so the edit was neither formatted nor judged"
    return 0
  fi
  [ -n "$file" ] || return 0
  local dir
  dir="${file%/*}"
  [ -d "$dir" ] || return 0
  local root
  root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 0
  format_step "$root"
  scan_step "$root" "$file"
  [ "${#told[@]}" -gt 0 ] || return 0
  local context
  context="$(printf '%s\n' "${told[@]}")"
  jq -cn --arg context "$context" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}}'
}

main
exit 0
