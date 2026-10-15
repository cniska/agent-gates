#!/usr/bin/env bash
set -uo pipefail

readonly QUOTED_SPACE=$'\x1f'
readonly DETACHED=$'\x1e'
readonly HEREDOC='(^|[^<])<<-?[[:space:]]*(["'"'"'\]?)([A-Za-z0-9_.-]+)["'"'"']?(.*)$'
readonly DATA_SINK='^(cat|tee|git)$'

source "${BASH_SOURCE[0]%/*}/installed.sh"
source "${BASH_SOURCE[0]%/*}/note.sh"

feeds_data() {
  [[ "$1$2" != *"|"* ]] || return 1
  words_of "$1"
  [[ "${WORDS[0]:-}" =~ $DATA_SINK ]]
}

heredoc_ends() {
  local rest="$1"
  while [[ "$rest" =~ $HEREDOC ]]; do
    local whole="${BASH_REMATCH[0]}" lead="${BASH_REMATCH[1]}" quote="${BASH_REMATCH[2]}"
    local end="${BASH_REMATCH[3]}" tail="${BASH_REMATCH[4]}" kind=run
    local before="${1%"$whole"}$lead"
    if feeds_data "${before##*[;&]}" "${tail%%[;&]*}"; then
      kind=plain
      if [ -n "$quote" ]; then
        kind=quoted
      fi
    fi
    printf '%s %s\n' "$kind" "$end"
    rest="$tail"
  done
}

body_runs() {
  case "$1" in
    run) return 0 ;;
    quoted) return 1 ;;
  esac
  [[ "$2" == *'$('* || "$2" == *'`'* ]]
}

without_heredoc_bodies() {
  local line end body=""
  local -a ends=()
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "${#ends[@]}" -gt 0 ]; then
      body+="$line"$'\n'
      if [ "${line#"${line%%[!$'\t']*}"}" = "${ends[0]#* }" ]; then
        if body_runs "${ends[0]%% *}" "$body"; then
          printf '%s' "$body"
        fi
        body=""
        ends=("${ends[@]:1}")
      fi
      continue
    fi
    printf '%s\n' "$line"
    while IFS= read -r end; do
      ends+=("$end")
    done < <(heredoc_ends "$line")
  done <<<"$1"
  printf '%s' "$body"
}

commands_of() {
  printf '%s' "$1" | jq -rRs --arg space "$QUOTED_SPACE" --arg detached "$DETACHED" '.
    | gsub("\"(?<q>[^\"]*)\""; .q | gsub("[;&|]"; "") | gsub("\\s"; $space))
    | gsub("'"'"'(?<q>[^'"'"']*)'"'"'"; .q | gsub("[;&|]"; "") | gsub("\\s"; $space))
    | gsub("&&|\\|\\||;"; "\n")
    | gsub("[|&]"; " " + $detached + "\n")'
}

words_of() {
  local -a raw
  read -ra raw <<<"$1"
  WORDS=()
  OPENERS=""
  local word bare
  for word in ${raw[@]+"${raw[@]}"}; do
    word="${word//$QUOTED_SPACE/ }"
    bare="$word"
    while true; do
      case "$bare" in
        '$('*) bare="${bare#??}" ;;
        '('* | '{'* | '`'*) bare="${bare#?}" ;;
        *) break ;;
      esac
    done
    if [ "${#WORDS[@]}" -eq 0 ]; then
      OPENERS+="${word%"$bare"}"
    fi
    if [ -n "$bare" ]; then
      WORDS+=("$bare")
    fi
  done
}

