// core/services: action tokens (§14), tab sessions (§5.1, §5.4), the
// readiness barrier (§7 «Фон и выгрузка»), the WS tap switch (§6.8 п. 10)
// and the small port helpers.

import { describe, expect, it } from 'vitest';

import { ACTION_TOKEN_PATTERN, DEFAULT_SETTINGS, PresenceStoreSchema, STORAGE_KEYS, STORAGE_LIMITS, type Bootstrap, type HostAccount, type SettingsV1 } from '@cg/contracts';
import {
  AbortSwitch,
  AccountPresence,
  ACTION_TOKEN_TTL_MS,
  ACTION_TOKENS_PER_TAB,
  ActionTokens,
  LAZY_TIMING,
  LazyLoadStatus,
  NO_CHANGE,
  PRESENCE_WRITE_WINDOW_MS,
  Readiness,
  TabSessions,
  WriteQueue,
  WsTapSwitch,
  onInstalledPlan,
  settingsChangePlan,
  type LazyStatus,
} from '@cg/core/services';
import { BOOTSTRAP_PILOT_ON } from '@cg/testing/hub';

import { FakeClock, LogRecorder, MemoryStore, sequentialIds, settle } from './support/clock';
import { NOW_MS, chatOf, uuid } from './support/world';

const TAB = uuid(0xa1);
const OTHER_TAB = uuid(0xa2);

describe('[AI-120] [BG-001] one-time action tokens bound to a trusted event', () => {
  const tokens = (): { clock: FakeClock; t: ActionTokens } => {
    const clock = new FakeClock(NOW_MS);
    return { clock, t: new ActionTokens(clock, sequentialIds(1)) };
  };

  it('[AI-120] a token is accepted once, for its tab, kind and surface, before its deadline', () => {
    const { clock, t } = tokens();
    const issued = t.issue(TAB, 'send', 'preview');
    expect(issued.actionToken).toMatch(ACTION_TOKEN_PATTERN);
    expect(issued.expiresAt).toBe(NOW_MS + ACTION_TOKEN_TTL_MS);
    // Another tab cannot spend (or burn) it.
    expect(t.check({ tabSessionId: OTHER_TAB, kind: 'send', surface: 'preview', actionToken: issued.actionToken })).toBe('other-tab');
    expect(t.redeem({ tabSessionId: TAB, kind: 'send', surface: 'preview', actionToken: issued.actionToken })).toBe(true);
    expect(t.check({ tabSessionId: TAB, kind: 'send', surface: 'preview', actionToken: issued.actionToken })).toBe('unknown');
    const kind = t.issue(TAB, 'insert', 'dock');
    expect(t.check({ tabSessionId: TAB, kind: 'navigate', surface: 'dock', actionToken: kind.actionToken })).toBe('other-kind');
    const surface = t.issue(TAB, 'generate', 'dock');
    expect(t.check({ tabSessionId: TAB, kind: 'generate', surface: 'preview', actionToken: surface.actionToken })).toBe('other-surface');
    const late = t.issue(TAB, 'generate', 'dock');
    clock.t += ACTION_TOKEN_TTL_MS;
    expect(t.check({ tabSessionId: TAB, kind: 'generate', surface: 'dock', actionToken: late.actionToken })).toBe('expired');
  });

  it('[AI-120] a token refused for its kind or surface is spent too: the right request after it is refused', () => {
    const { t } = tokens();
    const wrongKind = t.issue(TAB, 'send', 'preview');
    expect(t.redeem({ tabSessionId: TAB, kind: 'generate', surface: 'preview', actionToken: wrongKind.actionToken })).toBe(false);
    expect(t.redeem({ tabSessionId: TAB, kind: 'send', surface: 'preview', actionToken: wrongKind.actionToken })).toBe(false);
    const wrongSurface = t.issue(TAB, 'send', 'preview');
    expect(t.redeem({ tabSessionId: TAB, kind: 'send', surface: 'newcomers', actionToken: wrongSurface.actionToken })).toBe(false);
    expect(t.redeem({ tabSessionId: TAB, kind: 'send', surface: 'preview', actionToken: wrongSurface.actionToken })).toBe(false);
    expect(t.outstanding(TAB)).toBe(0);
  });

  it('[BG-001] an expired token is refused even when nothing swept it yet; a closed tab takes its tokens along', () => {
    const { clock, t } = tokens();
    const issued = t.issue(TAB, 'generate', 'dock');
    clock.t += ACTION_TOKEN_TTL_MS + 1;
    expect(t.check({ tabSessionId: TAB, kind: 'generate', surface: 'dock', actionToken: issued.actionToken })).toBe('expired');
    t.issue(TAB, 'generate', 'dock');
    t.issue(OTHER_TAB, 'generate', 'dock');
    t.dropTab(TAB);
    expect(t.outstanding(TAB)).toBe(0);
    expect(t.outstanding(OTHER_TAB)).toBe(1);
  });

  it('[BG-001] a tab cannot pile up tokens; ids that do not fit the pattern or repeat are drawn again', () => {
    const clock = new FakeClock(NOW_MS);
    const draws = ['bad token!', 'tok_dup_00000000000000', 'tok_dup_00000000000000', 'tok_fresh_0000000000000'];
    let i = 0;
    const t = new ActionTokens(clock, { token: () => draws[Math.min(i++, draws.length - 1)] ?? '' });
    expect(t.issue(TAB, 'generate', 'dock').actionToken).toBe('tok_dup_00000000000000');
    expect(t.issue(TAB, 'generate', 'dock').actionToken).toBe('tok_fresh_0000000000000');
    const many = new ActionTokens(clock, sequentialIds(1));
    const first = many.issue(TAB, 'generate', 'dock');
    for (let n = 0; n < ACTION_TOKENS_PER_TAB + 5; n += 1) many.issue(TAB, 'generate', 'dock');
    expect(many.outstanding(TAB)).toBe(ACTION_TOKENS_PER_TAB);
    expect(many.redeem({ tabSessionId: TAB, kind: 'generate', surface: 'dock', actionToken: first.actionToken })).toBe(false);
  });
});

