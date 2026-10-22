// Who may ask what across the extension's contexts, and what crosses them: writes and secrets on the right side, the
// site rules of a request (X8 and «Новые» are ChatSpace's, Fansly's requests Fansly's), the bridge from the page's
// MAIN world (writes, text, tokens, unknown types, prototype keys, extra fields).

import { describe, expect, it } from 'vitest';

import * as F from '../src/errors-fansly';
import * as C from '../src/index';
import * as T from '../src/tab-messages-fansly';
import * as FX from './fixtures/index';
import { IDS, uuid } from './fixtures/index';

describe('tab/pages ↔ background protocol (§5.4)', () => {
  it('keeps writes and secrets on the right side', () => {
    expect(C.mayRequest('session.signIn', 'tab', null)).toBe(false);
    expect(C.mayRequest('session.signIn', 'page', 'options')).toBe(true);
    expect(C.mayRequest('session.signIn', 'page', 'debug-journal')).toBe(false);
    expect(C.mayRequest('send.begin', 'page', 'options')).toBe(false);
    expect(C.mayRequest('op.start', 'tab', null)).toBe(true);
    expect(C.mayRequest('debug.prompt', 'page', 'debug-prompt')).toBe(true);
    expect(C.mayRequest('debug.prompt', 'page', 'popup')).toBe(false);
    expect(C.mayRequest('settings.get', 'tab', null)).toBe(true);
    expect(C.mayRequest('site.access', 'tab', null)).toBe(false);
    expect(C.mayRequest('site.access', 'page', 'popup')).toBe(true);
    expect(C.mayRequest('site.access', 'page', 'options')).toBe(true);
    expect(C.mayRequest('site.access', 'page', 'debug-journal')).toBe(false);
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

  it('[EX-015] X8 and the hub’s «Новые» are ChatSpace’s: a fansly.com tab is refused them, a page is not affected', () => {
    const hosted = C.TAB_REQUEST_TYPES.filter((type) => (C.TAB_REQUESTS[type] as C.TabRequestSpec).hosts !== undefined);
    expect(hosted.sort()).toEqual(['newcomers.claim', 'newcomers.list', 'send.begin', 'send.fuse', 'send.fuseState', 'send.list', 'send.report', 'send.status']);
    for (const type of hosted) {
      expect((C.TAB_REQUESTS[type] as C.TabRequestSpec).hosts, type).toEqual(['chatspace']);
      expect(C.mayRequest(type, 'tab', null, 'chatspace'), type).toBe(true);
      expect(C.mayRequest(type, 'tab', null, 'fansly-web'), type).toBe(false);
      expect(C.mayRequest(type, 'tab', null), `${type}: a tab whose site is not named`).toBe(false);
    }
    expect(C.mayRequest('send.status', 'page', 'options', null)).toBe(true);
    expect(C.mayRequest('newcomers.list', 'page', 'popup', null)).toBe(true);
    // Everything else stays every site's.
    expect(C.mayRequest('op.start', 'tab', null, 'fansly-web')).toBe(true);
    expect(C.mayRequest('op.reportSent', 'tab', null, 'fansly-web')).toBe(true);
  });

  it('[host:fansly] every Fansly request is the site’s own: a fansly.com tab or its relay sends it, never ChatSpace; a page only the settings page’s four (P14b1)', () => {
    const pageTypes = ['fansly.settings.read', 'fansly.settings.write', 'fansly.accounts.read', 'fansly.accounts.focus'];
    for (const type of T.FANSLY_TAB_REQUEST_TYPES) {
      const spec: C.TabRequestSpec = T.FANSLY_TAB_REQUESTS[type];
      expect(spec.hosts, type).toEqual(['fansly-web']);
      if (pageTypes.includes(type)) {
        expect(spec.from, type).toEqual(['page']);
        expect(T.mayRequestFansly(type, 'page', 'options', null), type).toBe(true);
        expect(T.mayRequestFansly(type, 'page', 'popup', null), type).toBe(false);
        expect(T.mayRequestFansly(type, 'tab', null, 'fansly-web'), type).toBe(false);
        expect(T.mayRequestFansly(type, 'relay', null, 'fansly-web'), type).toBe(false);
        continue;
      }
      const relay = type.startsWith('fansly.relay.');
      expect(spec.from, type).toEqual(relay ? ['relay'] : ['tab']);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, 'fansly-web'), type).toBe(true);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, 'chatspace'), type).toBe(false);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, null), type).toBe(false);
      expect(T.mayRequestFansly(type, relay ? 'tab' : 'relay', null, 'fansly-web'), type).toBe(false);
      expect(T.mayRequestFansly(type, 'page', 'options', null), type).toBe(false);
    }
    for (const type of C.TAB_REQUEST_TYPES) expect(C.mayRequest(type, 'relay', null, 'fansly-web'), type).toBe(false);
  });

  it('[host:fansly] the relay fetches Fansly’s API only (FS-NET-1, FS-NET-4)', () => {
    const fetch = T.FANSLY_TAB_EVENTS['fansly.relay.fetch'].payload;
    const base = { requestId: '00000000-0000-4000-8000-000000000001', method: 'GET', headers: [], expect: { hostAccountId: '700000000000000001' } };
    expect(fetch.safeParse({ ...base, url: `${T.FANSLY_RELAY_TARGET}group/1` }).success).toBe(true);
    for (const url of ['https://apiv3.fansly.com/api/v2/x', 'https://apiv3.fansly.com.evil.test/api/v1/x', 'http://apiv3.fansly.com/api/v1/x', 'https://chat.onlymonster.ai/api/v1/x']) {
      expect(fetch.safeParse({ ...base, url }).success, url).toBe(false);
    }
  });

  it('[host:fansly] the Fansly CG codes keep the retry rule: nothing indeterminate is offered again', () => {
    for (const entry of Object.values(F.CG_FANSLY_REGISTRY)) {
      expect(entry.retry === 'after-deadline', entry.code).toBe(entry.recovery === 'wait-until');
      if (entry.retry === 'never') expect(['retry', 'new-generation'], entry.code).not.toContain(entry.recovery);
    }
    // An unknown write is read again, never written again (FS-NOTE-4, FS-VLT-1).
    expect(F.cgFanslyEntry('CG-NOTE-UNCERTAIN').retry).toBe('safe-read');
    expect(F.cgFanslyEntry('CG-VAULT-UNCERTAIN').recovery).toBe('none');
  });

  it('voice notes are every site’s (1.46.0): a tab of either site asks, a page never; the paid step and the attach keep their rules', () => {
    for (const type of ['voice.read', 'voice.script', 'voice.edit', 'voice.take', 'voice.check', 'voice.audio', 'voice.attached', 'voice.discard'] as const) {
      expect(C.mayRequest(type, 'tab', null, 'chatspace'), type).toBe(true);
      expect(C.mayRequest(type, 'tab', null, 'fansly-web'), type).toBe(true);
      expect(C.mayRequest(type, 'page', 'options'), type).toBe(false);
    }
    expect(C.TAB_EVENTS['voice.changed'].to).toEqual(['tab']);
    // An outcome nobody saw is never offered again by itself.
    expect(C.cgEntry('CG-VOICE-UNCERTAIN').retry).toBe('never');
    expect(C.cgEntry('CG-VOICE-ATTACH-UNKNOWN').recovery).toBe('none');
    // The studio's actions repeat the module's presets and bound (the dock's first chunk loads no voice schema).
    expect([...C.VOICE_ACTION_TONES]).toEqual([...C.VOICE_TONES]);
    expect(C.VOICE_ACTION_SCRIPT_MAX_CHARS).toBe(C.VOICE_LIMITS.scriptMaxChars);
    // The hub's codes read as the voice codes, each with the status the hub answers it with.
    for (const [hubCode, spec] of Object.entries(C.HUB_VOICE_ERROR_CODES)) expect(C.isCgCode(spec.cg), hubCode).toBe(true);
  });

  it('a voice session, a take and the script’s kept view hold their shape', () => {
    for (const valid of FX.VOICE_SESSION_FIXTURES.valid) expect(C.VoiceSessionSchema.safeParse(valid).success).toBe(true);
    for (const invalid of FX.VOICE_SESSION_FIXTURES.invalid) expect(C.VoiceSessionSchema.safeParse(invalid).success).toBe(false);
    for (const valid of FX.VOICE_OP_VIEW_FIXTURES.valid) expect(C.VoiceOpViewSchema.safeParse(valid).success).toBe(true);
    for (const invalid of FX.VOICE_OP_VIEW_FIXTURES.invalid) expect(C.VoiceOpViewSchema.safeParse(invalid).success).toBe(false);
    for (const valid of FX.VOICE_SCRIPT_START_FIXTURES.valid) expect(C.VoiceScriptStartSchema.safeParse(valid).success).toBe(true);
    for (const invalid of FX.VOICE_SCRIPT_START_FIXTURES.invalid) expect(C.VoiceScriptStartSchema.safeParse(invalid).success).toBe(false);
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

  it('MAIN gets no hub ticket, binding or action token', () => {
    const keys = Object.keys(C.MainSendRequestSchema.shape);
    for (const key of ['ticket', 'binding', 'target', 'cause', 'actionToken', 'pageId', 'pageLabel']) expect(keys).not.toContain(key);
    expect(Object.keys(C.NavigationWireSchema.shape)).not.toContain('cause');
  });

  it('unknown request types are rejected, prototype names among them', () => {
    for (const t of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t, documentEpoch: null, seq: 0, payload: {} }).success, t).toBe(false);
    }
  });

  it('prototype keys are rejected at any depth', () => {
    for (const key of C.PROTOTYPE_KEYS) {
      const inner = `{${JSON.stringify(key)}:{"x":1}}`;
      for (const json of [inner, `{"a":${inner}}`, `[${inner}]`, `{"a":[{"b":[${inner}]}]}`]) {
        expect(C.checkBridgeFrame(JSON.parse(json) as unknown), `${key} in ${json}`).toEqual({ ok: false, reason: 'prototype-key' });
      }
    }
  });

  it('extra fields and unsafe ids are rejected', () => {
    const base = { v: 1, kind: 'evt', t: 'chatCache', documentEpoch: 'doc1', seq: 0 } as const;
    expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: IDS.fan, history: true } }).success).toBe(true);
    expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: IDS.fan, history: true, extra: 1 } }).success).toBe(false);
    expect(C.BridgeEventSchema.safeParse({ ...base, extra: 1, payload: { acc: IDS.acc, fan: IDS.fan, history: true } }).success).toBe(false);
    for (const unsafe of ['0', '-1', '1e9', '9007199254740993.0', 'abc', '1'.repeat(31), ' 2002']) {
      expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: unsafe, history: true } }).success, unsafe).toBe(false);
    }
    expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t: 'previewSendCommit', documentEpoch: 'doc1', seq: 0, payload: { req: { attemptId: uuid(5) } } }).success).toBe(false);
  });
});
