// core/services: action tokens (§14), what an install or an update does
// (UP-008), the WS tap switch (§6.8 п. 10) and the small port helpers. The
// readiness barrier and tab presence have their own tests next to their
// sources (services/readiness.test.ts, services/presence.test.ts).

import { describe, expect, it } from 'vitest';

import { ACTION_TOKEN_PATTERN, DEFAULT_SETTINGS, type Bootstrap, type SettingsV1 } from '@cg/contracts';
import {
  AbortSwitch,
  ACTION_TOKEN_TTL_MS,
  ACTION_TOKENS_PER_TAB,
  ActionTokens,
  LAZY_TIMING,
  LazyLoadStatus,
  NO_CHANGE,
  WriteQueue,
  WsTapSwitch,
  onInstalledPlan,
  settingsChangePlan,
  type LazyStatus,
} from '@cg/core/services';
import { BOOTSTRAP_PILOT_PAGES, pageFeaturesOff } from '@cg/testing/hub';

import { FakeClock, LogRecorder, sequentialIds, settle } from './support/clock';
import { NOW_MS, uuid } from './support/world';

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

describe('[UP-008] an install or an update', () => {
  it('[UP-008] only logs and never talks to the hub; an install offers the onboarding, an update does not', () => {
    expect(onInstalledPlan('update')).toEqual({ log: true, contactHub: false, openOnboarding: false });
    expect(onInstalledPlan('install')).toEqual({ log: true, contactHub: false, openOnboarding: true });
    expect(onInstalledPlan('browser_update')).toEqual({ log: true, contactHub: false, openOnboarding: false });
  });
});

describe('[NEW-08] the WS tap switch follows the wsTap flag', () => {
  const pilot: Bootstrap = BOOTSTRAP_PILOT_PAGES;

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
    const offing = tap.fromBootstrap(pageFeaturesOff(pilot, ['wsTap']));
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
    expect(await tap.fromBootstrap(pageFeaturesOff(pilot, ['wsTap']))).toBe(false);
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
