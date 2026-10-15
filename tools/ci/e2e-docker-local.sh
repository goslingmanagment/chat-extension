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
#   CG_E2E_SHARD=2/5 tools/ci/e2e-docker-local.sh   one part of the suite, as a CI job runs it
#   CG_E2E_WITH=<folder>   a folder git ignores, copied into the tree of the run
#                          as well (the signed XPIs of P3b: e2e-docker-local-p3b.sh);
#                          CG_P3B_* reach the run (p3b-signed-builds.e2e.ts)
#
# The Mac's own node_modules are built for macOS, so the run gets a Linux
# install of its own. It lives in the Docker volume CG_E2E_VOLUME (default
# cg-e2e-local): Node 26 from the official node image, pnpm at the version
# package.json pins, the pnpm store and a copy of the working tree — tracked
# files and new ones that are not ignored. Step 1 (with network) fills it,
# step 2 (no network) runs the tests. `docker volume rm cg-e2e-local` starts
# from scratch.
#
# A volume that a run is using is left alone: step 1 would replace the tree
# under that run. While a running container has the volume mounted — the step
# 1 of another start counts — the script ends at once with one line and
# touches nothing. Wait for that run, or give this one a volume of its own:
# CG_E2E_VOLUME=<name>.
#
# The check is a look at what runs at that moment, not a lock. It does not
# see a start whose step 1 container is not up yet, nor a run between its two
# steps: a fraction of a second each, longer when Docker has to pull an image
# first.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck source=tools/ci/e2e-image.sh
. "$root/tools/ci/e2e-image.sh"

volume=${CG_E2E_VOLUME:-cg-e2e-local}
node_image=${CG_E2E_NODE_IMAGE:-node:$(tr -d '[:space:]' < "$root/.nvmrc")-bookworm-slim}
pinned=$(sed -n 's/.*"packageManager": *"\(pnpm@[0-9.]*\).*/\1/p' "$root/package.json")
[ -n "$pinned" ] || { echo "e2e-docker-local: no pnpm version in package.json packageManager" >&2; exit 1; }

# One run at a time on a volume (see the header): any running container that
# has it mounted counts, whichever step of a run it is.
busy=$(docker ps --filter "volume=$volume" --format '{{.Names}}')
[ -z "$busy" ] || { echo "e2e-docker-local: the volume $volume is in use (running with it mounted: ${busy//$'\n'/, }) — a start now would replace the working tree under that run. Wait for it to end, or give this run a volume of its own: CG_E2E_VOLUME=<own name>" >&2; exit 1; }

echo "e2e-docker-local: step 1 — Linux install in the volume $volume ($node_image, $pinned)"
# COPYFILE_DISABLE: macOS tar would otherwise add a `._name` twin for every file
# with extended attributes, and the test runners would take those for tests.
# --no-xattrs: it would still write the attributes themselves, as pax headers,
# and GNU tar in the container prints «Ignoring unknown extended header keyword
# 'LIBARCHIVE.xattr.<name>'» for each — at least one line per file, as every
# file an agent checked out or wrote carries com.apple.provenance.
with=${CG_E2E_WITH:-}
if [ -n "$with" ]; then
  case "$with" in /* | *..*) echo "e2e-docker-local: CG_E2E_WITH must be a folder inside the checkout, relative to its root: $with" >&2; exit 1 ;; esac
  [ -d "$root/$with" ] || { echo "e2e-docker-local: CG_E2E_WITH: no folder $root/$with" >&2; exit 1; }
fi
(cd "$root" && { git ls-files -co --exclude-standard -z; if [ -n "$with" ]; then find "$with" -type f -print0; fi; } | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf -) | docker run --rm -i \
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
  '

echo "e2e-docker-local: step 2 — the run, no network"
docker image inspect "$CG_E2E_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$CG_E2E_IMAGE"
exec docker run --rm --init --network none --shm-size 2g --user 0:0 \
  --workdir /sim/work --mount "type=volume,source=$volume,target=/sim" \
  --env CG_NODE_BIN=/sim/node/bin --env CG_PNPM_BIN=/sim/pnpm/bin --env CG_NODE_LIBS=/sim/node-libs \
  --env NODE_OPTIONS --env CG_E2E_FIREFOX --env CG_E2E_GECKODRIVER --env CG_E2E_SHARD --env CG_E2E_TIMING_SLACK \
  --env CG_P3B_XPI_N0 --env CG_P3B_XPI_N --env CG_P3B_XPI_N1 --env CG_P3B_XPI_CONTROL --env CG_P3B_UNSIGNED \
  --entrypoint bash "$CG_E2E_IMAGE" /sim/work/tools/ci/e2e-in-container.sh "$@"
