#!/usr/bin/env bash
# Reproduces the CI job «e2e» on any machine with Docker, a Mac included: the
# same pinned image, the same in-container script, no network during the run.
# For a failure CI shows and the machine itself does not, and for checking a new
# image digest before it goes into e2e-image.sh.
#
#   tools/ci/e2e-docker-local.sh            the whole `pnpm e2e`
#   tools/ci/e2e-docker-local.sh <pnpm …>   something else, for example one spec:
#     --filter @cg/testing exec wdio run e2e/wdio.conf.ts --spec e2e/specs/stand-smoke.e2e.ts
#     (after a full run: a spec needs both builds and the built stand)
#   tools/ci/e2e-docker-local.sh --remove-container
#                                           ends the run of this checkout on the
#                                           volume, if one is going
#
# The Mac's own node_modules are built for macOS, so the run gets a Linux
# install of its own. It lives in the Docker volume CG_E2E_VOLUME (default
# cg-e2e-local): Node 26 from the official node image, pnpm at the version
# package.json pins, the pnpm store and a copy of the working tree — tracked
# files and new ones that are not ignored. Step 1 (with network) fills it,
# step 2 (no network) runs the tests. `docker volume rm cg-e2e-local` starts
# from scratch.
#
# A volume holds one run at a time: step 1 would replace the tree under a run
# that is going. So the script first looks at the containers that have the
# volume mounted — a running one is a run, and the step 1 of another start
# counts. Its own containers carry two labels — the checkout they were started
# from and the pid of the script that started them (cg-e2e.local.checkout,
# cg-e2e.local.pid) — and are named cg-e2e-<volume>-<that pid>-install and
# …-run.
# - A running container of another checkout, or one this script did not
#   start: the script ends at once with one line and touches nothing. Docker
#   on this machine is shared between sessions, and a run that is not this
#   checkout's is never removed. Wait for it, or give this run a volume of its
#   own: CG_E2E_VOLUME=<name>.
# - A running container of this checkout whose script is alive: a run that is
#   going, maybe with somebody reading it. Refused the same way; the line
#   names `--remove-container` as the way to end it.
# - A container of this checkout whose script is gone, running or not: what a
#   killed run left. Nobody reads it, so the new start removes it, says so and
#   goes on.
#
# The check is a look at what runs at that moment, not a lock. It does not
# see a start whose step 1 container is not up yet, nor a run between its two
# steps: a fraction of a second each, longer when Docker has to pull an image
# first.
#
# Stopping a run: SIGINT (Ctrl-C), SIGTERM (what an agent shell sends first
# when it stops a command) or SIGHUP to this script. It stays for both steps
# and takes the signal itself: removes the container of the run and ends with
# 128 + the signal. Left to the docker client, Ctrl-C would stop nothing: the
# client passes SIGINT into the container, where the shell goes on waiting for
# the suite, and at the third one the client quits and leaves the container.
#
# What the script cannot take leaves the container running the suite to its
# end with nobody to read it: a SIGKILL, or a signal that went to a wrapper
# around the script and not to the script. After a SIGKILL the next start in
# the same checkout on the same volume removes it. Under a dead wrapper the
# script is still alive: a signal to it ends the run, and so does
# `--remove-container`. None of these touches a container of another checkout,
# so there is no reason to reach for `docker rm -f` over everything `docker ps`
# lists.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck source=tools/ci/e2e-image.sh
. "$root/tools/ci/e2e-image.sh"

volume=${CG_E2E_VOLUME:-cg-e2e-local}
node_image=${CG_E2E_NODE_IMAGE:-node:$(tr -d '[:space:]' < "$root/.nvmrc")-bookworm-slim}
pinned=$(sed -n 's/.*"packageManager": *"\(pnpm@[0-9.]*\).*/\1/p' "$root/package.json")
[ -n "$pinned" ] || { echo "e2e-docker-local: no pnpm version in package.json packageManager" >&2; exit 1; }

# The two containers of a run are <name>-install and <name>-run. The volume is
# in the name, so `docker ps` — and the refusal below, in another session —
# says whose run it is.
name="cg-e2e-${volume#cg-e2e-}-$$"
label=cg-e2e.local
labels=(--label "$label.checkout=$root" --label "$label.pid=$$")

