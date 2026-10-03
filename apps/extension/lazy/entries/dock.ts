// First dock chunk (architecture.md §10.1, §11: ≤ 45 KiB gzip with Preact).
// Loaded by the isolated content script with import(moz-extension://…/lazy/dock.js)
// as soon as a composer is found; shares Preact with every other UI chunk.
//
// TEMPORARY content (M1): the status row of the integration step. R14's dock
// takes this entry over.

export { mountTempDock, type TempDockSmokeModel } from '@cg/ui';