describe('[BG-002] [BG-003] [BG-006] [RB-019] [UP-009] tab sessions', () => {
  const sessions = (): TabSessions => new TabSessions(new FakeClock(NOW_MS), sequentialIds(0xc00), { contractsVersion: '1.0.0', testBuild: false });
  const request = { host: 'chatspace' as const, lateInjection: false, contractsVersion: '1.0.0' };

  it('[BG-002] the background mints the session; a request is accepted only from that tab, top frame and document', () => {
    const s = sessions();
    const outcome = s.register({ tabId: 7, frameId: 0, documentId: 'doc-a' }, request);
    if (!outcome.ok) throw new Error('register');
    expect(outcome.response).toEqual({ tabSessionId: uuid(0xc00), contractsVersion: '1.0.0', testBuild: false });
    expect(outcome.session.needsReload).toBe(false);
    const id = outcome.response.tabSessionId;
    expect(s.verify(id, { tabId: 7, frameId: 0, documentId: 'doc-a' })).toBe(true);
    expect(s.verify(id, { tabId: 7, frameId: 0, documentId: null })).toBe(true);
    expect(s.verify(id, { tabId: 8, frameId: 0, documentId: 'doc-a' })).toBe(false);
    expect(s.verify(id, { tabId: 7, frameId: 3, documentId: 'doc-a' })).toBe(false);
    expect(s.verify(id, { tabId: 7, frameId: 0, documentId: 'doc-b' })).toBe(false);
    expect(s.verify(uuid(0xdead), { tabId: 7, frameId: 0, documentId: 'doc-a' })).toBe(false);
    expect(s.register({ tabId: 7, frameId: 2, documentId: 'doc-a' }, request)).toEqual({ ok: false, reason: 'not-top-frame' });
  });

  it('[BG-002] [RB-010] a reloaded or reconnected tab replaces its session; [UP-009] a late or foreign-contract tab must reload', () => {
    const s = sessions();
    const a = s.register({ tabId: 7, frameId: 0, documentId: 'doc-a' }, request);
    const b = s.register({ tabId: 7, frameId: 0, documentId: 'doc-b' }, { ...request, lateInjection: true });
    if (!a.ok || !b.ok) throw new Error('register');
    expect(b.replaced).toBe(a.response.tabSessionId);
    expect(s.get(a.response.tabSessionId)).toBeNull();
    expect(b.session.needsReload).toBe(true);
    const c = s.register({ tabId: 9, frameId: 0, documentId: null }, { ...request, contractsVersion: '0.9.0' });
    expect(c.ok && c.session.needsReload).toBe(true);
  });

  it('[RB-019] a chat change resets the fan of the tab context; [BG-006] [BG-003] closing ends the session and the keep-alive', () => {
    const s = sessions();
    const outcome = s.register({ tabId: 7, frameId: 0, documentId: 'doc-a' }, request);
    if (!outcome.ok) throw new Error('register');
    const id = outcome.response.tabSessionId;
    expect(s.keepAlive).toBe(true);
    expect(s.setPresence(id, { chat: chatOf('2002'), routeEpoch: 1, visible: true, focused: true })).toEqual({ known: true, chatChanged: true });
    expect(s.setPresence(id, { chat: chatOf('2002'), routeEpoch: 2, visible: false, focused: false })).toEqual({ known: true, chatChanged: false });
    expect(s.setPresence(id, { chat: null, routeEpoch: 3, visible: true, focused: true })).toEqual({ known: true, chatChanged: true });
    expect(s.setPresence(uuid(0xdead), { chat: null, routeEpoch: 3, visible: true, focused: true })).toEqual({ known: false, chatChanged: false });
    s.setPresence(id, { chat: chatOf('2003'), routeEpoch: 4, visible: true, focused: true });
    expect(s.chatOf(id)).toEqual(chatOf('2003'));
    expect(s.sessions()).toHaveLength(1);
    expect(s.closeTab(7)).toBe(id);
    expect(s.closeTab(7)).toBeNull();
    expect(s.keepAlive).toBe(false);
    const again = s.register({ tabId: 8, frameId: 0, documentId: null }, request);
    if (!again.ok) throw new Error('register');
    expect(s.close(again.response.tabSessionId)).toBe(true);
    expect(s.close(again.response.tabSessionId)).toBe(false);
    expect(s.chatOf(again.response.tabSessionId)).toBeNull();
  });
});

