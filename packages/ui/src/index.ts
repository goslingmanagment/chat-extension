// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).
//
// Every surface has its own subpath, and a bundle takes only the one it
// mounts: `@cg/ui/dock`, `@cg/ui/overlays`, `@cg/ui/spenders`,
// `@cg/ui/newcomers`, `@cg/ui/fanpanel`, `@cg/ui/palette`, `@cg/ui/preview`,
// `@cg/ui/pages`.
// The kit all of them use is `@cg/ui/kit`. This root entry exports nothing on
// purpose: importing «the UI» as a whole would pull every surface into one
// chunk.

export {};
