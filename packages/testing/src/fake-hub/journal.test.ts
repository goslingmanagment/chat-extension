// The fake hub's request journal: every call classified (our route, a
// forbidden operation or family, an unknown path, another origin), with who
// answered; the readings tests assert with; and no text a person or a model
// wrote — passwords, drafts, questions, fresh text, model output — ever in it.

import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE, WORLD, streamBody, uuid } from '../scenarios/hub';
import { createFakeHub, type FakeHub } from './hub';
import { callsTo, describeCalls, forbiddenCalls, invalidCalls, journalViolations, redact, unscriptedCalls, FakeHubJournal } from './journal';
import { hubCall, readSse } from './kit';

let hub: FakeHub;
let token: string;

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
});

describe('fake hub journal: redaction', () => {
  it('replaces every text field by its length, deep in arrays and objects; ids and numbers stay', () => {
    expect(
      redact({
        password: 'secret',
        body: { draftText: 'my draft', chatterQuestion: 'why?', coachHistory: [{ question: 'q1', answer: 'a long answer' }], liveTextContext: { items: [{ platformMessageId: '6600', text: 'hey' }] } },
        pageLabel: PAGE,
        messageCount: 3000,
      }),
    ).toEqual({
      password: '‹6 chars›',
      body: { draftText: '‹8 chars›', chatterQuestion: '‹4 chars›', coachHistory: [{ question: '‹2 chars›', answer: '‹13 chars›' }], liveTextContext: { items: [{ platformMessageId: '6600', text: '‹3 chars›' }] } },
      pageLabel: PAGE,
      messageCount: 3000,
    });
    expect(redact(null)).toBeNull();
    expect(redact(['a', 1, true])).toEqual(['‹1 chars›', 1, true]);
    expect(redact({ capabilities: ['context-v1'], knownFanMessageIds: ['6600', '6601'] })).toEqual({ capabilities: ['context-v1'], knownFanMessageIds: ['6600', '6601'] });
    // R20 P8b1: a Fansly start's window check — ids and sides — reads as it was sent.
    const coverageCheck = { window: [{ id: '6600', dir: 'fan' }], deletedIds: ['6601'] };
    expect(redact({ coverageCheck })).toEqual({ coverageCheck });
  });

  it('redacts by default: unknown keys, text under a kept key, and text used as a key are all lengths', () => {
    expect(
      redact({
        systemPrompt: 'SECRET-PROMPT-TEXT',
        notes: 'FAN SAID HELLO',
        messages: [{ body: 'SECRET2' }],
        payload: { note: 'SECRET3', feature: 'fast-reply', lifecycle: 'shown' },
        fanRef: 'a whole sentence where an id belongs',
        reason: 'x'.repeat(201),
        'FAN TEXT AS A KEY': 1,
      }),
    ).toEqual({
      systemPrompt: '‹18 chars›',
      notes: '‹14 chars›',
      messages: [{ body: '‹7 chars›' }],
      payload: { note: '‹7 chars›', feature: 'fast-reply', lifecycle: 'shown' },
      fanRef: '‹36 chars›',
      reason: '‹201 chars›',
      '‹key 6: 17 chars›': 1,
    });
  });

  it('a request the schema refused and an ingest payload never bring text into the journal', async () => {
    const secrets = ['SECRET-PROMPT-TEXT', 'FAN SAID HELLO', 'SECRET2', 'SECRET3', 'FINAL MESSAGE TO FAN', 'SEARCHED-FAN-NAME'];
    const ai = { feature: 'fast-reply', body: { ...streamBody({ clientRequestId: uuid(0x610) }), systemPrompt: secrets[0], notes: secrets[1], messages: [{ body: secrets[2] }] }, capabilities: [] };
    expect((await hubCall(hub.fetch, hub.origin, 'aiFeatureStream', ai, { token })).status).toBe(400);
    const event = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ clientEventId: uuid(0x611), kind: 'ai_acceptance', observedAt: '2026-10-03T09:59:00.000Z', pageLabel: PAGE, payload, ...extra });
    expect((await hubCall(hub.fetch, hub.origin, 'ingestObservations', { events: [event({ feature: 'fast-reply' }, { note: secrets[3] })] }, { token })).status).toBe(400);
    expect((await hubCall(hub.fetch, hub.origin, 'ingestObservations', { events: [event({ feature: 'fast-reply', message: secrets[4] })] }, { token })).status).toBe(200);
    await hubCall(hub.fetch, hub.origin, 'spenders', { pageLabel: PAGE, scope: 'page', period: 'lifetime', limit: 50, offset: 0, query: secrets[5] }, { token });
    const entries = hub.read().entries;
    const dump = JSON.stringify(entries);
    for (const secret of secrets) expect(dump).not.toContain(secret);
    expect(entries.map((entry) => entry.status)).toEqual([400, 400, 200, 200]);
    expect(entries[2]?.request).toEqual({ events: [{ clientEventId: uuid(0x611), kind: 'ai_acceptance', observedAt: '2026-10-03T09:59:00.000Z', pageLabel: PAGE, payload: { feature: 'fast-reply', message: '‹20 chars›' } }] });
  });

  it('no draft, question, fresh text, password or model output reaches the journal of a real exchange', async () => {
    const secrets = ['DRAFT-TEXT-1', 'QUESTION-TEXT-2', 'FRESH-TEXT-3', 'HISTORY-ANSWER-4'];
    await hubCall(hub.fetch, hub.origin, 'authIssueDeviceTokenWithPassword', { username: WORLD.user.username, password: 'synthetic-password', label: 'x', mode: 'active' });
    const fix = await hubCall(
      hub.fetch,
      hub.origin,
      'aiFeatureStream',
      {
        feature: 'improve-draft',
        body: streamBody({ clientRequestId: uuid(0x600), draftText: secrets[0], liveTextContext: { capturedAt: '2026-10-03T09:59:00.000Z', items: [{ platformMessageId: '6600', direction: 'fan', occurredAt: '2026-10-03T09:58:00.000Z', text: secrets[2] ?? '' }] } }),
        capabilities: ['context-v1'],
      },
      { token },
    );
    const output = (await readSse(fix)).frames.flatMap((frame) => ((frame as { type: string }).type === 'content_delta' ? [(frame as { text: string }).text] : []));
    expect(output.length).toBeGreaterThan(0);
    await readSse(
      await hubCall(hub.fetch, hub.origin, 'aiFeatureStream', { feature: 'coach-chat', body: streamBody({ clientRequestId: uuid(0x601), chatterQuestion: secrets[1], coachHistory: [{ question: 'q', answer: secrets[3] ?? '' }] }), capabilities: [] }, { token }),
    );
    const dump = JSON.stringify(hub.read().entries);
    for (const secret of [...secrets, 'synthetic-password', ...output.filter((text) => text.trim().length > 3)]) expect(dump).not.toContain(secret);
    expect(hub.read().entries.at(-1)?.stream?.frames).toContain('content_delta');
  });
});

