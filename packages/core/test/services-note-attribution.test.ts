// Who wrote each Fansly note (hub `clientNoteAttributions`): every write Fansly
// confirmed is reported under the person signed in — ids, the action, where in
// the panel, the questionnaire labels; never a text. What the hub has not
// answered is owed and journaled; every answer is final.

import { NoteAttributionsRequestSchema, type NoteAttributionsRequest, type NoteAttributionsResult } from '@cg/contracts';
import { NOTE_ATTRIBUTIONS_KEY, NOTE_ATTRIBUTION_BATCH_MS, NOTE_ATTRIBUTION_KEEP_MS, NoteAttributionReporter, noteWriteOrigin, type NoteAttributionInput } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, MemoryStore, settle } from './support/clock';
import { NOW_MS, WORLD } from './support/world';

const OWNER = `${WORLD.hubOrigin}|${WORLD.user.userId}`;
const OTHER = `${WORLD.hubOrigin}|9999`;
const PAGE = WORLD.pages.one.pageLabel;

let next = 0;
const write = (over: Partial<NoteAttributionInput> = {}): NoteAttributionInput => ({
  pageLabel: PAGE,
  source: 'fansly-extension',
  eventId: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  fanRef: '74001001',
  noteRef: '901',
  noteKind: 'note',
  action: 'created',
  observedAt: new Date(NOW_MS).toISOString(),
  ...over,
});

/** A hub that answers as told: `recorded` for each fact by default, or throws what the test gives. */
class ScriptedHub {
  readonly calls: NoteAttributionsRequest[] = [];
  readonly answers: (((request: NoteAttributionsRequest) => NoteAttributionsResult) | Error)[] = [];

  noteAttributions(request: NoteAttributionsRequest): Promise<NoteAttributionsResult> {
    this.calls.push(request);
    const answer = this.answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer?.(request) ?? { pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ eventId: fact.eventId, outcome: 'recorded' })), serverNow: new Date(NOW_MS).toISOString() });
  }
}

const hubError = (failure: unknown): Error => Object.assign(new Error('hub'), { name: 'HubCallError', failure });

function world(owner: { now: string | null } = { now: OWNER }, shared?: { readonly store: MemoryStore; readonly hub: ScriptedHub; readonly clock: FakeClock }) {
  const clock = shared?.clock ?? new FakeClock(NOW_MS);
  const hub = shared?.hub ?? new ScriptedHub();
  const store = shared?.store ?? new MemoryStore();
  const log = new LogRecorder();
  const reporter = new NoteAttributionReporter({ clock, hub, owner: () => owner.now, store, log });
  return { clock, hub, log, reporter, owner, store };
}
const owedIn = (store: MemoryStore): { eventId: string; owner: string }[] => (store.data.get(NOTE_ATTRIBUTIONS_KEY) as { owed?: { eventId: string; owner: string }[] } | undefined)?.owed ?? [];
const eventsOf = (hub: ScriptedHub): string[] => hub.calls.flatMap((call) => call.facts.map((fact) => fact.eventId));

describe('the report', () => {
  it('a burst of writes is one request after a short quiet: ids, the action, the origin and labels — never a text or the person', async () => {
    const { clock, hub, reporter } = world();
    const quick = write({ origin: 'quick' });
    const fill = write({ noteRef: '801', action: 'edited', origin: 'fill', fields: ['Имя', 'Работа'] });
    expect(reporter.report(quick)).toBe('queued');
    expect(reporter.report(fill)).toBe('queued');
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS - 1);
    expect(hub.calls).toEqual([]);
    await clock.advance(1);
    await reporter.idle();
    expect(hub.calls).toEqual([
      {
        pageLabel: PAGE,
        source: 'fansly-extension',
        facts: [
          { eventId: quick.eventId, fanRef: '74001001', noteRef: '901', noteKind: 'note', action: 'created', origin: 'quick', observedAt: quick.observedAt },
          { eventId: fill.eventId, fanRef: '74001001', noteRef: '801', noteKind: 'note', action: 'edited', origin: 'fill', fields: ['Имя', 'Работа'], observedAt: fill.observedAt },
        ],
      },
    ]);
    expect(NoteAttributionsRequestSchema.safeParse(hub.calls[0]).success).toBe(true);
    expect(reporter.pending).toBe(0);
  });

  it('a fact the hub would refuse is never taken; the same event is one fact; nobody signed in — nobody wrote it', async () => {
    const { clock, hub, reporter } = world();
    expect(reporter.report(write({ eventId: 'not-a-uuid' }))).toBe('invalid');
    expect(reporter.report(write({ source: 'chatspace-extension' }))).toBe('invalid');
    expect(reporter.report(write({ fields: [] }))).toBe('invalid');
    const one = write();
    expect(reporter.report(one)).toBe('queued');
    expect(reporter.report(one)).toBe('known');
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.report(one)).toBe('known');
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(eventsOf(hub)).toEqual([one.eventId]);
    const signedOut = world({ now: null });
    expect(signedOut.reporter.report(write())).toBe('signed-out');
    expect(signedOut.reporter.pending).toBe(0);
  });

  it('every answer is final — a conflict, an outcome this build does not know; a 4xx gives the facts up; a refusal of the hub layer or a 401 keeps them owed', async () => {
    const { clock, hub, log, reporter } = world();
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: [{ eventId: request.facts[0]!.eventId, outcome: 'conflict' }, { eventId: request.facts[1]!.eventId, outcome: 'superseded' }], serverNow: '' }));
    reporter.report(write());
    reporter.report(write());
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.pending).toBe(0);
    expect(log.entries.find((entry) => entry.msg === 'note attributions reported')).toMatchObject({ level: 'warn', fields: { facts: 2, conflict: 1, other: 1 } });

    hub.answers.push(hubError({ kind: 'http', status: 422 }));
    reporter.report(write());
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.pending).toBe(0);
    expect(log.entries.some((entry) => entry.msg === 'note attributions refused by the hub, given up')).toBe(true);

    hub.answers.push(new Error('no note-attribution-v1'), hubError({ kind: 'http', status: 401 }));
    const held = write();
    reporter.report(held);
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.pending).toBe(1);
    reporter.resume();
    await reporter.idle();
    expect(reporter.pending).toBe(1);
    reporter.resume();
    await reporter.idle();
    expect(reporter.pending).toBe(0);
    expect(eventsOf(hub).filter((id) => id === held.eventId)).toHaveLength(3);
  });
});