dir_from() {
  local base="$1" target="$2" rest
  case "$target" in
    "~" | "\$HOME" | "\${HOME}") rest="" ;;
    \~/*) rest="/${target#\~/}" ;;
    "\$HOME/"*) rest="/${target#"\$HOME/"}" ;;
    "\${HOME}/"*) rest="/${target#"\${HOME}/"}" ;;
    /*)
      printf '%s' "$target"
      return 0
      ;;
    *)
      printf '%s/%s' "$base" "$target"
      return 0
      ;;
  esac
  [ -n "${HOME:-}" ] || return 1
  printf '%s%s' "$HOME" "$rest"
}

cd_target() {
  local dir="$1" previous="$2"
  shift 2
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        break
        ;;
      -) break ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  local target="${1:-}"
  [ -n "$target" ] || target='~'
  if [ "$target" = - ]; then
    printf '%s' "$previous"
    return 0
  fi
  dir_from "$dir" "$target"
}

made_dirs() {
  local dir="$1" word
  shift
  for word in "$@"; do
    case "$word" in
      -*) ;;
      *) dir_from "$dir" "$word" && printf '\n' ;;
    esac
  done
}

is_made() {
  local target="${1%/}/" made
  while IFS= read -r made; do
    [ -n "$made" ] || continue
    [[ "${made%/}/" == "$target"* ]] && return 0
  done <<<"$2"
  return 1
}

gated_root_of() {
  local dir="$1" root
  while [ ! -d "$dir" ]; do
    dir="${dir%/*}"
    dir="${dir:-/}"
  done
  root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 1
  gated "$root" || return 1
  printf '%s' "$root"
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

denial_of() {
  local dir="$1"
  words_of "$2"
  local -a words=(${WORDS[@]+"${WORDS[@]}"}) settings=()
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
        settings+=("${words[$at]:-}")
        ;;
      -C)
        at=$((at + 1))
        local named
        if named="$(dir_from "$dir" "${words[$at]:-}")"; then
          dir="$named"
        fi
        ;;
      --git-dir | --work-tree | --namespace | --exec-path) at=$((at + 1)) ;;
      -*) ;;
      *)
        subcommand="$word"
        break
        ;;
    esac
    at=$((at + 1))
  done
  local root
  root="$(gated_root_of "$dir")" || return 1
  local setting
  for setting in ${settings[@]+"${settings[@]}"}; do
    if is_hooks_path_key "${setting%%=*}" && ! is_gates_path "$root" "${setting#*=}"; then
      reason_for "$root" "hooks-path -c $setting"
      return 0
    fi
  done
  local -a args=("${words[@]:$((at + 1))}")
  local skip
  case "$subcommand" in
    commit) skip="$(commit_skip ${args[@]+"${args[@]}"})" ;;
    push) skip="$(push_skip ${args[@]+"${args[@]}"})" ;;
    config) skip="$(config_skip "$root" ${args[@]+"${args[@]}"})" ;;
    *) return 1 ;;
  esac || return 1
  reason_for "$root" "$skip"
}

gates_for() {
  local root="$1" kind="$2" names=()
  local steps="$PUSH_STEPS" step
  if [ "$kind" = commit ]; then
    steps="$COMMIT_STEPS"
    [ -f "$root/$COMMIT_MSG_HOOK" ] && names+=("commit-subject")
  fi
  for step in "$root/$steps"/*; do
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
  marker_version "$1/$COMMIT_MSG_HOOK" commit-subject >/dev/null ||
    marker_version "$1/$PRE_COMMIT_HOOK" githooks >/dev/null ||
    marker_version "$1/$PRE_PUSH_HOOK" githooks >/dev/null
}

main() {
  if ! jq --version >/dev/null 2>&1; then
    note "jq is not on PATH, so the command was not checked for skipping the gates"
    return 0
  fi
  local input command cwd
  IFS= read -r -d '' input || true
  if ! command="$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)" || ! cwd="$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null)"; then
    note "the hook input did not parse as JSON, so the command was not checked for skipping the gates"
    return 0
  fi
  case "$cwd" in
    /*) ;;
    *) return 0 ;;
  esac
  local dir="$cwd" previous="$cwd" made="" line target reason
  local -a outer=()
  while IFS= read -r line; do
    local detached=false
    if [[ "$line" == *" $DETACHED" ]]; then
      detached=true
      line="${line% "$DETACHED"}"
    fi
    words_of "$line"
    local -a words=(${WORDS[@]+"${WORDS[@]}"})
    if [[ "$OPENERS" == *'`'* ]]; then
      detached=true
    fi
    local subshells="${OPENERS//[^(]/}" opens="${line//[^(]/}" closes="${line//[^)]/}"
    local exits=$((${#subshells} - ${#opens} + ${#closes})) entered
    for ((entered = 0; entered < ${#subshells}; entered++)); do
      outer+=("$dir")
    done
    case "${words[0]:-}" in
      cd)
        if [ "$detached" = false ] &&
          target="$(cd_target "$dir" "$previous" "${words[@]:1}")" &&
          { [ -d "$target" ] || is_made "$target" "$made"; }; then
          previous="$dir"
          dir="$target"
        fi
        ;;
      mkdir)
        made+="$(made_dirs "$dir" "${words[@]:1}")"$'\n'
        ;;
      *)
        if reason="$(denial_of "$dir" "$line")"; then
          jq -cn --arg reason "cniska-gates: $reason" \
            '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
          return 0
        fi
        ;;
    esac
    while [ "$exits" -gt 0 ] && [ "${#outer[@]}" -gt 0 ]; do
      dir="${outer[${#outer[@]} - 1]}"
      unset 'outer[${#outer[@]}-1]'
      exits=$((exits - 1))
    done
  done < <(commands_of "$(without_heredoc_bodies "$command")")
}

main
exit 0
