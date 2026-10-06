# The image the CI job «e2e» runs `pnpm e2e` in (architecture.md §13: «Firefox и
# geckodriver в rootless Docker на раннере, образ закреплён по digest»). Sourced
# by e2e-docker.sh and e2e-docker-local.sh.
#
# selenium/standalone-firefox, the multi-arch index (linux/amd64 for the
# runners, linux/arm64 for a local reproduction on an Apple Silicon Mac), on
# Ubuntu 24.04. Only its Firefox and its geckodriver are used: the entry point
# is replaced, no Selenium server starts.
#
# The two versions below are what that digest holds. e2e-in-container.sh
# compares them with the binaries and fails on a difference, so a new digest
# cannot go in without saying which Firefox it brings. How to move to a newer
# one: docs/release.md, «Образ для e2e».

# shellcheck shell=bash
CG_E2E_IMAGE='selenium/standalone-firefox@sha256:430b43aa2a573ad692fdde106e19330bdae68c8d5841615c45fd7627225d81d6'
CG_E2E_FIREFOX='156.0'
CG_E2E_GECKODRIVER='0.37.1'
export CG_E2E_IMAGE CG_E2E_FIREFOX CG_E2E_GECKODRIVER
