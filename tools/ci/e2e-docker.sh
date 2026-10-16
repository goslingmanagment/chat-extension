#!/usr/bin/env bash
# The CI job «e2e» (architecture.md §13): `pnpm e2e` — headless Firefox and
# geckodriver — inside the image pinned by digest in e2e-image.sh, with no
# network at all. Nothing can leave the container, and two jobs on one machine
# cannot collide on ports: each has a loopback of its own (the WSL distros of
# the PC share one network stack).
#
# The runner brings the checkout with installed dependencies, Node
# (actions/setup-node) and pnpm on PATH; the three folders are mounted at their
# own paths, so every absolute path means the same inside and outside. Node 26
# links libatomic, which the image does not have: the runner's copy goes in
# next to Node.
#
# The container runs as root. Under the rootless daemon of the PC runners that
# IS the runner user outside. Under a rootful daemon (GitHub-hosted) it is the
# real root, so the files the run created are handed back on exit.
#
# A cancelled or timed-out job must not leave the container behind: it would go
# on running the suite with this checkout mounted read-write, under the next
# job of the same runner. The runner signals only the step's own process
# (SIGINT, 7.5 s later SIGTERM, 2.5 s later SIGKILL), so the workflow starts
# this script with `exec`, and it is this script — not the docker client — that
# takes the signal: it removes the container and ends. What a SIGKILL or a dead
# runner leaves is removed by the job's `if: always()` step
# (`e2e-docker.sh --remove-container`) and, failing that, at the start of the
# next run in the same checkout. The container is told by its label — the
# checkout it has mounted; its name says which run it belongs to.
#
# Linux only (GNU readlink). On a Mac use e2e-docker-local.sh.
# Arguments go to pnpm instead of `e2e`. CG_E2E_SHARD=<k>/<n> (the CI job's
# matrix) runs part k of n of the spec files (packages/testing/src/e2e-shards.ts).
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck source=tools/ci/e2e-image.sh
. "$root/tools/ci/e2e-image.sh"

command -v docker > /dev/null || { echo "::error::e2e-docker: docker is not on PATH"; exit 1; }

# cg-e2e-<runner>-<run id>-<attempt>: one per run of the job (a run outside
# Actions: cg-e2e-local-<pid of this script>-0).
name="cg-e2e-$(printf '%s' "${RUNNER_NAME:-local}" | tr -c 'A-Za-z0-9_.-' '-')-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
label="cg-e2e.workspace=$root"

# Removes every container that has this checkout mounted — this run's and any
# left by an earlier one; a checkout runs one job at a time. $1: what to call them.
remove_containers() {
  local found
  found=$(docker ps -a --filter "label=$label" --format '{{.Names}}' 2> /dev/null | tr '\n' ' ') || return 0
  found=${found% }
  [ -n "$found" ] || return 0
  # shellcheck disable=SC2086 # names of our own making, one per word
  docker rm -f $found > /dev/null 2>&1 || true
  echo "e2e-docker: removed $1: $found"
}

if [ "${1:-}" = '--remove-container' ]; then
  remove_containers 'the container the run left behind'
  exit 0
fi

for tool in node pnpm; do
  command -v "$tool" > /dev/null || { echo "::error::e2e-docker: $tool is not on PATH"; exit 1; }
done