describe('[AU-034] [AU-035] accounts this browser has seen, and the tabs that show them', () => {
  const account = (hostAccountId: string, platformAccountId: string | null = null): HostAccount => ({ host: 'chatspace', hostAccountId, platform: 'onlyfans', platformAccountId, username: `acc_${hostAccountId}`, displayName: null });
  const presence = (store = new MemoryStore(), clock = new FakeClock(NOW_MS), log = new LogRecorder()): { p: AccountPresence; store: MemoryStore; clock: FakeClock; log: LogRecorder } => ({
    p: new AccountPresence({ clock, store, log }),
    store,
    clock,
    log,
  });

  it('[AU-034] a tab holds several accounts at once; each account counts the open tabs that show it; the route binds the tab\'s chat to its account', () => {
    const { p } = presence();
    p.report(TAB, [account('1001'), account('1002')]);
    p.report(OTHER_TAB, [account('1002')]);
    expect(p.list().map((row) => [row.account.hostAccountId, row.openTabs])).toEqual([
      ['1001', 1],
      ['1002', 2],
    ]);
    // The tab switched its ChatSpace to one account only.
    p.report(TAB, [account('1002')]);
    expect(p.list().find((row) => row.account.hostAccountId === '1001')?.openTabs).toBe(0);
    p.tabClosed(OTHER_TAB);
    expect(p.list().find((row) => row.account.hostAccountId === '1002')?.openTabs).toBe(1);
    // The same fan id on another account is another chat: the tab context follows the route's account.
    const s = new TabSessions(new FakeClock(NOW_MS), sequentialIds(0xc80), { contractsVersion: '1.0.0', testBuild: false });
    const reg = s.register({ tabId: 3, frameId: 0, documentId: null }, { host: 'chatspace', lateInjection: false, contractsVersion: '1.0.0' });
    if (!reg.ok) throw new Error('register');
    s.setPresence(reg.response.tabSessionId, { chat: chatOf('2002'), routeEpoch: 1, visible: true, focused: true });
    expect(s.setPresence(reg.response.tabSessionId, { chat: { ...chatOf('2002'), hostAccountId: '1002' }, routeEpoch: 2, visible: true, focused: true }).chatChanged).toBe(true);
  });

  it('[AU-035] a new account is registered at once; lastSeenAt updates are written once per 30 s window; the store survives a restart', async () => {
    const { p, store, clock } = presence();
    p.report(TAB, [account('1001')]);
    await settle();
    expect(store.writes).toBe(1);
    clock.t += 5_000;
    p.report(TAB, [account('1001', '3003')]);
    p.report(OTHER_TAB, [account('1001', '3003')]);
    await settle();
    expect(store.writes).toBe(1);
    await clock.advance(PRESENCE_WRITE_WINDOW_MS);
    expect(store.writes).toBe(2);
    const stored = store.data.get(STORAGE_KEYS.presence);
    expect(PresenceStoreSchema.safeParse(stored).success).toBe(true);
    expect(stored).toEqual({ v: 1, accounts: [{ account: account('1001', '3003'), lastSeenAt: new Date(NOW_MS + 5_000).toISOString() }] });
    // Nothing changed: a flush writes nothing.
    await p.flush();
    expect(store.writes).toBe(2);
    const next = presence(store, clock);
    expect(await next.p.restore()).toEqual({ kept: 1, damaged: false });
    expect(next.p.list()).toEqual([{ account: account('1001', '3003'), lastSeenAt: new Date(NOW_MS + 5_000).toISOString(), openTabs: 0 }]);
  });

  it('[AU-035] a damaged store starts empty and is logged; a failed write is tried again with the next one', async () => {
    const store = new MemoryStore();
    store.data.set(STORAGE_KEYS.presence, { v: 2, accounts: 'x' });
    const { p, log } = presence(store);
    expect(await p.restore()).toEqual({ kept: 0, damaged: true });
    expect(log.entries.some((e) => e.msg === 'presence store unreadable, starting empty')).toBe(true);
    expect(await presence(new MemoryStore()).p.restore()).toEqual({ kept: 0, damaged: false });
    store.failWrites = true;
    p.report(TAB, [account('1001')]);
    await settle();
    expect(log.entries.some((e) => e.msg === 'presence store write failed')).toBe(true);
    store.failWrites = false;
    await p.flush();
    expect(store.data.get(STORAGE_KEYS.presence)).toMatchObject({ v: 1, accounts: [{ account: { hostAccountId: '1001' } }] });
  });

  it('[AU-035] the newest seenAccountsMax stay; an account an open tab shows is never dropped', () => {
    const { p, clock } = presence();
    p.report(TAB, [account('9000')]);
    for (let i = 0; i < STORAGE_LIMITS.seenAccountsMax + 3; i += 1) {
      clock.t += 1;
      p.report(OTHER_TAB, [account(String(10_000 + i))]);
    }
    const rows = p.list();
    expect(rows.length).toBeLessThanOrEqual(STORAGE_LIMITS.seenAccountsMax + 1);
    expect(rows.some((row) => row.account.hostAccountId === '9000')).toBe(true);
    expect(rows.some((row) => row.account.hostAccountId === '10000')).toBe(false);
    expect(rows[0]?.account.hostAccountId).toBe(String(10_000 + STORAGE_LIMITS.seenAccountsMax + 2));
  });
});

