// core/services: action tokens (§14), tab sessions (§5.1, §5.4), the
// readiness barrier (§7 «Фон и выгрузка»), the WS tap switch (§6.8 п. 10)
// and the small port helpers.

import { describe, expect, it } from 'vitest';

import { ACTION_TOKEN_PATTERN, type Bootstrap } from '@cg/contracts';
import { AbortSwitch, ACTION_TOKEN_TTL_MS, ACTION_TOKENS_PER_TAB, ActionTokens, Readiness, TabSessions, WriteQueue, WsTapSwitch, onInstalledPlan } from '@cg/core/services';
import { BOOTSTRAP_PILOT_ON } from '@cg/testing/hub';

import { FakeClock, LogRecorder, sequentialIds, settle } from './support/clock';
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

  it('[BG-002] a reloaded tab replaces its session; [UP-009] a late or foreign-contract tab must reload', () => {
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
