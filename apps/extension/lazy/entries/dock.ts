// First dock chunk (architecture.md §10.1, §11: ≤ 45 KiB gzip with Preact):
// the dock above ChatSpace's composer, the toast host (not lazy, §10.1) and
// the kit's mount helper every other surface is mounted with. Loaded by the
// tab's application with the first composer; every other UI chunk shares
// Preact and the kit with it.

export { mountDockSurface } from '@cg/ui/dock';
export { mountKitSurface, type KitFailure, type KitMount, type SurfaceDefinition } from '@cg/ui/kit';
export { createToastHost, mountToasts, type ToastHost } from '@cg/ui/overlays';
