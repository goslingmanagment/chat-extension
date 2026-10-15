// The constants of Fansly's bridge registry the isolated side needs
// synchronously at document_start. They live in @cg/contracts/bridge-fansly, a
// schema module: importing even a constant from it builds its schemas at
// startup (zod/mini builders are not pure-annotated), which the early start
// cannot afford (docs/project-unite/architecture.md §3.1). So they are
// repeated here and pinned to the contracts by bridge.test.ts; the schemas
// themselves load lazily (validate.ts, the `bridge-validation` chunk of
// Fansly's build).

import type { FanslyWireEventType } from '@cg/contracts/bridge-fansly';

/**
 * Every event frame of Fansly's port is never coalesced or dropped (contracts FANSLY_WIRE_EVENT_TYPES): a batch is
 * one step of a counted stream — MAIN holds its credits until `fx.ack` (§6) — the gap notice is one, and a fault's
 * count is the boot's own. MAIN merges Fansly's states inside its batches; there is nothing left for the client to fold.
 */
export const UNDROPPABLE_EVENTS: readonly FanslyWireEventType[] = ['fx.batch', 'fx.gap', 'fault'];
