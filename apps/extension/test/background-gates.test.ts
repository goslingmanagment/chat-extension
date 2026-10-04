// The two small decisions of the background's composition root that are
// its own (the rest is the packages'): which ChatSpace tab runs a click made
// on an extension page (background/tab-command.ts), and whether an action
// token may be issued while the bootstrap is what it is
// (background/token-gate.ts, architecture.md §8.3).

import type { CgErrorWire } from '@cg/contracts';
import type { TabPresence } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { pickCommandTab, type CommandTab } from '../src/composition/background/tab-command.ts';
import { tokenRefusal, type TokenGateHub } from '../src/composition/background/token-gate.ts';

const tab = (n: number, registeredAt = n): CommandTab => ({ tabSessionId: `tab-${n}`, tabId: n, registeredAt });
const seen = (n: number, over: { focused?: boolean; visible?: boolean; accounts?: `chatspace:${string}`[]; updatedAt?: number } = {}): TabPresence => ({
  tabSessionId: `tab-${n}`,
  chat: null,
  chatKey: null,
  routeEpoch: 1,
  visible: over.visible ?? true,
  focused: over.focused ?? false,
  accounts: over.accounts ?? ['chatspace:1001'],
  updatedAt: over.updatedAt ?? n,
});

describe('which tab runs a page’s command', () => {
  const spenders = { kind: 'surface', surface: 'spenders' } as const;

  it('[PU-017] the tab in front: focused before visible, visible before hidden, the last to report before the rest', () => {
    expect(pickCommandTab(spenders, [], [])).toBeNull();
    expect(pickCommandTab(spenders, [tab(1), tab(2), tab(3)], [seen(1, { visible: false }), seen(2), seen(3, { focused: true })])?.tabId).toBe(3);
    expect(pickCommandTab(spenders, [tab(1), tab(2)], [seen(1, { visible: false }), seen(2)])?.tabId).toBe(2);
    expect(pickCommandTab(spenders, [tab(1), tab(2)], [seen(1, { updatedAt: 50 }), seen(2, { updatedAt: 20 })])?.tabId).toBe(1);
    // A focused tab the browser no longer shows (minimized) is not «in front».
    expect(pickCommandTab(spenders, [tab(1), tab(2)], [seen(1, { focused: true, visible: false }), seen(2)])?.tabId).toBe(2);
    // Tabs that registered and have not reported yet: the newest registration.
    expect(pickCommandTab(spenders, [tab(1, 100), tab(2, 300), tab(3, 200)], [])?.tabId).toBe(2);
  });

  it('[ST-076] an account goes only to a tab whose ChatSpace has it; the one in front among them', () => {
    const account = { kind: 'account', host: 'chatspace', hostAccountId: '1002' } as const;
    expect(pickCommandTab(account, [tab(1), tab(2)], [seen(1, { focused: true }), seen(2)])).toBeNull();
    expect(pickCommandTab(account, [tab(1), tab(2), tab(3)], [seen(1, { focused: true }), seen(2, { accounts: ['chatspace:1002'] }), seen(3, { accounts: ['chatspace:1001', 'chatspace:1002'], focused: true })])?.tabId).toBe(3);
    // A tab that has not said which accounts it shows cannot be chosen for one.
    expect(pickCommandTab(account, [tab(1)], [])).toBeNull();
  });
});

describe('the token gate over the bootstrap', () => {
  interface State {
    session: object | null;
    bootstrap: object | null;
    flags: Record<string, { usable: boolean; reason: string | null }>;
    refresh: () => Promise<void>;
    refreshes: number;
  }
  const hubOf = (state: State): TokenGateHub => ({
    session: () => state.session,
    cachedBootstrap: () => state.bootstrap,
    flagState: (flag) => state.flags[flag] ?? { usable: true, reason: null },
    bootstrap: () => {
      state.refreshes += 1;
      return state.refresh();
    },
  });
  const state = (over: Partial<State> = {}): State => ({ session: {}, bootstrap: {}, flags: {}, refresh: () => Promise.resolve(), refreshes: 0, ...over });
  const wire = (error: unknown): CgErrorWire => ({ code: 'CG-NETWORK', detail: String((error as Error).message) });

  it('a generation and a send are not judged here: their own requests read the bootstrap', async () => {
    const s = state({ session: null, bootstrap: null, flags: { insertion: { usable: false, reason: 'flag_off' } } });
    expect(await tokenRefusal('generate', hubOf(s), wire)).toBeNull();
    expect(await tokenRefusal('send', hubOf(s), wire)).toBeNull();
    expect(s.refreshes).toBe(0);
  });

  it('nobody signed in: navigation needs no hub, an insert has nothing to insert', async () => {
    const s = state({ session: null, bootstrap: null });
    expect(await tokenRefusal('navigate', hubOf(s), wire)).toBeNull();
    expect(await tokenRefusal('insert', hubOf(s), wire)).toEqual({ code: 'CG-AUTH-REQUIRED' });
    expect(s.refreshes).toBe(0);
  });

  it('signed in without a bootstrap: navigation is ChatSpace’s own; an insert waits for the bootstrap to be read', async () => {
    const s = state({ bootstrap: null, flags: { insertion: { usable: false, reason: 'hub_not_ready' } } });
    expect(await tokenRefusal('navigate', hubOf(s), wire)).toBeNull();
    s.refresh = () => {
      s.flags['insertion'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('insert', hubOf(s), wire)).toBeNull();
    expect(s.refreshes).toBe(1);
  });

  it('[AU-027] an expired bootstrap is read again once: a hub that answers lets the action through, a silent one refuses it with its own reason', async () => {
    const s = state({ flags: { insertion: { usable: false, reason: 'bootstrap_expired' }, navigation: { usable: false, reason: 'bootstrap_expired' } } });
    s.refresh = () => Promise.reject(new Error('offline'));
    expect(await tokenRefusal('insert', hubOf(s), wire)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
    expect(await tokenRefusal('navigate', hubOf(s), wire)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
    expect(s.refreshes).toBe(2);
    s.refresh = () => {
      s.flags['insertion'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('insert', hubOf(s), wire)).toBeNull();
    // The refresh landed and the owner had switched navigation off meanwhile.
    s.refresh = () => {
      s.flags['navigation'] = { usable: false, reason: 'flag_off' };
      return Promise.resolve();
    };
    expect(await tokenRefusal('navigate', hubOf(s), wire)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
  });

  it('a fresh bootstrap: the owner’s switch decides, and nothing is read again', async () => {
    const s = state({ flags: { insertion: { usable: false, reason: 'flag_off' } } });
    expect(await tokenRefusal('insert', hubOf(s), wire)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('navigate', hubOf(s), wire)).toBeNull();
    expect(s.refreshes).toBe(0);
  });
});
