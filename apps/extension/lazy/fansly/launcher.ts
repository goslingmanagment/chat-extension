// The floating launcher of a Fansly tab (decision X46; ui-design §3.13; SP-001, NF-001): «Spenders» and «Новые» in the
// bottom left corner of every fansly.com page, one chunk of Fansly's own build — plain DOM, no Preact, no kit — that
// the early bundle loads once the tab is admitted (host-fansly isolated/starter.ts). Its click asks for the application,
// which opens the window (composition/tab/hosts/fansly/app.ts). A ChatSpace tab never loads it.

export { drawFanslyLauncher } from '@cg/host-fansly/isolated/launcher-view';
