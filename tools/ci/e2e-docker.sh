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
# Linux only (GNU readlink). On a Mac use e2e-docker-local.sh.
# Arguments go to pnpm instead of `e2e`.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
# shellcheck source=tools/ci/e2e-image.sh
. "$root/tools/ci/e2e-image.sh"

for tool in docker node pnpm; do
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
docker tag "$CG_E2E_IMAGE" "cg-e2e-firefox:${CG_E2E_IMAGE##*sha256:}"

mounts=(
  --mount "type=bind,source=$root,target=$root"
  --mount "type=bind,source=$node_home,target=$node_home,readonly"
  --mount "type=bind,source=$node_libs,target=$node_libs,readonly"
)
if [ "$pnpm_home" != "$node_home" ]; then
  mounts+=(--mount "type=bind,source=$pnpm_home,target=$pnpm_home,readonly")
fi

exec docker run --rm --init --network none --shm-size 2g --user 0:0 \
  --workdir "$root" "${mounts[@]}" \
  --env "CG_NODE_BIN=$node_home/bin" --env "CG_PNPM_BIN=$pnpm_home/bin" --env "CG_NODE_LIBS=$node_libs" \
  --env NODE_OPTIONS --env CG_E2E_FIREFOX --env CG_E2E_GECKODRIVER --env "CG_E2E_CHOWN=$chown_to" \
  --entrypoint bash "$CG_E2E_IMAGE" "$root/tools/ci/e2e-in-container.sh" "$@"