describe('fake hub journal: classification and readings', () => {
  it('our routes, forbidden operations and families, unknown paths and other origins', async () => {
    await hubCall(hub.fetch, hub.origin, 'me', null, { token, clientVersion: 'chat-extension/0.1.0' });
    await hub.fetch(`${hub.origin}/api/v1/ai/gateway/stream`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    await hub.fetch(`${hub.origin}/api/v1/events/v2/stream?cursor=1`, { headers: { authorization: `Bearer ${token}` } });
    await hub.fetch(`${hub.origin}/api/v1/pages/${PAGE}/conversations/${WORLD.fan}/messages`);
    await hub.fetch(`${hub.origin}/api/v1/nothing-here`);
    await expect(hub.fetch('https://elsewhere.invalid/api/v1/health')).rejects.toThrow(/fake hub serves/);
    const entries = hub.read().entries;
    expect(entries.map((entry) => [entry.kind, entry.route ?? entry.operation, entry.status])).toEqual([
      ['route', 'me', 200],
      ['forbidden', 'aiGatewayStream', 403],
      ['forbidden', 'eventsV2Stream', 403],
      ['forbidden', 'conversation-messages', 401],
      ['unknown', null, 404],
      ['foreign-origin', null, 0],
    ]);
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/api/v1/auth/me', clientVersion: 'chat-extension/0.1.0', token: { id: 1, client: 'chat-extension' }, servedBy: 'model', at: hub.clock.now() });
    // The journal keeps paths only: queries go to `request`, redacted.
    expect(entries[2]?.path).toBe('/api/v1/events/v2/stream');
    expect(forbiddenCalls(entries)).toHaveLength(5);
    expect(journalViolations(entries)).toHaveLength(5);
    expect(callsTo(entries, 'me')).toHaveLength(1);
    expect(describeCalls(entries.slice(1, 2))).toBe('#2 POST /api/v1/ai/gateway/stream → 403 forbidden [forbidden:aiGatewayStream, check]');
  });

  it('invalid and unscripted calls are violations; a clean run has none', async () => {
    const mark = hub.journal.mark();
    await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' }, { token });
    expect(hub.violations(mark)).toEqual([]);
    await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { pageLabel: PAGE, windowDays: 31, timeZone: 'UTC' }, { token });
    hub.control({ op: 'useHttpScenario', scenario: 'feed-pages' });
    await hubCall(hub.fetch, hub.origin, 'me', null, { token });
    const entries = hub.read(mark).entries;
    expect(invalidCalls(entries).map((entry) => entry.issues.join(' '))).toEqual([expect.stringContaining('windowDays')]);
    expect(unscriptedCalls(entries).map((entry) => entry.route)).toEqual(['me']);
    expect(describeCalls(invalidCalls(entries))).toMatch(/→ 400 bad_request \[route, check\] issues: windowDays/);
    expect(hub.violations(mark)).toHaveLength(2);
  });

  it('read(since) pages the journal; stream updates of unknown entries are ignored', () => {
    const journal = new FakeHubJournal();
    const base = { at: 0, method: 'GET', path: '/x', kind: 'route' as const, route: null, operation: null, status: 200, error: null, reason: null, servedBy: 'model' as const, token: null, clientVersion: null, request: null, issues: [] };
    const first = journal.record({ ...base, streaming: true });
    journal.record(base);
    journal.streamFrame(first, 'meta');
    journal.streamEnd(first, 'done');
    journal.streamEnd(first, 'reset');
    journal.streamFrame(99, 'meta');
    journal.streamEnd(99, 'done');
    expect(journal.read().entries.map((entry) => entry.stream)).toEqual([{ frames: ['meta'], outcome: 'done' }, null]);
    expect(journal.read(1)).toMatchObject({ entries: [{ seq: 2 }], next: 2 });
    expect(journal.mark()).toBe(2);
    // Copies: a reader cannot change the journal.
    (journal.read().entries[0]?.stream?.frames as string[] | undefined)?.push('x');
    expect(journal.read().entries[0]?.stream?.frames).toEqual(['meta']);
  });

  it('keeps the newest 20 000 entries', () => {
    const journal = new FakeHubJournal();
    const base = { at: 0, method: 'GET', path: '/x', kind: 'route' as const, route: null, operation: null, status: 200, error: null, reason: null, servedBy: 'model' as const, token: null, clientVersion: null, request: null, issues: [] };
    for (let i = 0; i < 20_005; i += 1) journal.record(base);
    const { entries, next } = journal.read();
    expect({ count: entries.length, first: entries[0]?.seq, next }).toEqual({ count: 20_000, first: 6, next: 20_005 });
  });
});
