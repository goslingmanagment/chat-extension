// Whether the background's composition root may issue an action token while
// the bootstrap is what it is (background/token-gate.ts, architecture.md §8.3).

import type { CgErrorWire } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { CHATSPACE_FEATURE_SLICE as FEATURES } from '../src/composition/features/chatspace.ts';
import { tokenRefusal, type TokenGateHub } from '../src/composition/background/token-gate.ts';

describe('the token gate over the bootstrap', () => {
  interface State {
    session: object | null;
    bootstrap: object | null;
    flags: Record<string, { usable: boolean; reason: string | null }>;
    /** What the cached bootstrap says of a switch, fresh or expired (X45); absent — usable. */
    cached: Record<string, { usable: boolean; reason: string | null }>;
    refresh: () => Promise<void>;
    refreshes: number;
  }
  const hubOf = (state: State): TokenGateHub => ({
    session: () => state.session,
    cachedBootstrap: () => state.bootstrap,
    flagState: (flag) => state.flags[flag] ?? { usable: true, reason: null },
    cachedFlagState: (flag) => state.cached[flag] ?? { usable: true, reason: null },
    bootstrap: () => {
      state.refreshes += 1;
      return state.refresh();
    },
  });
  const state = (over: Partial<State> = {}): State => ({ session: {}, bootstrap: {}, flags: {}, cached: {}, refresh: () => Promise.resolve(), refreshes: 0, ...over });
  const wire = (error: unknown): CgErrorWire => ({ code: 'CG-NETWORK', detail: String((error as Error).message) });

  it('nobody signed in: navigation needs no hub, an insert has nothing to insert', async () => {
    const s = state({ session: null, bootstrap: null });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-AUTH-REQUIRED' });
    expect(s.refreshes).toBe(0);
  });

  it('[AU-027] an expired bootstrap is read again once: a hub that answers lets the action through, a silent one refuses a navigation with its own reason — and lets a ready result be inserted by the cached bootstrap (X45)', async () => {
    const s = state({ flags: { insertion: { usable: false, reason: 'bootstrap_expired' }, navigation: { usable: false, reason: 'bootstrap_expired' } } });
    s.refresh = () => Promise.reject(new Error('offline'));
    // X45 (X12 п. 19 reversed for inserts): the hub does not answer — the cached bootstrap still admits the insert.
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
    expect(s.refreshes).toBe(2);
    s.refresh = () => {
      s.flags['insertion'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toBeNull();
    // The refresh landed and the owner had switched navigation off meanwhile.
    s.refresh = () => {
      s.flags['navigation'] = { usable: false, reason: 'flag_off' };
      return Promise.resolve();
    };
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
  });

  it('a fresh bootstrap: the owner’s switch decides, and nothing is read again', async () => {
    const s = state({ flags: { insertion: { usable: false, reason: 'flag_off' } } });
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(0);
  });
});
