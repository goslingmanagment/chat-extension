// The two small decisions of the background's composition root that are
// its own (the rest is the packages'): which ChatSpace tab runs a click made
// on an extension page (background/tab-command.ts), and whether an action
// token may be issued while the bootstrap is what it is
// (background/token-gate.ts, architecture.md §8.3).

import type { CgErrorWire } from '@cg/contracts';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { featureSlice } from '@cg/core/domain/features';
import type { TabPresence } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { pickCommandTab, type CommandTab } from '../src/composition/background/tab-command.ts';
import { CHATSPACE_FEATURE_SLICE as FEATURES } from '../src/composition/features/chatspace.ts';
import { NAVIGATE_SWITCHES, tokenRefusal, type TokenGateHub } from '../src/composition/background/token-gate.ts';

const tab = (n: number, registeredAt = n): CommandTab => ({ tabSessionId: `tab-${n}`, tabId: n, registeredAt });
const seen = (n: number, over: { focused?: boolean; visible?: boolean; accounts?: `chatspace:${string}`[]; updatedAt?: number } = {}): TabPresence => ({
  tabSessionId: `tab-${n}`,
  chat: null,
  chatKey: null,
  routeEpoch: 1,
  visible: over.visible ?? true,
  focused: over.focused ?? false,
  accounts: over.accounts ?? ['chatspace:1001'],
  routeAccount: null,
  fanLabel: null,
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

  it('a generation and a send are not judged here: their own requests read the bootstrap', async () => {
    const s = state({ session: null, bootstrap: null, flags: { insertion: { usable: false, reason: 'flag_off' } } });
    expect(await tokenRefusal('generate', 'dock', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('send', 'preview', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(0);
  });

  it('nobody signed in: navigation needs no hub, an insert has nothing to insert', async () => {
    const s = state({ session: null, bootstrap: null });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-AUTH-REQUIRED' });
    expect(s.refreshes).toBe(0);
  });

  it('signed in without a bootstrap: navigation is ChatSpace’s own; an insert waits for the bootstrap to be read', async () => {
    const s = state({ bootstrap: null, flags: { insertion: { usable: false, reason: 'hub_not_ready' } } });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    s.refresh = () => {
      s.flags['insertion'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(1);
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

  it('[AU-027] the insert of a ready result on an expired bootstrap with a silent hub (X45): what the cached one admits goes, what it switched off does not; a hub that answers is heard; without a cached one nothing goes', async () => {
    const expired = { usable: false, reason: 'bootstrap_expired' };
    for (const code of ['CG-HUB-UNAVAILABLE', 'CG-HUB-TIMEOUT', 'CG-NETWORK', 'CG-TIMEOUT'] as const) {
      const s = state({ flags: { insertion: expired } });
      s.refresh = () => Promise.reject(new Error(code));
      expect([code, await tokenRefusal('insert', 'dock', hubOf(s), () => ({ code }), FEATURES)]).toEqual([code, null]);
      // The cached bootstrap had the owner's switch off: the insert stays refused, with that reason.
      s.cached['insertion'] = { usable: false, reason: 'flag_off' };
      expect([code, await tokenRefusal('insert', 'dock', hubOf(s), () => ({ code }), FEATURES)]).toEqual([code, { code: 'CG-FEATURE-DISABLED', detail: 'flag_off' }]);
    }
    // The hub answered — signed out, refused, outdated: its word stands, the cached bootstrap is not asked.
    for (const code of ['CG-AUTH-REVOKED', 'CG-HUB-FORBIDDEN', 'CG-HUB-OUTDATED', 'CG-HUB-RATE-LIMIT'] as const) {
      const s = state({ flags: { insertion: expired } });
      s.refresh = () => Promise.reject(new Error(code));
      expect(await tokenRefusal('insert', 'dock', hubOf(s), () => ({ code }), FEATURES)).toEqual({ code });
    }
    // No bootstrap was ever read in this sign-in: nothing to judge by.
    const none = state({ bootstrap: null, flags: { insertion: { usable: false, reason: 'hub_not_ready' } } });
    none.refresh = () => Promise.reject(new Error('offline'));
    expect(await tokenRefusal('insert', 'dock', hubOf(none), wire, FEATURES)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
    // A hub layer that cannot say what its cached bootstrap holds admits nothing on an expired one.
    const bare = state({ flags: { insertion: expired } });
    bare.refresh = () => Promise.reject(new Error('offline'));
    const full = hubOf(bare);
    const older: TokenGateHub = { session: () => full.session(), cachedBootstrap: () => full.cachedBootstrap(), flagState: (flag, page) => full.flagState(flag, page), bootstrap: () => full.bootstrap() };
    expect(await tokenRefusal('insert', 'dock', older, wire, FEATURES)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
  });

  it('a fresh bootstrap: the owner’s switch decides, and nothing is read again', async () => {
    const s = state({ flags: { insertion: { usable: false, reason: 'flag_off' } } });
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(0);
  });

  it('[R20-F4] an insert is admitted by the feature manifest of the tab’s site: some feature whose result can be inserted must admit it', async () => {
    const off = { usable: false, reason: 'flag_off' };
    // ChatSpace: a draft's insert asks `insertion` alone — Coach being off closes nothing, and `insertion` off closes every insert.
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { coach: off, review: off, recap: off } })), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { insertion: off } })), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    // Fansly: a draft needs the page's own `drafts` on top of `insertion`; a Coach answer is inserted under Coach's
    // switch, a voice note's file under `voice` — any one of them admits the write, and with all three off none does.
    const fansly = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);
    expect(await tokenRefusal('insert', 'dock', hubOf(state()), wire, fansly)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { drafts: off, voice: off } })), wire, fansly)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { drafts: off, coach: off } })), wire, fansly)).toBeNull();
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { drafts: off, coach: off, voice: off } })), wire, fansly)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('insert', 'dock', hubOf(state({ flags: { insertion: off, voice: off } })), wire, fansly)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    // An expired bootstrap is read again once, as before: the hub layer's own reason comes through the admission.
    const expired = state({ flags: { insertion: { usable: false, reason: 'bootstrap_expired' }, voice: off } });
    expired.refresh = () => {
      expired.flags['insertion'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('insert', 'dock', hubOf(expired), wire, fansly)).toBeNull();
    expect(expired.refreshes).toBe(1);
    // A site the extension has no slice for, or one where nothing can be inserted: no token, and nothing is read again.
    const s = state();
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, null)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'platform_unsupported' });
    const { review, recap, spenders } = FEATURES;
    expect(await tokenRefusal('insert', 'dock', hubOf(s), wire, { review, recap, spenders } as FeatureSlice)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'platform_unsupported' });
    expect(s.refreshes).toBe(0);
    // A navigation asks the switches of its surface, whatever the slice: it is not an action of a feature.
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, null)).toBeNull();
  });

  it('[SP-035] a click on a fan in a board asks the board’s switch, never `navigation`: with `navigation` off everywhere the board still opens the chat', async () => {
    const off = { usable: false, reason: 'flag_off' };
    const s = state({ flags: { navigation: off } });
    // Our own navigation (J/K, ⌘U, ⌘1–9, quick jump, the palette's chats) is the owner's `navigation`…
    for (const surface of ['overlay', 'dock', 'coach'] as const) expect(await tokenRefusal('navigate', surface, hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    // …a Spenders row, a preview, a card of «Новые» are not.
    expect(await tokenRefusal('navigate', 'preview', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('navigate', 'newcomers', hubOf(s), wire, FEATURES)).toBeNull();
    expect(NAVIGATE_SWITCHES).toMatchObject({ overlay: ['navigation'], preview: ['spenders', 'preview'], newcomers: ['newcomers', 'preview'] });
    expect(Object.values(NAVIGATE_SWITCHES).filter((flags) => flags.includes('navigation'))).toHaveLength(3);
  });

  it('[SP-035] a board that is off on every page opens nothing, whatever `navigation` says; one of its switches on is enough here — the page’s own is the tab’s to ask', async () => {
    const off = { usable: false, reason: 'flag_off' };
    const s = state({ flags: { spenders: off, preview: off, newcomers: { usable: false, reason: 'hub_not_ready' } } });
    expect(await tokenRefusal('navigate', 'overlay', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('navigate', 'preview', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    // «Новые» without its hub route: the refresh is tried once, and its reason is what the person is told.
    expect(await tokenRefusal('navigate', 'newcomers', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'hub_not_ready' });
    expect(s.refreshes).toBe(1);
    s.flags['preview'] = { usable: true, reason: null };
    expect(await tokenRefusal('navigate', 'preview', hubOf(s), wire, FEATURES)).toBeNull();
    expect(await tokenRefusal('navigate', 'newcomers', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(1);
  });

  it('[AU-027] a board’s click on an expired bootstrap reads it again once, like any other write', async () => {
    const expired = { usable: false, reason: 'bootstrap_expired' };
    const s = state({ flags: { spenders: expired, preview: expired } });
    s.refresh = () => Promise.reject(new Error('offline'));
    expect(await tokenRefusal('navigate', 'preview', hubOf(s), wire, FEATURES)).toEqual({ code: 'CG-NETWORK', detail: 'offline' });
    s.refresh = () => {
      s.flags['spenders'] = { usable: true, reason: null };
      return Promise.resolve();
    };
    expect(await tokenRefusal('navigate', 'preview', hubOf(s), wire, FEATURES)).toBeNull();
    expect(s.refreshes).toBe(2);
  });
});