describe('what is owed', () => {
  it('is journaled before the hub is asked, ids only, and leaves the journal when the hub answers', async () => {
    const { clock, hub, reporter, store } = world();
    hub.answers.push(() => {
      // The hub is asked only once the journal holds the fact.
      expect(owedIn(store).map((owed) => owed.owner)).toEqual([OWNER]);
      return { pageLabel: PAGE, results: hub.calls[0]!.facts.map((fact) => ({ eventId: fact.eventId, outcome: 'recorded' })), serverNow: new Date(NOW_MS).toISOString() };
    });
    const one = write({ origin: 'editor' });
    reporter.report(one);
    await settle();
    expect(owedIn(store)).toEqual([expect.objectContaining({ eventId: one.eventId, owner: OWNER, origin: 'editor' })]);
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls).toHaveLength(1);
    expect(owedIn(store)).toEqual([]);
  });

  it('belongs to the person who wrote: another person’s sign-in never reports it, the writer’s next sign-in does', async () => {
    const owner = { now: OWNER as string | null };
    const { clock, hub, reporter } = world(owner);
    const mine = write();
    reporter.report(mine);
    owner.now = OTHER;
    await clock.advance(NOTE_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.resume()).toBe(0);
    expect(hub.calls).toEqual([]);
    owner.now = OWNER;
    expect(reporter.resume()).toBe(1);
    await reporter.idle();
    expect(eventsOf(hub)).toEqual([mine.eventId]);
  });

  it('the next instance of the event page delivers what the previous one owed; too old, broken or text-carrying entries go', async () => {
    const first = world();
    first.hub.answers.push(hubError({ kind: 'transport', failure: 'network' }));
    first.reporter.report(write({ origin: 'name', noteKind: 'custom_name' }));
    await settle();
    const stored = owedIn(first.store);
    expect(stored).toHaveLength(1);
    first.store.data.set(NOTE_ATTRIBUTIONS_KEY, {
      v: 1,
      owed: [
        ...stored,
        { ...stored[0], eventId: '00000000-0000-4000-8000-0000000000aa', at: NOW_MS - NOTE_ATTRIBUTION_KEEP_MS - 1 },
        { broken: true },
        { ...stored[0], eventId: '00000000-0000-4000-8000-0000000000bb', text: 'Имя: Алекс' },
        { ...stored[0], eventId: '00000000-0000-4000-8000-0000000000cc', fields: 7 },
        { ...stored[0], eventId: '00000000-0000-4000-8000-0000000000dd', action: 'renamed' },
      ],
    });
    const hub = new ScriptedHub();
    const second = world({ now: OWNER }, { store: first.store, hub, clock: first.clock });
    expect(await second.reporter.restore()).toBe(1);
    await second.reporter.idle();
    expect(eventsOf(hub)).toEqual([stored[0]!.eventId]);
    expect(hub.calls[0]?.facts[0]).toMatchObject({ noteKind: 'custom_name', origin: 'name' });
    expect(owedIn(first.store)).toEqual([]);
  });
});

describe('the tab’s word on the write', () => {
  it('keeps an origin and labels the hub takes, drops the rest — never the write', () => {
    expect(noteWriteOrigin('fill', ['Имя', 'Имя', '', 'я'.repeat(101), 'Работа'])).toEqual({ origin: 'fill', fields: ['Имя', 'Работа'] });
    expect(noteWriteOrigin('typed', 'Имя')).toEqual({});
    expect(noteWriteOrigin(undefined, Array.from({ length: 30 }, (_, i) => `П${i}`)).fields).toHaveLength(20);
  });
});