describe('[BG-004] [AU-018] [UP-008] the readiness barrier', () => {
  it('[BG-004] requests wait for one readiness; a failed step is recorded and logged, never fatal', async () => {
    const log = new LogRecorder();
    const ready = new Readiness(log);
    const order: string[] = [];
    const handler = ready.gate((x: number) => {
      order.push(`handler ${x}`);
      return x * 2;
    });
    const answer = handler(21);
    await settle();
    expect(order).toEqual([]);
    const failures = await ready.start([
      {
        name: 'settings',
        run: () => {
          order.push('settings');
          return Promise.resolve();
        },
      },
      { name: 'ops', run: () => Promise.reject(new Error('damaged')), code: 'CG-STORAGE-READ' },
      {
        name: 'send-journal',
        run: () => {
          order.push('journal');
          return Promise.resolve();
        },
      },
    ]);
    expect(await answer).toBe(42);
    expect(order).toEqual(['settings', 'journal', 'handler 21']);
    expect(failures).toEqual([{ name: 'ops', code: 'CG-STORAGE-READ' }]);
    expect(ready.done).toBe(true);
    expect(log.entries[0]).toMatchObject({ level: 'error', code: 'CG-STORAGE-READ', fields: { step: 'ops' } });
    expect(await ready.start([{ name: 'again', run: () => Promise.reject(new Error('x')) }])).toEqual([{ name: 'ops', code: 'CG-STORAGE-READ' }]);
    expect(ready.failures()).toHaveLength(1);
  });

  it('[AU-018] the interface answers without the hub: readiness has no hub step; [UP-008] an update only logs', async () => {
    const ready = new Readiness();
    await ready.start([{ name: 'settings', run: () => Promise.reject(new Error('no store')) }]);
    expect(await ready.gate(() => 'settings view')()).toBe('settings view');
    expect(onInstalledPlan('update')).toEqual({ log: true, contactHub: false, openOnboarding: false });
    expect(onInstalledPlan('install')).toEqual({ log: true, contactHub: false, openOnboarding: true });
  });
});

