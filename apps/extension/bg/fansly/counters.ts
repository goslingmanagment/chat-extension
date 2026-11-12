// What our requests to Fansly do, in Fansly's `client_health` window (2026-11-12; fansly-api observe.ts): how many we
// sent, how many 429s came back and whose, how often a chatter's action was refused with «Fansly просит паузу». The
// window's counters go to the hub every 15 minutes with consent (`client_health_counters_hourly`), beside the tabs'
// `router.refused` and the background's `freshness.*`. Machine tokens only: a purpose, a source, a code.

import type { FanslyObservation, FanslyObserver, FanslyPurpose } from '@cg/fansly-api';

/**
 * The background's own reads: their refusals reach no chatter (the window keeps what it had, the identity's failure is
 * asked again later). Every other purpose answers a person's click, a pass or an upload they started.
 */
const UNSEEN: ReadonlySet<FanslyPurpose> = new Set<FanslyPurpose>(['badges', 'online', 'identity']);

/** The counter of an observation; null — not counted. */
export function fanslyCounter(observation: FanslyObservation): string | null {
  switch (observation.kind) {
    case 'sent':
      return `fansly.req.own.${observation.purpose}`;
    case 'limited':
      if (observation.source === 'own') return `fansly.429.own.${observation.purpose ?? 'unknown'}`;
      return observation.source === 'page' ? 'fansly.429.page' : 'fansly.429.other';
    case 'refused':
      return UNSEEN.has(observation.purpose) ? null : 'CG-FAN-RATE-LIMIT';
  }
}

/** The API's observer over the site's window (`kit.telemetry.count`). */
export const fanslyObserver = (count: (name: string) => void): FanslyObserver => (observation) => {
  const name = fanslyCounter(observation);
  if (name !== null) count(name);
};
