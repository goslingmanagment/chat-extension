import { describe, expect, it } from 'vitest';

import * as C from '../src/index';
import { BRIDGE_EVENT_FIXTURES, BRIDGE_REQUEST_FIXTURES, TAB_EVENT_FIXTURES, TAB_REQUEST_FIXTURES, type Verdicts } from './fixtures/index';

function expectVerdicts(label: string, schema: { safeParse(value: unknown): { success: boolean } }, verdicts: Verdicts): void {
  verdicts.valid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} valid[${index}]`).toBe(true));
  verdicts.invalid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} invalid[${index}]`).toBe(false));
}

describe('tab/pages ↔ background protocol (§5.4)', () => {
  it('has fixtures for exactly the registered request and event types', () => {
    expect(Object.keys(TAB_REQUEST_FIXTURES).sort()).toEqual([...C.TAB_REQUEST_TYPES].sort());
    expect(Object.keys(TAB_EVENT_FIXTURES).sort()).toEqual([...C.TAB_EVENT_TYPES].sort());
  });

  for (const type of C.TAB_REQUEST_TYPES) {
    it(`${type}: payload and response schemas`, () => {
      const spec = C.TAB_REQUESTS[type];
      const fixtures = TAB_REQUEST_FIXTURES[type];
      expect(fixtures.req.valid.length).toBeGreaterThan(0);
      expect(fixtures.req.invalid.length).toBeGreaterThan(0);
      expect(fixtures.res.valid.length).toBeGreaterThan(0);
      expect(fixtures.res.invalid.length, `${type} needs an invalid response fixture`).toBeGreaterThan(0);
      expectVerdicts(`${type} req`, spec.req, fixtures.req);
      expectVerdicts(`${type} res`, spec.res, fixtures.res);
    });
  }

  for (const type of C.TAB_EVENT_TYPES) {
    it(`${type}: event payload schema`, () => {
      const fixtures = TAB_EVENT_FIXTURES[type];
      expect(fixtures.valid.length * fixtures.invalid.length).toBeGreaterThan(0);
      expectVerdicts(`${type} evt`, C.TAB_EVENTS[type].payload, fixtures);
    });
  }

  it('sender rules: every type has senders; page lists only on page-sendable types', () => {
    for (const type of C.TAB_REQUEST_TYPES) {
      const spec: { from: readonly string[]; pages?: readonly string[] } = C.TAB_REQUESTS[type];
      expect(spec.from.length, type).toBeGreaterThan(0);
      if (spec.pages !== undefined) {
        expect(spec.from, type).toContain('page');
        for (const page of spec.pages) expect(C.EXTENSION_PAGES, type).toContain(page);
      }
    }
    for (const type of C.TAB_EVENT_TYPES) expect(C.TAB_EVENTS[type].to.length, type).toBeGreaterThan(0);
  });

  it('keeps writes and secrets on the right side', () => {
    expect(C.mayRequest('session.signIn', 'tab', null)).toBe(false);
    expect(C.mayRequest('session.signIn', 'page', 'options')).toBe(true);
    expect(C.mayRequest('session.signIn', 'page', 'debug-journal')).toBe(false);
    expect(C.mayRequest('send.begin', 'page', 'options')).toBe(false);
    expect(C.mayRequest('op.start', 'tab', null)).toBe(true);
    expect(C.mayRequest('debug.prompt', 'page', 'debug-prompt')).toBe(true);
    expect(C.mayRequest('debug.prompt', 'page', 'popup')).toBe(false);
    expect(C.mayRequest('settings.get', 'tab', null)).toBe(true);
  });

  it('[ST-007] `settings.open` is a ChatSpace tab’s request: a section of the settings and a CG code, never an address', () => {
    expect(C.mayRequest('settings.open', 'tab', null)).toBe(true);
    // An extension page opens its own pages by itself.
    expect(C.mayRequest('settings.open', 'page', 'popup')).toBe(false);
    const { req, res } = C.TAB_REQUESTS['settings.open'];
    expect(req.safeParse({ route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } }).success).toBe(true);
    expect(req.safeParse({ route: { section: 'status' }, hash: '#status' }).success).toBe(false);
    expect(req.safeParse({ route: 'options.html#status' }).success).toBe(false);
    expect(res.safeParse({ opened: false }).success).toBe(true);
  });

  it('[PU-017] [ST-076] `tab.command`: only the popup and the options page ask, only a ChatSpace tab is told, and the command is the same closed set both ways', () => {
    expect(C.mayRequest('tab.command', 'page', 'popup')).toBe(true);
    expect(C.mayRequest('tab.command', 'page', 'options')).toBe(true);
    expect(C.mayRequest('tab.command', 'page', 'debug-journal')).toBe(false);
    // A tab cannot make another tab act.
    expect(C.mayRequest('tab.command', 'tab', null)).toBe(false);
    expect(C.TAB_EVENTS['tab.command'].to).toEqual(['tab']);
    for (const command of [{ kind: 'surface', surface: 'cheatsheet' }, { kind: 'account', host: 'chatspace', hostAccountId: '1001' }]) {
      expect(C.TAB_REQUESTS['tab.command'].req.safeParse({ command }).success).toBe(true);
      expect(C.parseTabPayload('evt', 'tab.command', { command })).toEqual({ ok: true, payload: { command } });
    }
    expect(C.parseTabPayload('evt', 'tab.command', { command: { kind: 'chat', host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' } })).toEqual({ ok: false });
  });

  it('[DB-006] [DB-007] `debug.open` is a ChatSpace tab’s request: the opaque token of a prompt snapshot, never an address; the prompt itself is read by the page', () => {
    expect(C.mayRequest('debug.open', 'tab', null)).toBe(true);
    // An extension page opens its own pages by itself; the prompt is read only by `debug-prompt.html`.
    expect(C.mayRequest('debug.open', 'page', 'options')).toBe(false);
    expect(C.mayRequest('debug.prompt', 'tab', null)).toBe(false);
    const { req, res } = C.TAB_REQUESTS['debug.open'];
    expect(req.safeParse({ token: 'prompt-token-1' }).success).toBe(true);
    expect(req.safeParse({ token: 'prompt-token-1', page: 'debug-prompt' }).success).toBe(false);
    expect(req.safeParse({ url: 'debug-prompt.html?t=prompt-token-1' }).success).toBe(false);
    expect(res.safeParse({ opened: false }).success).toBe(true);
    // The answer says whether the page opened and carries nothing of the snapshot.
    expect(res.safeParse({ opened: true, blocks: [] }).success).toBe(false);
  });

  it('parses in two stages and rejects unknown types', () => {
    const envelope = C.TabEnvelopeSchema.parse({ v: 1, kind: 'req', id: 4, type: 'op.cancel', tabSessionId: '00000000-0000-4000-8000-000000000004', payload: { opId: '00000000-0000-4000-8000-000000000002' } });
    expect(envelope.kind).toBe('req');
    if (envelope.kind !== 'req') return;
    expect(C.parseTabPayload('req', envelope.type, envelope.payload)).toEqual({ ok: true, payload: { opId: '00000000-0000-4000-8000-000000000002' } });
    expect(C.parseTabPayload('req', 'op.eval', {})).toEqual({ ok: false });
    expect(C.parseTabPayload('evt', 'op.cancel', {})).toEqual({ ok: false });
    expect(C.parseTabPayload('res', 'op.cancel', { state: 'stopped' })).toEqual({ ok: false });
    expect(C.parseTabPayload('evt', 'catalog.changed', {})).toEqual({ ok: true, payload: {} });
    expect(C.isTabRequestType('__proto__')).toBe(false);
    expect(C.isTabEventType('toString')).toBe(false);
  });
});

describe('MAIN ↔ isolated bridge (§5.3)', () => {
  it('has fixtures for exactly the registered request and event types', () => {
    expect(Object.keys(BRIDGE_REQUEST_FIXTURES).sort()).toEqual([...C.TO_MAIN_TYPES].sort());
    expect(Object.keys(BRIDGE_EVENT_FIXTURES).sort()).toEqual([...C.FROM_MAIN_TYPES].sort());
    expect(Object.keys(C.TO_MAIN)).toEqual([...C.TO_MAIN_TYPES]);
    expect(Object.keys(C.FROM_MAIN)).toEqual([...C.FROM_MAIN_TYPES]);
  });

  for (const t of C.TO_MAIN_TYPES) {
    it(`${t}: payload and answer schemas, and the full request envelope`, () => {
      const fixtures = BRIDGE_REQUEST_FIXTURES[t];
      for (const verdicts of [fixtures.payload, fixtures.data]) expect(verdicts.valid.length * verdicts.invalid.length).toBeGreaterThan(0);
      expectVerdicts(`${t} payload`, C.TO_MAIN[t].payload, fixtures.payload);
      expectVerdicts(`${t} data`, C.TO_MAIN[t].data, fixtures.data);
      for (const payload of fixtures.payload.valid) {
        expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t, documentEpoch: 'doc1', seq: 0, payload }).success, t).toBe(true);
      }
      for (const data of fixtures.data.valid) expect(C.parseBridgeData(t, data), t).toEqual(data);
      for (const data of fixtures.data.invalid) expect(C.parseBridgeData(t, data), t).toBeNull();
    });
  }

  for (const t of C.FROM_MAIN_TYPES) {
    it(`${t}: event payload and envelope`, () => {
      const fixtures = BRIDGE_EVENT_FIXTURES[t];
      expect(fixtures.valid.length * fixtures.invalid.length).toBeGreaterThan(0);
      expectVerdicts(`${t} evt`, C.FROM_MAIN[t], fixtures);
      for (const payload of fixtures.valid) {
        const frame = { v: 1, kind: 'evt', t, documentEpoch: 'doc1', seq: 1, payload };
        expect(C.BridgeEventSchema.safeParse(frame).success, t).toBe(true);
        expect(C.checkBridgeFrame(frame).ok, t).toBe(true);
      }
    });
  }

  it('only insert, navigation and the preview send are writes (D-07)', () => {
    expect(C.TO_MAIN_TYPES.filter((t) => C.TO_MAIN[t].write)).toEqual(['insertGuarded', 'navigate', 'previewSendCommit']);
    expect([...C.BRIDGE_WRITE_REQUESTS]).toEqual(['insertGuarded', 'navigate', 'previewSendCommit']);
    expect(C.TO_MAIN_TYPES.filter((t) => C.TO_MAIN[t].timeout === 'navInsert')).toEqual(['navigate']);
  });

  it('MAIN events carry no message text (§5.3)', () => {
    for (const t of C.FROM_MAIN_TYPES) {
      const schema: unknown = C.FROM_MAIN[t];
      const shape = (schema as { shape?: Record<string, unknown> }).shape ?? {};
      for (const key of ['text', 'plainText', 'html', 'body']) expect(Object.keys(shape), `${t}.${key}`).not.toContain(key);
    }
  });

  it('freshness and receipt events are the undroppable ones', () => {
    expect([...C.BRIDGE_UNDROPPABLE_EVENTS].sort()).toEqual(['coverage', 'humanSend', 'incoming', 'previewSendState']);
  });

  it('MAIN gets no hub ticket, binding or action token', () => {
    const keys = Object.keys(C.MainSendRequestSchema.shape);
    for (const key of ['ticket', 'binding', 'target', 'cause', 'actionToken', 'pageId', 'pageLabel']) expect(keys).not.toContain(key);
    expect(Object.keys(C.NavigationWireSchema.shape)).not.toContain('cause');
  });
});
