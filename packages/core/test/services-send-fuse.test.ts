// The X8 fuse of the browser (decision X25; core/services/send-fuse.ts): what
// trips it, what it holds, how it is kept and lifted. It never sends.

import { SEND_FUSE_UNCERTAIN_RUN, SendFuseStateSchema } from '@cg/contracts';
import { SEND_FUSE_KEY, SendFuseKeeper } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { EventLog, FakeClock, LogRecorder, MemoryStore } from './support/clock';
import { NOW_MS, uuid } from './support/world';

const BUILD = 'index-p8xPkCj8';
const NEXT = 'index-Q9yRlDk9';

function world(shared?: { readonly store: MemoryStore; readonly clock: FakeClock }) {
  const clock = shared?.clock ?? new FakeClock(NOW_MS);
  const store = shared?.store ?? new MemoryStore();
  const events = new EventLog();
  const log = new LogRecorder();
  const trips: unknown[] = [];
  const keeper = new SendFuseKeeper({ clock, store, events, log, onTrip: (fuse) => trips.push(fuse) });
  return { clock, store, events, log, trips, keeper };
}
const text = { reason: 'text', where: 'echo', attemptId: uuid(0x70), build: BUILD } as const;

describe('[X8-06] the fuse trips on what a tab saw, and holds the build it was seen on', () => {
  it('a trip: kept with its time, reason, place, build and attempt; every tab hears it; the log has its code and no text; client_health counts it', async () => {
    const w = world();
    await w.keeper.load();
    expect(w.keeper.current()).toEqual({ fuse: null, resetAt: null });
    expect(w.keeper.holds(BUILD)).toBe(false);
    const state = await w.keeper.trip(text);
    expect(state).toEqual({ fuse: { trippedAt: NOW_MS, reason: 'text', where: 'echo', build: BUILD, attemptId: uuid(0x70) }, resetAt: null });
    expect(SendFuseStateSchema.safeParse(state).success).toBe(true);
    expect(w.events.of('send.fuse')).toEqual([{ to: null, payload: state }]);
    expect(w.trips).toEqual([state.fuse]);
    // The tab's own record of the trip carried the code (one count of the day); this one says what the background keeps.
    expect(w.log.entries).toEqual([{ level: 'warn', scope: 'bg.send', msg: 'send fuse tripped: preview send off', fields: { reason: 'text', where: 'echo', build: BUILD }, ctx: { attemptId: uuid(0x70) } }]);
    // Kept in storage.local, machine values only.
    expect(w.store.data.get(SEND_FUSE_KEY)).toEqual({ v: 1, state, uncertainRun: 0 });
    // The build it tripped on is held; another build is not; a tab whose build is not known is.
    expect(w.keeper.holds(BUILD)).toBe(true);
    expect(w.keeper.holds(NEXT)).toBe(false);
    expect(w.keeper.holds(null)).toBe(true);
    expect(w.keeper.holds(undefined)).toBe(true);
  });

  it('the first trip on a build stands: another on the same build changes nothing and is not told again', async () => {
    const w = world();
    const first = await w.keeper.trip(text);
    await w.clock.advance(5_000);
    const again = await w.keeper.trip({ ...text, reason: 'count', where: 'request', attemptId: uuid(0x71) });
    expect(again).toEqual(first);
    expect(w.events.of('send.fuse')).toHaveLength(1);
    expect(w.trips).toHaveLength(1);
    expect(w.log.entries.at(-1)).toMatchObject({ level: 'info', msg: 'send fuse already tripped' });
  });

  it('a trip on another build while the fuse holds one (two builds in a row): it holds every build until the reset', async () => {
    const w = world();
    await w.keeper.trip(text);
    await w.clock.advance(60_000);
    const state = await w.keeper.trip({ ...text, reason: 'target', where: 'request', build: NEXT, attemptId: uuid(0x72) });
    expect(state.fuse).toEqual({ trippedAt: NOW_MS + 60_000, reason: 'target', where: 'request', build: null, attemptId: uuid(0x72) });
    for (const build of [BUILD, NEXT, 'index-Another1', null]) expect([build, w.keeper.holds(build)]).toEqual([build, true]);
  });

  it('«Сбросить предохранитель»: X8 is on again on the same build, the reset time is kept, every tab hears it; the next trip trips it again', async () => {
    const w = world();
    await w.keeper.trip(text);
    await w.clock.advance(120_000);
    const reset = await w.keeper.reset();
    expect(reset).toEqual({ fuse: null, resetAt: NOW_MS + 120_000 });
    expect(w.keeper.holds(BUILD)).toBe(false);
    expect(w.events.of('send.fuse').map((event) => [event.payload.fuse?.reason ?? null, event.payload.resetAt])).toEqual([
      ['text', null],
      [null, NOW_MS + 120_000],
    ]);
    expect(w.log.entries.at(-1)).toMatchObject({ level: 'info', msg: 'send fuse reset by the person', fields: { had: 'text' } });
    const again = await w.keeper.trip({ ...text, attemptId: uuid(0x73) });
    expect(again).toEqual({ fuse: { trippedAt: NOW_MS + 120_000, reason: 'text', where: 'echo', build: BUILD, attemptId: uuid(0x73) }, resetAt: NOW_MS + 120_000 });
  });

  it('survives the event page: the next instance reads it back; a value that does not read is no fuse', async () => {
    const shared = { store: new MemoryStore(), clock: new FakeClock(NOW_MS) };
    await world(shared).keeper.trip(text);
    const next = world(shared);
    await next.keeper.load();
    expect(next.keeper.holds(BUILD)).toBe(true);
    expect(next.keeper.current().fuse?.attemptId).toBe(uuid(0x70));

    shared.store.data.set(SEND_FUSE_KEY, { v: 1, state: { fuse: { reason: 'text' } }, uncertainRun: 0 });
    const broken = world(shared);
    await broken.keeper.load();
    expect(broken.keeper.current()).toEqual({ fuse: null, resetAt: null });
    expect(broken.log.entries).toEqual([{ level: 'warn', scope: 'bg.send', msg: 'send fuse unreadable, dropped', code: 'CG-STORAGE-VERSION' }]);
  });

  it('a write that fails keeps the fuse for this event page and says so', async () => {
    const w = world();
    w.store.failWrites = true;
    await w.keeper.trip(text);
    expect(w.keeper.holds(BUILD)).toBe(true);
    expect(w.log.entries.at(-1)).toMatchObject({ level: 'error', code: 'CG-STORAGE-WRITE' });
  });
});

