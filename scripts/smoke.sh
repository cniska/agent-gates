#!/usr/bin/env bash
set -euo pipefail

main() {
  local executable="${1:?usage: smoke.sh <executable> <version>}"
  local version="${2:?usage: smoke.sh <executable> <version>}"
  local project
  test "$("$executable" --version)" = "$version"
  project="$(mktemp -d)"
  cd "$project"
  git init -q
  printf 'made-up content\n' > notes.txt
  "$executable" install commit-subject | grep -q '"ok":true'
  "$executable" doctor | grep -q '"failing":0'
}

main "$@"