describe('[NEW-08] the WS tap switch follows the wsTap flag', () => {
  const pilot: Bootstrap = BOOTSTRAP_PILOT_ON;

  it('[NEW-08] registers on, unregisters off, serializes a burst so the last wish wins', async () => {
    const calls: boolean[] = [];
    let release: () => void = () => undefined;
    const tap = new WsTapSwitch({
      sync: (enabled) =>
        new Promise<void>((resolve) => {
          calls.push(enabled);
          release = resolve;
        }),
    });
    const changes: boolean[] = [];
    const off = tap.onChange((on) => changes.push(on));
    const first = tap.fromBootstrap(pilot);
    void tap.apply(false);
    const last = tap.apply(true);
    release();
    await settle();
    release();
    await settle();
    expect(await first).toBe(true);
    expect(await last).toBe(true);
    expect(calls).toEqual([true]);
    expect(tap.state).toBe(true);
    const offing = tap.fromBootstrap({ ...pilot, flags: { ...pilot.flags, wsTap: false } });
    await settle();
    release();
    expect(await offing).toBe(false);
    expect(calls).toEqual([true, false]);
    expect(changes).toEqual([true, false]);
    off();
    expect(WsTapSwitch.wanted(null)).toBe(false);
  });

  it('[NEW-08] a wish that is already applied does not jam the switch: the next change of the flag still syncs', async () => {
    const calls: boolean[] = [];
    const tap = new WsTapSwitch({
      sync: (enabled) => {
        calls.push(enabled);
        return Promise.resolve();
      },
    });
    expect(await tap.fromBootstrap(pilot)).toBe(true);
    // The same bootstrap again (a refresh on focus, a new issuedAt): nothing to do, in the same tick.
    expect(await tap.fromBootstrap(pilot)).toBe(true);
    expect(await tap.apply(true)).toBe(true);
    expect(calls).toEqual([true]);
    // The owner switches the tap off, then a sign-out, then on again.
    expect(await tap.fromBootstrap({ ...pilot, flags: { ...pilot.flags, wsTap: false } })).toBe(false);
    expect(await tap.fromBootstrap(null)).toBe(false);
    expect(await tap.fromBootstrap(pilot)).toBe(true);
    expect(calls).toEqual([true, false, true]);
    expect(tap.state).toBe(true);
  });

  it('[NEW-08] a wish made while the queue is finishing is not lost, whichever microtask it lands in', async () => {
    // The registrar as the composition root builds it: the browser call, then `.then(() => undefined)`.
    for (let microtasks = 0; microtasks <= 12; microtasks += 1) {
      const calls: boolean[] = [];
      let registered = false;
      let release: () => void = () => undefined;
      const tap = new WsTapSwitch({
        sync: (enabled) =>
          new Promise<void>((resolve) => {
            calls.push(enabled);
            release = resolve;
          }).then(() => {
            registered = enabled;
          }),
      });
      void tap.apply(true);
      await settle();
      release();
      for (let i = 0; i < microtasks; i += 1) await Promise.resolve();
      // A sign-out or the flag going off, right behind the registration.
      const off = tap.apply(false);
      for (let round = 0; round < 3; round += 1) {
        await settle();
        release();
      }
      expect({ microtasks, state: await off, registered, calls }).toEqual({ microtasks, state: false, registered: false, calls: [true, false] });
      expect(tap.state).toBe(false);
    }
  });

  it('[NEW-08] a wish made in the same tick as one that changes nothing is still applied', async () => {
    const calls: boolean[] = [];
    const tap = new WsTapSwitch({
      sync: (enabled) => {
        calls.push(enabled);
        return Promise.resolve();
      },
    });
    expect(await tap.apply(false)).toBe(false);
    // Nothing to do — and, before that queue is released, the flag comes on.
    void tap.apply(false);
    expect(await tap.apply(true)).toBe(true);
    expect(tap.state).toBe(true);
    expect(calls).toEqual([false, true]);
  });

  it('[NEW-08] a listener may ask for another state from inside its notification', async () => {
    const calls: boolean[] = [];
    const tap = new WsTapSwitch({
      sync: (enabled) => {
        calls.push(enabled);
        return Promise.resolve();
      },
    });
    let asked = false;
    tap.onChange((on) => {
      if (on && !asked) {
        asked = true;
        void tap.apply(false);
      }
    });
    expect(await tap.apply(true)).toBe(false);
    expect(calls).toEqual([true, false]);
    expect(tap.state).toBe(false);
  });

  it('[NEW-08] a failed registration leaves the tap reported off', async () => {
    const log = new LogRecorder();
    const tap = new WsTapSwitch({ sync: () => Promise.reject(new Error('scripting refused')) }, log);
    expect(await tap.apply(true)).toBe(false);
    expect(tap.state).toBe(false);
    expect(log.entries[0]).toMatchObject({ scope: 'bg.ws-tap', msg: 'tap sync failed' });
    const ok = new WsTapSwitch({ sync: () => Promise.resolve() });
    expect(await ok.apply(false)).toBe(false);
    expect(await ok.apply(false)).toBe(false);
  });
});

