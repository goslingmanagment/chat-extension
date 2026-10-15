// Fansly's side of the early hotkey dispatcher (docs/project-unite/
// architecture.md §7.9, §9.1). The probe itself — where the focus is, the
// hand-over of a key to our own UI as a copy that cannot leave our closed
// root, the mark of a waiting key — is the shared mechanics of the page
// (@cg/host-kit/isolated/keyboard.ts). What is Fansly's own comes with the
// work packages that know it: its message field and its own windows
// (`body.modal-opened`, the neighbour's `fb-*-ui`, Enter left to the page) with
// P7i, the route of the open chat with P7c. Until then (R20 P7a0) the probe
// knows no field of Fansly's as its composer and no window of its own as open,
// and the route by the address is no chat.

import { createKeyboardProbe as createProbe, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

/**
 * The route by the address alone, for the first moments of a document. `epoch` is the path: a key kept for the lazy
 * part runs only on the same one. No path is a chat yet (P7c reads Fansly's routes).
 */
export function routeOfLocation(location: Pick<Location, 'pathname'>): { readonly kind: 'chat' | 'account' | 'other'; readonly epoch: string } {
  return { kind: 'other', epoch: location.pathname };
}

/** The shared probe without Fansly's two rules yet (P7i): no field is its message field, no window of its own is open. */
export const createKeyboardProbe = (doc: Document, registry: ShadowRootRegistry): KeyboardProbe =>
  createProbe(
    doc,
    registry,
    () => false,
    () => false,
  );
