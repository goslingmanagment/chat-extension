// host-fansly/main — Fansly's MAIN world, at document_start (docs/project-unite/
// architecture.md §5, §3.1): one self-contained bundle, `fansly-main.js`
// (≤ 16 KiB gzip, ≤ 1 ms at document_start). It carries the shared boot of
// host-kit — the handshake with the isolated script, the MessagePort, `probe`,
// `guard` — and, from P7a on, Fansly's own runtime: the construct traps on
// WebSocket and XMLHttpRequest, the parse of frames and answers, the
// observation, the `fx.batch` emitter. Until then (R20 P7a0) the boot stands
// alone: it answers `probe` itself and every other request with `not-ready`.
//
// The page's own world: nothing of ours may throw into it (decision X22) —
// the boot guards its own callbacks; the entry point keeps a failed install
// to itself.

import { installMainBridge, type MainBridgeHandle } from '@cg/host-kit/main/bridge';

/** Installs Fansly's MAIN world in `win`: today the shared boot of host-kit alone (its runtime is P7a's). */
export function installFanslyMain(win: Window = window): MainBridgeHandle {
  return installMainBridge(win);
}
