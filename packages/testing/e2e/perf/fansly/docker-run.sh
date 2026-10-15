#!/usr/bin/env bash
# One configuration of the Fansly perf scenario (R20 P3d; P16a after it) in the
# pinned e2e image, no network — the headless Firefox the new extension is
# measured in too (tools/ci/e2e-image.sh). Run it on a quiet machine: one at a
# time, nothing heavy beside it.
#
#   packages/testing/e2e/perf/fansly/docker-run.sh <run label> none <off|after>
#   packages/testing/e2e/perf/fansly/docker-run.sh <run label> old <off|after> <button|always> <old build dir>
#
# <old build dir> is the --out of old-build/build.ts (its XPI and build.json).
# More settings of the run (CG_PERF_WINDOW_MIN, CG_PERF_IDLE_SAMPLE_MIN,
# CG_PERF_ROUNDS) pass through from the environment. The evidence (report.json
# and the profiles of every configuration of the run) lands in
# .cache/e2e/perf-fansly/<run label>/ of this checkout.
#
# The run uses tools/ci/e2e-docker-local.sh with its own volume
# (CG_E2E_VOLUME, default cg-e2e-perf-fansly): step 1 copies this checkout
# into it, step 2 builds the stand there and runs e2e/perf/fansly-baseline.e2e.ts
# with the stand on the fixed ports of ports.ts. The old build waits beside the
# working tree in the volume (/sim/old-fansly), the evidence in /sim/perf-fansly.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd -P)
run=${1:?run label}
subject=${2:?none|old}
neighbor=${3:?off|after}
notes=${4:-button}
old_dir=${5:-}
volume=${CG_E2E_VOLUME:-cg-e2e-perf-fansly}
node_image=node:$(tr -d '[:space:]' < "$root/.nvmrc")-bookworm-slim
ports='{"fansly":47110,"fanslyApi":47111,"fanslySocket":47112,"hub":47114}'

case "$subject" in none | old) ;; *) echo "docker-run: subject none|old, not $subject" >&2; exit 2 ;; esac
case "$neighbor" in off | after) ;; *) echo "docker-run: neighbour off|after, not $neighbor" >&2; exit 2 ;; esac
case "$notes" in button | always) ;; *) echo "docker-run: notes button|always, not $notes" >&2; exit 2 ;; esac
if [ "$subject" = old ]; then
  [ -f "$old_dir/build.json" ] || { echo "docker-run: $old_dir is not an old-build output (no build.json)" >&2; exit 2; }
  xpi=$(cd "$old_dir" && ls old-fansly-*-stand.xpi)
  # The ports the build has compiled in must be the ones the stand listens on.
  node -e 'const b=require(process.argv[1]); const p=JSON.parse(process.argv[2]); for (const k of Object.keys(p)) if (b.ports[k]!==p[k]) { console.error(`docker-run: the old build has ${k} ${b.ports[k]}, the stand ${p[k]}`); process.exit(2); }' "$old_dir/build.json" "$ports"
  (cd "$old_dir" && COPYFILE_DISABLE=1 tar --no-xattrs -cf - "$xpi" build.json) | docker run --rm -i \
    --mount "type=volume,source=$volume,target=/sim" "$node_image" \
    bash -euo pipefail -c 'rm -rf /sim/old-fansly && mkdir -p /sim/old-fansly && tar -xf - -C /sim/old-fansly'
fi

# shellcheck disable=SC2016 # expanded inside the container
CG_E2E_VOLUME=$volume "$root/tools/ci/e2e-docker-local.sh" exec bash -euo pipefail -c '
  cd packages/testing
  pnpm build:stand > /dev/null
  echo "perf-fansly: $(nproc) CPUs, $(awk "/MemTotal/ { printf \"%.1f GiB\", \$2 / 1048576 }" /proc/meminfo) in the container"
  exec env CG_E2E_PORTS="$0" CG_PERF_RUN="$1" CG_PERF_SUBJECT="$2" CG_PERF_NEIGHBOR="$3" CG_PERF_NOTES="$4" \
    CG_PERF_OLD_XPI="/sim/old-fansly/$5" CG_PERF_EVIDENCE_DIR=/sim/perf-fansly/ \
    CG_PERF_WINDOW_MIN="$6" CG_PERF_IDLE_SAMPLE_MIN="$7" CG_PERF_ROUNDS="$8" \
    pnpm exec wdio run e2e/wdio.conf.ts --spec e2e/perf/fansly-baseline.e2e.ts
' "$ports" "$run" "$subject" "$neighbor" "$notes" "${xpi:-none}" "${CG_PERF_WINDOW_MIN:-10}" "${CG_PERF_IDLE_SAMPLE_MIN:-0}" "${CG_PERF_ROUNDS:-3}" || status=$?

mkdir -p "$root/.cache/e2e"
docker run --rm --mount "type=volume,source=$volume,target=/sim" "$node_image" \
  bash -c 'tar -cf - -C /sim perf-fansly 2> /dev/null || true' | tar -xf - -C "$root/.cache/e2e/" || true
exit "${status:-0}"
