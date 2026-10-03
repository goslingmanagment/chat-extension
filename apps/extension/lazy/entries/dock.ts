// First dock chunk (architecture.md §10.1, §11: ≤ 45 KiB gzip with Preact).
// Loaded by the isolated content script with import(moz-extension://…/lazy/dock.js)
// as soon as a composer is found; shares Preact with every other lazy chunk.

export { mountDock, type DockHandle, type DockModel } from '@cg/ui';