# <home>/bin/node and <home>/bin/pnpm -> ../lib/node_modules/pnpm/bin/pnpm.cjs:
# mount each home whole.
node_home=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
pnpm_home=$(dirname "$(dirname "$(command -v pnpm)")")
pnpm_real=$(readlink -f "$(command -v pnpm)")
case "$pnpm_real" in
  "$pnpm_home"/* | "$node_home"/*) ;;
  *) echo "::error::e2e-docker: pnpm resolves to $pnpm_real, outside $pnpm_home — install it with npm --prefix (see .github/workflows/ci.yml)"; exit 1 ;;
esac
# The image is Ubuntu 24.04 like the runners, so the runner's libatomic fits.
node_libs="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cg-e2e-node-libs"
rm -rf "$node_libs" && mkdir -p "$node_libs"
ldd "$node_home/bin/node" | awk '$1 ~ /^libatomic\.so/ && $3 ~ /^\// { print $3 }' | while read -r lib; do cp -L "$lib" "$node_libs/"; done

[ -d "$root/node_modules" ] || { echo "::error::e2e-docker: no node_modules — run pnpm install --frozen-lockfile first"; exit 1; }

chown_to=''
if ! docker info --format '{{json .SecurityOptions}}' | grep -q rootless; then
  chown_to="$(id -u):$(id -g)"
fi

# A digest names the image exactly, so one that is already here needs no word
# from the registry: a run on the PC does not depend on Docker Hub being up.
docker image inspect "$CG_E2E_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$CG_E2E_IMAGE"
# A tag of our own: the runners' daily clean-up keeps tagged images.
digest=${CG_E2E_IMAGE##*sha256:}
docker tag "$CG_E2E_IMAGE" "cg-e2e-firefox:$digest"

# A runner of our own keeps what it pulled: every new digest in e2e-image.sh
# would leave the image of the one before, about 3 GB each, for good. So the
# job notes which digests it runs (an empty file per digest, touched by each
# run) and removes the images of the others once no run has used them for two
# weeks — a branch that still pins the earlier digest keeps its image meanwhile.
if [ "${RUNNER_ENVIRONMENT:-}" = self-hosted ]; then
  seen="${XDG_CACHE_HOME:-$HOME/.cache}/cg-e2e-images"
  mkdir -p "$seen"
  touch "$seen/$digest"
  { docker images --format '{{.Tag}}' cg-e2e-firefox 2> /dev/null || true; } | while read -r old; do
    case "$old" in '' | "$digest" | *[!0-9a-f]*) continue ;; esac
    [ -z "$(find "$seen" -name "$old" -mtime -14 2> /dev/null)" ] || continue
    # Both names of the image: our tag and the digest it was pulled by. A job
    # of another runner may be using it this minute — then it stays for now.
    docker rmi "cg-e2e-firefox:$old" "${CG_E2E_IMAGE%@*}@sha256:$old" > /dev/null 2>&1 || true
    rm -f "$seen/$old"
    echo "e2e-docker: removed the image of an earlier digest, not used for two weeks: $old"
  done
fi

remove_containers 'a container an earlier run left in this checkout'

mounts=(
  --mount "type=bind,source=$root,target=$root"
  --mount "type=bind,source=$node_home,target=$node_home,readonly"
  --mount "type=bind,source=$node_libs,target=$node_libs,readonly"
)
if [ "$pnpm_home" != "$node_home" ]; then
  mounts+=(--mount "type=bind,source=$pnpm_home,target=$pnpm_home,readonly")
fi

client=''
# shellcheck disable=SC2329 # called by the traps below
cancelled() {
  trap '' INT TERM
  echo "e2e-docker: $1 — the job is being cancelled"
  remove_containers 'the container of this run'
  # The client may not have created the container yet: stop it, then look again.
  if [ -n "$client" ]; then
    kill "$client" 2> /dev/null || true
    wait "$client" 2> /dev/null || true
  fi
  remove_containers 'the container of this run'
  exit "$2"
}
trap 'cancelled SIGINT 130' INT
trap 'cancelled SIGTERM 143' TERM

# In the background, with `wait`: bash runs a trap only between commands, and a
# signal ends `wait` at once.
docker run --name "$name" --label "$label" --rm --init --network none --shm-size 2g --user 0:0 \
  --workdir "$root" "${mounts[@]}" \
  --env "CG_NODE_BIN=$node_home/bin" --env "CG_PNPM_BIN=$pnpm_home/bin" --env "CG_NODE_LIBS=$node_libs" \
  --env NODE_OPTIONS --env CG_E2E_FIREFOX --env CG_E2E_GECKODRIVER --env CG_E2E_SHARD --env CG_E2E_TIMING_SLACK --env "CG_E2E_CHOWN=$chown_to" \
  --env CG_LONG_RUN_MINUTES --env CG_LONG_RUN_REF --env CG_LONG_RUN_SHA --env CG_E2E_IMAGE --env GITHUB_RUN_ID \
  --entrypoint bash "$CG_E2E_IMAGE" "$root/tools/ci/e2e-in-container.sh" "$@" &
client=$!
status=0
wait "$client" || status=$?
# The client is gone; so must the container be (--rm), whatever ended the client.
[ "$status" -eq 0 ] || remove_containers 'the container of this run'
exit "$status"
