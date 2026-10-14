#!/usr/bin/env bash
set -uo pipefail

readonly HOOKS=".githooks"

note() {
  printf 'cniska-gates: %s\n' "$1" >&2
}

commands_of() {
  jq -r '(.tool_input.command // "")
    | gsub("\"(?<q>[^\"]*)\""; .q | gsub("[\\s;&|]"; ""))
    | gsub("'"'"'(?<q>[^'"'"']*)'"'"'"; .q | gsub("[\\s;&|]"; ""))
    | gsub("&&|\\|\\||[;|&]"; "\n")' 2>/dev/null
}

is_gates_path() {
  local root="$1" value="$2"
  case "$value" in
    /*) ;;
    *) value="$root/$value" ;;
  esac
  local gates pointed
  gates="$(cd -P "$root/$HOOKS" 2>/dev/null && pwd)" || return 1
  pointed="$(cd -P "$value" 2>/dev/null && pwd)" || return 1
  [ "$pointed" = "$gates" ]
}

is_hooks_path_key() (
  shopt -s nocasematch
  [[ "$1" == core.hookspath ]]
)

skips_verify_in_cluster() {
  local cluster="${1#-}"
  cluster="${cluster%%[mFcCtS]*}"
  case "$cluster" in
    *n*) return 0 ;;
    *) return 1 ;;
  esac
}

commit_skip() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-verify)
        printf 'commit --no-verify\n'
        return 0
        ;;
      --*) ;;
      -*)
        if skips_verify_in_cluster "$arg"; then
          printf 'commit %s\n' "$arg"
          return 0
        fi
        ;;
    esac
  done
  return 1
}

push_skip() {
  local arg
  for arg in "$@"; do
    if [ "$arg" = --no-verify ]; then
      printf 'push --no-verify\n'
      return 0
    fi
  done
  return 1
}

config_skip() {
  local root="$1"
  shift
  [ "$#" -gt 0 ] || return 1
  local -a args=("$@")
  local key_at=-1 unset=false index
  for index in "${!args[@]}"; do
    case "${args[$index]}" in
      --unset | --unset-all | unset) unset=true ;;
    esac
    if is_hooks_path_key "${args[$index]}"; then key_at="$index"; fi
  done
  [ "$key_at" -ge 0 ] || return 1
  local value="${args[$((key_at + 1))]:-}"
  if [ "$unset" = true ] || { [ -n "$value" ] && ! is_gates_path "$root" "$value"; }; then
    printf 'hooks-path config %s\n' "${args[*]}"
    return 0
  fi
  return 1
}

skip_of() {
  local root="$1"
  local -a words
  read -ra words <<<"$2"
  local at=0
  while [ "$at" -lt "${#words[@]}" ]; do
    case "${words[$at]}" in
      git | */git) break ;;
    esac
    at=$((at + 1))
  done
  [ "$at" -lt "${#words[@]}" ] || return 1
  at=$((at + 1))
  local subcommand=""
  while [ "$at" -lt "${#words[@]}" ]; do
    local word="${words[$at]}"
    case "$word" in
      -c)
        at=$((at + 1))
        local setting="${words[$at]:-}"
        if is_hooks_path_key "${setting%%=*}" && ! is_gates_path "$root" "${setting#*=}"; then
          printf 'hooks-path -c %s\n' "$setting"
          return 0
        fi
        ;;
      -C | --git-dir | --work-tree | --namespace | --exec-path) at=$((at + 1)) ;;
      -*) ;;
      *)
        subcommand="$word"
        break
        ;;
    esac
    at=$((at + 1))
  done
  local -a args=("${words[@]:$((at + 1))}")
  case "$subcommand" in
    commit) commit_skip ${args[@]+"${args[@]}"} ;;
    push) push_skip ${args[@]+"${args[@]}"} ;;
    config) config_skip "$root" ${args[@]+"${args[@]}"} ;;
    *) return 1 ;;
  esac
}

gates_for() {
  local root="$1" kind="$2" names=()
  local step
  if [ "$kind" = commit ]; then
    [ -f "$root/$HOOKS/commit-msg" ] && names+=("commit-subject")
  fi
  for step in "$root/$HOOKS/pre-$kind.d"/*; do
    [ -f "$step" ] && [ -x "$step" ] && names+=("${step##*/}")
  done
  local listed="" name
  for name in ${names[@]+"${names[@]}"}; do
    listed="${listed:+$listed, }$name"
  done
  printf '%s' "$listed"
}

reason_for() {
  local root="$1" skip="$2"
  local kind="${skip%% *}" how="${skip#* }"
  local fix="Fix what the refusing gate names instead; CI refuses what the gates refuse anyway."
  case "$kind" in
    commit | push)
      printf '`git %s %s` skips the gates this repo runs on %s: %s. %s' "$kind" "$how" "$kind" "$(gates_for "$root" "$kind")" "$fix"
      ;;
    hooks-path)
      printf '`git %s` points git away from %s, which skips the gates this repo runs on commit (%s) and on push (%s). %s' "$how" "$HOOKS" "$(gates_for "$root" commit)" "$(gates_for "$root" push)" "$fix"
      ;;
  esac
}

gated() {
  local hook
  for hook in commit-msg pre-commit pre-push; do
    [ -f "$1/$HOOKS/$hook" ] && [[ "$(<"$1/$HOOKS/$hook")" == *agent-gate:* ]] && return 0
  done
  return 1
}

main() {
  if ! jq --version >/dev/null 2>&1; then
    note "jq is not on PATH, so the command was not checked for skipping the gates"
    return 0
  fi
  local input commands cwd
  IFS= read -r -d '' input || true
  if ! commands="$(commands_of <<<"$input")" || ! cwd="$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null)"; then
    note "the hook input did not parse as JSON, so the command was not checked for skipping the gates"
    return 0
  fi
  [ -d "$cwd" ] || return 0
  local root
  root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || return 0
  gated "$root" || return 0
  local line skip
  while IFS= read -r line; do
    if skip="$(skip_of "$root" "$line")"; then
      jq -cn --arg reason "cniska-gates: $(reason_for "$root" "$skip")" \
        '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
      return 0
    fi
  done <<<"$commands"
}

main
exit 0
