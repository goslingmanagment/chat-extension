// The two copies of FS-NET-1 agree (spec §4; architecture.md §13): the
// client's (packages/fansly-api allowlist.ts), which decides what we ask, and
// the fake Fansly's (journal.ts `FS_NET_1`), which checks every call of ours
// as it arrives on the stand. Every route of the client is a route the server
// knows under the same name and in its list; the server lists nothing the
// client lacks.

import { addressOf, FANSLY_API_BASE, FANSLY_ROUTE_NAMES, FANSLY_ROUTES } from '@cg/fansly-api';
import { describe, expect, it } from 'vitest';

import { routeOf } from './api';
import { FS_NET_1 } from './journal';

describe('FS-NET-1 on both sides', () => {
  it('[FS-NET-1] [RB-022] every route the client may ask is the server\'s route of the same name and is on its list; the lists are equal', () => {
    for (const route of FANSLY_ROUTE_NAMES) {
      const spec = FANSLY_ROUTES[route];
      const path = Object.fromEntries([...spec.path.matchAll(/:([a-z]+)/g)].map((match) => [match[1] ?? '', '300000000000000001']));
      const address = addressOf(FANSLY_API_BASE, route, { path });
      expect(address, route).not.toBeNull();
      expect(routeOf(spec.method, new URL(address ?? '').pathname)?.route.name, route).toBe(route);
    }
    expect([...FS_NET_1].sort()).toEqual([...FANSLY_ROUTE_NAMES].sort());
    expect(FS_NET_1.has('message.ack')).toBe(false);
  });
});
