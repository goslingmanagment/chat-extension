// What every overlay surface of ours shares (architecture.md §6.3; ui-design
// §3.4): the overlay host is one closed shadow root over the whole window
// that lets clicks through, and each surface is a `.cg-root` in it. The root
// spans the window, lets clicks through and carries its layer, so that a
// fixed window, panel or scrim inside measures from the window and stacks by
// §3.4 whatever the root's own containment is (a size container may be a
// stacking context of its own). The surface's own box — a 320 px panel, a
// 720 px window — is the `cg` container its narrow rules key on, exactly as
// the dock's width is for the dock.
//
// A surface that failed to render is replaced, layer and all, by the root
// boundary's «Сбой интерфейса» card (ER-020). Left to the root's rules it
// would be a strip across the top of the window that no click reaches; it is
// a card at the top right that takes clicks, so «Перезагрузить панель» and
// «Выгрузить диагностику» work.

import { type MountSurfaceKind } from '@cg/contracts/vm';

import { LAYERS, type LayerName } from '../kit';

export function overlayRootCss(kind: MountSurfaceKind, layer: Exclude<LayerName, 'dockMenu'>): string {
  const root = `.cg-root[data-cg-surface="${kind}"]`;
  return [
    `${root} { position: fixed; inset: 0; z-index: ${LAYERS[layer]}; pointer-events: none; }`,
    `${root} > .cg-boundary { position: fixed; top: 56px; right: 16px; width: min(360px, calc(100vw - 32px)); pointer-events: auto; overflow: hidden; border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow-float); }`,
    '',
  ].join('\n');
}
