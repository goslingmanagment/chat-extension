// The request registry of a Fansly tab's protocol (architecture.md §5.4; R20 docs/project-unite/architecture.md §1.6,
// §12; P13b): the shared registry, whose schemas check every shared answer and event once the application is loaded —
// and the site's own types (`fansly.*`) let through as they came. Fansly's registry (tab-messages-fansly.ts) beside
// the shared one would not fit this layer, which every Fansly page with our application loads (§3.1): the site's code
// that asks a `fansly.*` request checks its answer by that registry itself, in its own chunk
// (composition/tab/hosts/fansly/requests.ts). The background checked it on the way out already.

import { parseTabPayload as parseShared, type TabPayloadCheck } from '@cg/contracts/tab-messages';

/** Every type of Fansly's registry starts with it (tab-messages-fansly.ts `FANSLY_TAB_TYPE_PREFIX`); no shared type does. */
const FANSLY_TYPES = 'fansly.';

export function parseTabPayload(kind: 'req' | 'res' | 'evt', type: string, payload: unknown): TabPayloadCheck {
  return type.startsWith(FANSLY_TYPES) ? { ok: true, payload } : parseShared(kind, type, payload);
}
