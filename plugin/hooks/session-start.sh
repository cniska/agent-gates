#!/usr/bin/env bash
set -uo pipefail

readonly PUSH_UNJUDGED="a push is not judged until \`agent-gates install\` adds its step"
readonly UNREAD="so the session was not told which gates are installed"

source "${BASH_SOURCE[0]%/*}/installed.sh"
source "${BASH_SOURCE[0]%/*}/note.sh"

lines=()

format_line() {
  local root="$1" hook="$1/$FORMAT_HOOK"
  marker_version "$hook" format >/dev/null || return 0
  local command after_edit
  command="$(filled_value "$hook" command)"
  after_edit="the plugin runs it after each edit, and"
  if ! formats_edits "$root"; then
    after_edit="the plugin does not run it after an edit until \`agent-gates install\` updates the hook;"
  fi
  lines+=("- format runs \`$command\`: $after_edit at commit the gate runs it again and stages what it changed in each file the commit stages whole. It refuses the commit when the command fails, showing its output, or when it changes a partly staged file: stage that file whole or not at all.")
}

no_comments_line() {
  local root="$1" adapter language gates=""
  for adapter in "$root/$ADAPTERS"/*.cjs; do
    language="${adapter##*/}"
    language="${language%.cjs}"
    marker_version "$adapter" "no-comments-$language" >/dev/null || continue
    gates="${gates:+$gates, }no-comments-$language"
  done
  [ -n "$gates" ] || return 0
  local refused="At commit and at push, a change that adds a comment is refused" unjudged=""
  if ! marker_version "$root/$NO_COMMENTS_PUSH_STEP" no-comments >/dev/null; then
    refused="At commit, a change that adds a comment is refused"
    unjudged=" As installed, $PUSH_UNJUDGED."
  fi
  lines+=("- $gates: after each edit the plugin names the comments the edit added. $refused: remove each comment; a why belongs in a name, a test or the docs.$unjudged")
}

commit_subject_line() {
  local root="$1" hook="$1/$COMMIT_MSG_HOOK"
  marker_version "$hook" commit-subject >/dev/null || return 0
  local prefixes allowed=""
  prefixes="$(filled_value "$hook" prefixes)"
  if [ -n "$prefixes" ]; then
    allowed=", allowing the types ${prefixes//,/, }"
  fi
  local at_push="At push it judges the pushed commits the same way and also refuses a fixup!, squash! or amend! commit: squash it into the commit it names."
  if ! marker_version "$root/$COMMIT_SUBJECT_PUSH_STEP" commit-subject >/dev/null; then
    at_push="As installed, $PUSH_UNJUDGED."
  fi
  lines+=("- commit-subject$allowed: at commit it refuses a subject that is not a Conventional Commit \`type(scope): description\` of an allowed type, is over 50 characters or is not ASCII, and a message with a body. $at_push")
}

main() {
  if ! jq --version >/dev/null 2>&1; then
    note "jq is not on PATH, $UNREAD"
    return 0
  fi
  local input cwd
  IFS= read -r -d '' input || true
  if ! cwd="$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null)"; then
    note "the hook input did not parse as JSON, $UNREAD"
    return 0
  fi
  case "$cwd" in
    /*) ;;
    *) return 0 ;;
  esac
  [ -d "$cwd" ] || return 0
  local root
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || return 0
  format_line "$root"
  no_comments_line "$root"
  commit_subject_line "$root"
  [ "${#lines[@]}" -gt 0 ] || return 0
  local context
  context="$(printf '%s\n' "cniska-gates: the gates installed in this checkout:" "${lines[@]}" "Each refusal names what to fix. The plugin denies a git command that skips the gates, such as \`git commit --no-verify\`.")"
  jq -cn --arg context "$context" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $context}}'
}

main
exit 0