describe('ports: the abort switch and the write queue', () => {
  it('[RB-016] an abort fires its listeners once, late listeners at once', () => {
    const abort = new AbortSwitch();
    const seen: string[] = [];
    abort.signal.addEventListener('abort', () => seen.push('a'));
    expect(abort.aborted).toBe(false);
    abort.abort();
    abort.abort();
    abort.signal.addEventListener('abort', () => seen.push('b'));
    expect(seen).toEqual(['a', 'b']);
    expect(abort.signal.aborted).toBe(true);
  });

  it('[BG-004] writes run one after another, a failed one does not stop the next', async () => {
    const queue = new WriteQueue();
    const order: number[] = [];
    const a = queue.run(async () => {
      await settle(1);
      order.push(1);
    });
    const b = queue.run(() => Promise.reject(new Error('x')));
    const c = queue.run(() => {
      order.push(3);
      return Promise.resolve('c');
    });
    await expect(b).rejects.toThrow('x');
    expect(await c).toBe('c');
    await a;
    await queue.idle();
    expect(order).toEqual([1, 3]);
  });
});

describe('[BG-005] what a settings change means', () => {
  const withPersonas = (byPageId: SettingsV1['personas']['byPageId']): SettingsV1 => ({ ...DEFAULT_SETTINGS, personas: { scope: null, byPageId } });
  const choice = { key: 'default', definitionId: 'pdef_0123456789abcdef' };

  it('[BG-005] any change is broadcast; nothing changed — nothing to do', () => {
    expect(settingsChangePlan(DEFAULT_SETTINGS, structuredClone(DEFAULT_SETTINGS))).toBe(NO_CHANGE);
    expect(settingsChangePlan(null, DEFAULT_SETTINGS)).toEqual({ broadcastSettings: true, environment: [], reset: [] });
    expect(settingsChangePlan(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, hints: !DEFAULT_SETTINGS.ui.hints } })).toEqual({ broadcastSettings: true, environment: [], reset: [] });
  });

  it('[BG-005] a new hub address cancels the old hub and drops the board, the catalog and the persona choices', () => {
    const next = { ...DEFAULT_SETTINGS, hub: { baseUrl: 'https://hub.example.test' } };
    expect(settingsChangePlan(DEFAULT_SETTINGS, next)).toEqual({ broadcastSettings: true, environment: [{ kind: 'hub', origin: 'https://hub.example.test' }], reset: ['board', 'catalog', 'personas'] });
  });

  it('[AI-126] a changed, added or removed persona choice is a persona change of exactly that page', () => {
    const plan = settingsChangePlan(withPersonas({ '11': choice, '12': choice }), withPersonas({ '11': { ...choice, definitionId: 'pdef_fedcba9876543210' }, '13': choice }));
    expect(plan.environment).toEqual([
      { kind: 'persona', pageId: 11, next: { ...choice, definitionId: 'pdef_fedcba9876543210' } },
      { kind: 'persona', pageId: 12, next: null },
      { kind: 'persona', pageId: 13, next: choice },
    ]);
  });
});