describe(`[X8-06] (d) ${SEND_FUSE_UNCERTAIN_RUN} sends in a row with an unknown outcome trip it`, () => {
  it('a run of `uncertain` trips it with reason `uncertain`, on the build of the last of them; a known outcome starts the run over', async () => {
    const w = world();
    await w.keeper.load();
    const uncertain = (build: string | null | undefined = BUILD): void => w.keeper.outcome({ state: 'uncertain', restored: false, build });
    uncertain();
    uncertain();
    w.keeper.outcome({ state: 'sentObserved', restored: false, build: BUILD });
    uncertain();
    uncertain();
    await w.keeper.idle();
    expect(w.keeper.current().fuse).toBeNull();
    // Moves that are no outcome change nothing.
    for (const state of ['preparing', 'nativeEnqueued', 'nativeAccepted', 'held', 'notEnqueued'] as const) w.keeper.outcome({ state, restored: false, build: BUILD });
    uncertain(NEXT);
    await w.keeper.idle();
    expect(w.keeper.current().fuse).toEqual({ trippedAt: NOW_MS, reason: 'uncertain', where: 'outcomes', build: NEXT, attemptId: null });
    expect(w.trips).toHaveLength(1);
    // Only the background sees a run of outcomes: its record carries the code (the day's count).
    expect(w.log.entries.filter((entry) => entry.code === 'CG-SEND-FUSE')).toEqual([
      { level: 'warn', scope: 'bg.send', msg: 'send fuse tripped: preview send off', code: 'CG-SEND-FUSE', fields: { reason: 'uncertain', where: 'outcomes', build: NEXT } },
    ]);
  });

  it('an attempt restored after a restart is not counted: the browser went away, not ChatSpace; a refusal is a known outcome too', async () => {
    const w = world();
    for (let n = 0; n < SEND_FUSE_UNCERTAIN_RUN + 2; n += 1) w.keeper.outcome({ state: 'uncertain', restored: true, build: BUILD });
    w.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    w.keeper.outcome({ state: 'rejected', restored: false, build: BUILD });
    w.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    w.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    await w.keeper.idle();
    expect(w.keeper.current().fuse).toBeNull();
  });

  it('the run is kept across event pages and starts over with a reset', async () => {
    const shared = { store: new MemoryStore(), clock: new FakeClock(NOW_MS) };
    const first = world(shared);
    await first.keeper.load();
    first.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    first.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    await first.keeper.idle();
    const second = world(shared);
    await second.keeper.load();
    await second.keeper.reset();
    second.keeper.outcome({ state: 'uncertain', restored: false, build: BUILD });
    await second.keeper.idle();
    expect(second.keeper.current().fuse).toBeNull();
    const third = world(shared);
    await third.keeper.load();
    third.keeper.outcome({ state: 'uncertain', restored: false, build: undefined });
    third.keeper.outcome({ state: 'uncertain', restored: false, build: undefined });
    await third.keeper.idle();
    // Not known on which build: it holds every build.
    expect(third.keeper.current().fuse).toMatchObject({ reason: 'uncertain', build: null });
  });
});