# Whether the script that started a container — $1, its pid — is gone: there
# is no such process, or only its remains that nobody collected. Asked of `ps`,
# which needs no leave to signal that process; when `ps` does not even know
# this script, or the pid is not a number, the answer is «alive»: a run that
# may be going is not removed on a guess.
gone() {
  local state
  [ -n "$1" ] && [ -z "${1//[0-9]/}" ] && ps -p $$ > /dev/null 2>&1 || return 1
  state=$(ps -o stat= -p "$1" 2> /dev/null) || true
  case "$state" in '' | Z*) return 0 ;; esac
  return 1
}

# Sorts the containers that have the volume mounted, whichever step of a run
# each is:
#   left   — of this checkout, and the script that started it is gone;
#   going  — of this checkout, running, its script alive;
#   busy   — every running one that is not `left`, as the refusal names it;
#   others — whether one of those is not of this checkout.
look() {
  local listing state container pid from
  listing=$(docker ps -a --filter "volume=$volume" --format "{{.State}}|{{.Names}}|{{.Label \"$label.pid\"}}|{{.Label \"$label.checkout\"}}")
  left='' going='' busy='' others=''
  while IFS='|' read -r state container pid from; do
    # One that Docker is removing this moment is nobody's business any more.
    [ -n "$container" ] && [ "$state" != removing ] || continue
    # (Its own pid on a container that is there before it started one: the number came round again.)
    if [ "$from" = "$root" ] && { [ "$pid" = "$$" ] || gone "$pid"; }; then
      left="$left $container"
      continue
    fi
    # What does not run is no run: created and never started (a client ended at the wrong moment leaves that), or ended.
    case "$state" in created | exited | dead) continue ;; esac
    if [ "$from" = "$root" ]; then going="$going $container"; else others=1; fi
    busy="${busy:+$busy, }$container${from:+ from $from}"
  done <<< "$listing"
}

if [ "${1:-}" = '--remove-container' ]; then
  look
  if [ -n "$left$going" ]; then
    # shellcheck disable=SC2086 # names of this script's making, one per word
    docker rm -f $left $going > /dev/null
    echo "e2e-docker-local: removed the container of this checkout's run on the volume $volume:$left$going"
  fi
  exit 0
fi

# One run at a time on a volume (see the header).
look
if [ -n "$others" ]; then
  echo "e2e-docker-local: the volume $volume is in use (running with it mounted: $busy) — a start now would replace the working tree under that run. Wait for it to end, or give this run a volume of its own: CG_E2E_VOLUME=<own name>" >&2
  exit 1
fi
if [ -n "$going" ]; then
  echo "e2e-docker-local: a run of this checkout is going on the volume $volume (${going# }) — a start now would replace the working tree under it. Wait for it to end, end it with ${CG_E2E_VOLUME:+CG_E2E_VOLUME=$volume }tools/ci/e2e-docker-local.sh --remove-container, or give this run a volume of its own: CG_E2E_VOLUME=<own name>" >&2
  exit 1
fi
if [ -n "$left" ]; then
  # shellcheck disable=SC2086 # names of this script's making, one per word
  docker rm -f $left > /dev/null
  echo "e2e-docker-local: an earlier run of this checkout left its container on the volume $volume, and its script is gone — removed:$left"
fi

# Removes the containers of this run and says which (`removed`). By their two
# names, never by the label: once this run's container is gone, a newer start
# in this checkout may be on the volume, and its containers are not this run's
# to remove.
remove_run() {
  # The client prints the name of each container it removed, and nothing for one that is not there.
  removed=$(docker rm -f "$name-install" "$name-run" 2> /dev/null | tr '\n' ' ') || true
  [ -z "$removed" ] || echo "e2e-docker-local: removed the container of this run: ${removed% }"
}

finished=''
# shellcheck disable=SC2329 # called by the traps below
stop() {
  # Nothing may end the script before the container is gone: not a second
  # signal, and not a reader of the output that went first (Ctrl-C ends the
  # `tee` of `… | tee log` as well, and a write to it would be the end).
  trap '' INT TERM HUP PIPE
  set +eu
  echo "e2e-docker-local: $1 — the run is being stopped"
  # From here on stderr is nobody's: all that would come is bash's own report
  # of the client killed below, the whole command in it — at once or with the
  # next command, as it happens.
  exec 2> /dev/null
  # The docker command that is going — the client of a step, most of the
  # time: $!, which names it from the moment it is started, so there is no
  # moment when a client runs and this function does not know of it. The
  # client goes first, and by SIGKILL: a SIGTERM that reaches it while it is
  # still creating the container is lost on it, and it goes on to run the
  # suite. Then the container, if the client got as far as one.
  local client=$!
  [ "$client" != "$finished" ] || client=''
  if [ -n "$client" ]; then
    kill -KILL "$client"
    wait "$client"
  fi
  remove_run
  # A client ended while it was creating its container: the container is
  # there a moment later, never started.
  if [ -n "$client" ] && [ -z "$removed" ]; then
    sleep 0.3
    remove_run
  fi
  exit "$2"
}
trap 'stop SIGINT 130' INT
trap 'stop SIGTERM 143' TERM
trap 'stop SIGHUP 129' HUP