describe('[UP-016] the lazy load status', () => {
  it('[UP-016] a fast chunk never shows a label; a slow one shows «загружается…»; a failure waits for the person', async () => {
    const clock = new FakeClock(NOW_MS);
    let outcome: 'ok' | 'fail' | 'hang' = 'ok';
    let loads = 0;
    const status = new LazyLoadStatus(clock, () => {
      loads += 1;
      if (outcome === 'ok') return Promise.resolve();
      if (outcome === 'fail') return Promise.reject(new Error('chunk'));
      return new Promise<void>(() => undefined);
    });
    const seen: LazyStatus['s'][] = [];
    const off = status.onChange((s) => seen.push(s.s));
    status.start();
    status.start();
    await clock.advance(1);
    expect(seen).toEqual(['pending', 'loaded']);
    expect(status.retry()).toBe(false);
    off();

    outcome = 'hang';
    const slow = new LazyLoadStatus(clock, () => {
      loads += 1;
      return outcome === 'hang' ? new Promise<void>(() => undefined) : outcome === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve();
    });
    slow.start();
    await clock.advance(LAZY_TIMING.showLabelAfterMs);
    expect(slow.current).toEqual({ s: 'loading' });
    await clock.advance(LAZY_TIMING.giveUpAfterMs);
    expect(slow.current).toEqual({ s: 'failed', code: 'CG-UI-FAILED', attempts: 1 });
    await clock.advance(60_000);
    expect(loads).toBe(2);
    outcome = 'fail';
    expect(slow.retry()).toBe(true);
    await clock.advance(1);
    expect(slow.current).toEqual({ s: 'failed', code: 'CG-UI-FAILED', attempts: 2 });
    outcome = 'ok';
    expect(slow.retry()).toBe(true);
    await clock.advance(1);
    expect(slow.current).toEqual({ s: 'loaded' });
    expect(loads).toBe(4);
  });
});
