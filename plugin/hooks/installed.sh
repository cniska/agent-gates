#!/usr/bin/env bash

readonly HOOKS=".githooks"
readonly COMMIT_MSG_HOOK="$HOOKS/commit-msg"
readonly PRE_COMMIT_HOOK="$HOOKS/pre-commit"
readonly PRE_PUSH_HOOK="$HOOKS/pre-push"
readonly COMMIT_STEPS="$HOOKS/pre-commit.d"
readonly PUSH_STEPS="$HOOKS/pre-push.d"
readonly FORMAT_HOOK="$COMMIT_STEPS/format"
readonly COMMIT_SUBJECT_PUSH_STEP="$PUSH_STEPS/commit-subject"
readonly NO_COMMENTS_PUSH_STEP="$PUSH_STEPS/no-comments"
readonly ADAPTERS="$HOOKS/no-comments"
readonly SCANNER="$ADAPTERS/scan.cjs"
readonly FORMAT_RUN_SINCE=3
readonly MARKER_TAG="agent-gate"
readonly QUOTE="'"
readonly ESCAPED_QUOTE="'\\''"

marker_version() {
  local file="$1" part="$2" line
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "# $MARKER_TAG:$part:"* | "// $MARKER_TAG:$part:"*)
        line="${line#*"$MARKER_TAG:$part:"}"
        case "$line" in
          '' | *[!0-9]*) return 1 ;;
        esac
        printf '%s' "$line"
        return 0
        ;;
    esac
  done <"$file"
  return 1
}

filled_value() {
  local file="$1" name="$2" line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$name='"*"'")
        line="${line#"$name"=\'}"
        line="${line%\'}"
        printf '%s' "${line//"$ESCAPED_QUOTE"/$QUOTE}"
        return 0
        ;;
    esac
  done <"$file"
  return 1
}

formats_edits() {
  local version
  version="$(marker_version "$1/$FORMAT_HOOK" format)" || return 1
  [ "$version" -ge "$FORMAT_RUN_SINCE" ]
}