# From here on, while there is a run to stop, the script never waits for a
# command in the foreground: every docker command is started in the background
# and waited for with `wait`, out of which a trap runs at once. While bash
# waits for a foreground command the trap has to wait too, and a SIGINT may
# not reach it at all — bash leaves that one to the command, and drops it when
# the command ends as if nothing had happened.

# Waits for the docker command just started ($1) and returns its status.
attend() {
  local status=0
  # 2>: bash's own line about a command that a signal ended, the whole command in it.
  wait "$1" 2> /dev/null || status=$?
  finished=$1
  return "$status"
}

# Waits for the docker client of a step ($1). A step that did not end with 0
# ends the script with the same status — after its container is removed:
# whatever ended the client (a SIGKILL, a reader of its output that is gone)
# may have left the container running.
step() {
  local status=0
  attend "$1" || status=$?
  [ "$status" -eq 0 ] || { remove_run; exit "$status"; }
}

echo "e2e-docker-local: step 1 — Linux install in the volume $volume ($node_image, $pinned)"
# COPYFILE_DISABLE: macOS tar would otherwise add a `._name` twin for every file
# with extended attributes, and the test runners would take those for tests.
# --init, as in step 2: a SIGTERM or SIGHUP that the client passes on ends the
# container. Without it the install is process 1 there and ignores both.
(cd "$root" && git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --null -T - -cf -) | docker run --name "$name-install" "${labels[@]}" --rm --init -i \
  --mount "type=volume,source=$volume,target=/sim" \
  --env "PINNED=$pinned" --env CI=true "$node_image" bash -euo pipefail -c '
    mkdir -p /sim/work /sim/node /sim/node-libs /sim/pnpm /sim/store
    # The working tree is replaced whole; installed dependencies stay.
    find /sim/work -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
    tar -xf - -C /sim/work
    if [ "$(/sim/node/bin/node --version 2> /dev/null)" != "$(node --version)" ]; then
      rm -rf /sim/node && mkdir -p /sim/node && cp -a /usr/local/bin /usr/local/lib /sim/node/
    fi
    # Node 26 links libatomic; the Firefox image has none.
    ldd /usr/local/bin/node | awk "\$1 ~ /^libatomic\\.so/ && \$3 ~ /^\\// { print \$3 }" | while read -r lib; do cp -L "$lib" /sim/node-libs/; done
    if [ "pnpm@$(PATH=/sim/node/bin:$PATH /sim/pnpm/bin/pnpm --version 2> /dev/null)" != "$PINNED" ]; then
      rm -rf /sim/pnpm && npm install --global --prefix /sim/pnpm --no-audit --no-fund "$PINNED" > /dev/null
    fi
    cd /sim/work
    PATH=/sim/pnpm/bin:/sim/node/bin:$PATH pnpm install --frozen-lockfile --store-dir /sim/store
  ' &
step $!

echo "e2e-docker-local: step 2 — the run, no network"
docker image inspect "$CG_E2E_IMAGE" > /dev/null 2>&1 &
if ! attend $!; then
  docker pull --quiet "$CG_E2E_IMAGE" &
  attend $!
fi
docker run --name "$name-run" "${labels[@]}" --rm --init --network none --shm-size 2g --user 0:0 \
  --workdir /sim/work --mount "type=volume,source=$volume,target=/sim" \
  --env CG_NODE_BIN=/sim/node/bin --env CG_PNPM_BIN=/sim/pnpm/bin --env CG_NODE_LIBS=/sim/node-libs \
  --env NODE_OPTIONS --env CG_E2E_FIREFOX --env CG_E2E_GECKODRIVER \
  --entrypoint bash "$CG_E2E_IMAGE" /sim/work/tools/ci/e2e-in-container.sh "$@" &
step $!
