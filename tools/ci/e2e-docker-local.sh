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
#
# The Mac's own node_modules are built for macOS, so the run gets a Linux
# install of its own. It lives in the Docker volume CG_E2E_VOLUME (default
# cg-e2e-local): Node 26 from the official node image, pnpm at the version
# package.json pins, the pnpm store and a copy of the working tree — tracked
# files and new ones that are not ignored. Step 1 (with network) fills it,
# step 2 (no network) runs the tests. `docker volume rm cg-e2e-local` starts
# from scratch.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck source=tools/ci/e2e-image.sh
. "$root/tools/ci/e2e-image.sh"

volume=${CG_E2E_VOLUME:-cg-e2e-local}
node_image=${CG_E2E_NODE_IMAGE:-node:$(tr -d '[:space:]' < "$root/.nvmrc")-bookworm-slim}
pinned=$(sed -n 's/.*"packageManager": *"\(pnpm@[0-9.]*\).*/\1/p' "$root/package.json")
[ -n "$pinned" ] || { echo "e2e-docker-local: no pnpm version in package.json packageManager" >&2; exit 1; }

echo "e2e-docker-local: step 1 — Linux install in the volume $volume ($node_image, $pinned)"
# COPYFILE_DISABLE: macOS tar would otherwise add a `._name` twin for every file
# with extended attributes, and the test runners would take those for tests.
(cd "$root" && git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --null -T - -cf -) | docker run --rm -i \
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
docker pull --quiet "$CG_E2E_IMAGE"
exec docker run --rm --init --network none --shm-size 2g --user 0:0 \
  --workdir /sim/work --mount "type=volume,source=$volume,target=/sim" \
  --env CG_NODE_BIN=/sim/node/bin --env CG_PNPM_BIN=/sim/pnpm/bin --env CG_NODE_LIBS=/sim/node-libs \
  --env NODE_OPTIONS --env CG_E2E_FIREFOX --env CG_E2E_GECKODRIVER \
  --entrypoint bash "$CG_E2E_IMAGE" /sim/work/tools/ci/e2e-in-container.sh "$@"
