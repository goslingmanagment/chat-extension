#!/usr/bin/env bash
# Runs INSIDE the pinned Firefox image (e2e-image.sh), started by e2e-docker.sh
# (the CI job) or e2e-docker-local.sh (a local reproduction). The container has
# no network (--network none): the stand, the fake hub and the egress sink
# listen on its own loopback, and nothing else is reachable.
#
# In: the checkout with installed dependencies as the working directory, and
#   CG_NODE_BIN, CG_PNPM_BIN            folders with `node` and `pnpm` (mounted in)
#   CG_NODE_LIBS (optional)             a folder with the shared libraries Node
#                                       needs and the image lacks (libatomic)
#   CG_E2E_FIREFOX, CG_E2E_GECKODRIVER  the versions e2e-image.sh promises
#   CG_E2E_CHOWN (optional) uid:gid     who gets the files this run created
#                                       (a rootful daemon: the container's root
#                                       is the real root)
#   CG_E2E_SHARD (optional) <k>/<n>     run part k of n of the spec files
#                                       (e2e/wdio.conf.ts reads it)
#   CG_E2E_TIMING_SLACK (optional)     e2e timing multiplier (CI job: 3; unset: 1)
# Everything after the script name goes to pnpm instead of `e2e` (for example
# `--filter @cg/testing exec wdio run e2e/wdio.conf.ts --spec …`).
set -euo pipefail

: "${CG_NODE_BIN:?}" "${CG_PNPM_BIN:?}" "${CG_E2E_FIREFOX:?}" "${CG_E2E_GECKODRIVER:?}"
export PATH="$CG_PNPM_BIN:$CG_NODE_BIN:$PATH"
if [ -n "${CG_NODE_LIBS:-}" ]; then
  export LD_LIBRARY_PATH="$CG_NODE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Firefox refuses to start as root when $HOME belongs to somebody else.
export HOME=/tmp/cg-e2e-home
mkdir -p "$HOME"

hand_back() {
  local status=$?
  if [ -n "${CG_E2E_CHOWN:-}" ]; then
    find "$PWD" -xdev -user "$(id -u)" -exec chown -h "$CG_E2E_CHOWN" {} + || true
  fi
  exit "$status"
}
trap hand_back EXIT

# Node comes from outside the image: say plainly when it cannot start here.
if ! node_version=$(node --version 2>&1); then
  echo "::error::Node does not start inside the image: $node_version"
  ldd "$CG_NODE_BIN/node" || true
  exit 1
fi
pnpm_version=$(pnpm --version)

firefox_bin=$(command -v firefox)
gecko_bin=$(command -v geckodriver)
# "Mozilla Firefox 156.0"; the sandbox warning about user namespaces goes to stderr.
firefox_version=$("$firefox_bin" --version 2> /dev/null | awk '{ print $NF }')
# "geckodriver 0.37.1 (300705c65d1b 2026-07-17 09:25 +0000)"
gecko_version=$("$gecko_bin" --version | awk 'NR == 1 { print $2 }')

mismatch=0
if [ "$firefox_version" != "$CG_E2E_FIREFOX" ]; then
  echo "::error::the image has Firefox $firefox_version, tools/ci/e2e-image.sh says $CG_E2E_FIREFOX"
  mismatch=1
fi
if [ "$gecko_version" != "$CG_E2E_GECKODRIVER" ]; then
  echo "::error::the image has geckodriver $gecko_version, tools/ci/e2e-image.sh says $CG_E2E_GECKODRIVER"
  mismatch=1
fi
[ "$mismatch" = 0 ] || exit 1

# The suite was written on the owner's Mac and measures what that Firefox
# shows; three settings make this one show the same.
# - A Russian-language browser: the extension follows navigator.languages, and
#   the specs read Russian texts. intl.accept_languages is a localized pref —
#   a default value is read as the address of a string bundle — so it is set
#   as a user value, by AutoConfig.
# - Overlay scrollbars, as on macOS: a classic scrollbar takes 6 px out of a
#   column the specs measure.
# - -moz-osx-font-smoothing, which only a Mac build parses by default: one
#   spec reads it back from the stand.
firefox_home=$(dirname "$(readlink -f "$firefox_bin")")
cat > "$firefox_home/defaults/pref/cg-e2e.js" << 'PREFS'
pref("general.config.filename", "cg-e2e.cfg");
pref("general.config.obscure_value", 0);
pref("ui.useOverlayScrollbars", 1);
pref("layout.css.osx-font-smoothing.enabled", true);
PREFS
cat > "$firefox_home/cg-e2e.cfg" << 'CFG'
// AutoConfig: the first line is always skipped.
pref("intl.accept_languages", "ru-RU, ru, en-US, en");
CFG

# WebdriverIO fetches geckodriver from GitHub before the first session unless
# the version it is asked for already lies in its cache folder as
# geckodriver-<version>; it then starts the binary GECKODRIVER_PATH names.
# Hand it the image's own, so the run needs no network.
wdio_cache=/tmp/cg-e2e-wdio
mkdir -p "$wdio_cache"
ln -sf "$gecko_bin" "$wdio_cache/geckodriver-$gecko_version"
export GECKODRIVER_VERSION="$gecko_version"
export WEBDRIVER_CACHE_DIR="$wdio_cache"
export GECKODRIVER_PATH="$gecko_bin"
export FIREFOX_BIN="$firefox_bin"
export CI=true

echo "e2e: Firefox $firefox_version, geckodriver $gecko_version, Node $node_version, pnpm $pnpm_version, timing slack ${CG_E2E_TIMING_SLACK:-1}x, no network${CG_E2E_SHARD:+, part $CG_E2E_SHARD of the suite}"
if [ "$#" -eq 0 ]; then set -- e2e; fi
pnpm "$@"
