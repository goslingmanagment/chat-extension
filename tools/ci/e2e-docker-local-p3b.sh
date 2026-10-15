#!/usr/bin/env bash
# The P3b harness — packages/testing/e2e/specs/p3b-signed-builds.e2e.ts, the
# release gate's check of SIGNED test builds (docs/project-unite/spike.md
# «P3b: как прогнать») — in the pinned Firefox image with no network, through
# e2e-docker-local.sh (its own volume: CG_E2E_VOLUME, default cg-e2e-p3b).
#
#   tools/ci/e2e-docker-local-p3b.sh             the latest set's signed builds:
#                                                .release/test-builds/<set>/signed/{n0,n,n1,control}.xpi
#                                                (pnpm release test-builds, then the owner's
#                                                pnpm release sign --test-builds)
#   tools/ci/e2e-docker-local-p3b.sh --stand-in  unsigned stand-ins of this tree, made inside the
#                                                container (pnpm release test-builds) and run with
#                                                CG_P3B_UNSIGNED=1: proves the harness, not the signature
#
# The report: .cache/e2e/p3b-report.json inside the volume, and the log.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
export CG_E2E_VOLUME=${CG_E2E_VOLUME:-cg-e2e-p3b}
spec='pnpm --filter @cg/testing build:stand && pnpm --filter @cg/testing exec wdio run e2e/wdio.conf.ts --spec e2e/specs/p3b-signed-builds.e2e.ts'

if [ "${1:-}" = --stand-in ]; then
  # No git in the container's copy of the tree: the set records no commit, which is what keeps it from ever being signed.
  exec "$root/tools/ci/e2e-docker-local.sh" exec bash -c "pnpm release test-builds && set=\$(ls -d .release/test-builds/*/ | tail -1) && \
    export CG_P3B_UNSIGNED=1 CG_P3B_XPI_N0=\$(ls \${set}chatgoose-p3b-n0-*.xpi) CG_P3B_XPI_N=\$(ls \${set}chatgoose-p3b-n-*.xpi) CG_P3B_XPI_N1=\$(ls \${set}chatgoose-p3b-n1-*.xpi) CG_P3B_XPI_CONTROL=\$(ls \${set}chatgoose-p3b-control-*.xpi) && $spec"
fi
[ "$#" -eq 0 ] || { echo "usage: tools/ci/e2e-docker-local-p3b.sh [--stand-in]" >&2; exit 2; }

set_dir=''
for dir in "$root"/.release/test-builds/*/; do
  [ -f "$dir/signed/n0.xpi" ] && [ -f "$dir/signed/n.xpi" ] && [ -f "$dir/signed/n1.xpi" ] && [ -f "$dir/signed/control.xpi" ] && set_dir=${dir%/}
done
[ -n "$set_dir" ] || { echo "e2e-docker-local-p3b: no signed set in .release/test-builds/ — pnpm release test-builds, then pnpm release sign --test-builds (docs/release.md «Подписанные тестовые сборки (P3b)»)" >&2; exit 1; }
signed=${set_dir#"$root"/}/signed
echo "e2e-docker-local-p3b: the signed set $signed"
export CG_E2E_WITH=$signed CG_P3B_XPI_N0=$signed/n0.xpi CG_P3B_XPI_N=$signed/n.xpi CG_P3B_XPI_N1=$signed/n1.xpi CG_P3B_XPI_CONTROL=$signed/control.xpi
unset CG_P3B_UNSIGNED
exec "$root/tools/ci/e2e-docker-local.sh" exec bash -c "$spec"
