#!/usr/bin/env bash
# Does this change need the e2e run? Prints one line for $GITHUB_OUTPUT —
# `e2e=true` or `e2e=false` — and says why on stderr.
#
# The e2e job builds the extension twice, starts the stand and the fake hub and
# drives Firefox through them. None of that reads:
#   docs/**           the documents;
#   site/**           the release site, static pages;
#   changes/**        the notes of changes and their screenshots (changes/README.md);
#   *.md in the root  README, AGENTS, CHANGELOG, BUILD.
# A change that touches nothing else gets `e2e=false`. Those files are not
# unchecked: `pnpm check` tests the site, the changelog and the parity tables,
# and that job always runs in full. Anything else — and any doubt: no base
# commit, a git command that failed, a manual run — is `e2e=true`.
#
# What «the change» is:
#   pull_request  the whole PR against its base. actions/checkout gives GitHub's
#                 merge commit of the PR, so the base is HEAD^1 (fetch-depth: 2).
#                 The whole PR, not the last push: the check on the head commit
#                 is what lets the PR merge.
#   push          everything the push brought: from the commit the branch was at
#                 before (CG_PUSH_BEFORE = github.event.before, fetched here by
#                 its id) to HEAD.
#
#   e2e-needed.sh            decide from git and the environment
#   e2e-needed.sh --paths    decide from a list of paths on stdin (the rule alone)
set -uo pipefail

answer() { # answer true|false <why>
  echo "e2e-needed: $2" >&2
  echo "e2e=$1"
  exit 0
}

# stdin: changed paths, one per line.
decide() {
  local path seen=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    seen=$((seen + 1))
    case "$path" in
      docs/* | site/* | changes/*) ;;
      */*) answer true "$path is not a document — the run is needed" ;;
      *.md) ;;
      *) answer true "$path is not a document — the run is needed" ;;
    esac
  done
  [ "$seen" -gt 0 ] || answer true 'no changed file was found — the run is not skipped on a guess'
  answer false "all $seen changed file(s) are under docs/, site/, changes/ or are *.md in the root — the e2e run reads none of them"
}

if [ "${1:-}" = '--paths' ]; then
  decide
fi

case "${GITHUB_EVENT_NAME:-}" in
  pull_request)
    git rev-parse -q --verify 'HEAD^2' > /dev/null 2>&1 || answer true 'HEAD is not the merge commit of a pull request (or its parents were not fetched)'
    base=$(git rev-parse -q --verify 'HEAD^1') || answer true 'the base commit is not here'
    ;;
  push)
    base=${CG_PUSH_BEFORE:-}
    case "$base" in
      '' | *[!0-9a-f]*) answer true 'the push names no earlier commit' ;;
    esac
    [ -n "${base//0/}" ] || answer true 'the branch is new: there is no earlier commit to compare with'
    if ! git cat-file -e "$base^{commit}" 2> /dev/null; then
      git fetch --quiet --no-tags --depth=1 origin "$base" 2> /dev/null || answer true "the commit before the push ($base) could not be fetched"
    fi
    ;;
  *) answer true "a ${GITHUB_EVENT_NAME:-manual} run always runs e2e" ;;
esac

# --no-renames: a file moved out of the code into docs/ counts by its old path too.
changed=$(git diff --name-only --no-renames "$base" HEAD) || answer true 'git diff failed'
decide <<< "$changed"
