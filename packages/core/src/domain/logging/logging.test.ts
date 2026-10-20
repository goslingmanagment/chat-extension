import { type LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import {
  REDACTED,
  createLogger,
  createRedactor,
  isAllowedStringField,
  lengthMark,
  logEvent,
  sanitizeFields,
  sanitizeValue,
  scrubText,
  tokenSecrets,
  type ConsolePort,
} from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const TOKEN = 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N';
const OP = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';

function harness(options: { debug?: boolean; maxBytes?: number } = {}) {
  const lines: { level: string; line: string }[] = [];
  const consolePort: ConsolePort = {
    debug: (line) => lines.push({ level: 'debug', line }),
    info: (line) => lines.push({ level: 'info', line }),
    warn: (line) => lines.push({ level: 'warn', line }),
    error: (line) => lines.push({ level: 'error', line }),
  };
  const sunk: LogRecord[] = [];
  let debug = options.debug ?? false;
  let now = T0;
  const logger = createLogger({
    now: () => now,
    debugEnabled: () => debug,
    console: consolePort,
    sinks: [(record) => sunk.push(record)],
    ...(options.maxBytes === undefined ? {} : { maxRecordBytes: options.maxBytes }),
  });
  return {
    logger,
    lines,
    sunk,
    setDebug: (on: boolean) => {
      debug = on;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Everything a record could leak through: the console line, the ring, the sink, the stored JSON. */
function everywhere(h: ReturnType<typeof harness>): string {
  return [...h.lines.map((l) => l.line), ...h.logger.recent().map((r) => JSON.stringify(r)), ...h.sunk.map((r) => JSON.stringify(r))].join('\n');
}

describe('[LG-003] secrets never reach a sink', () => {
  it('[LG-003] masks the current token and its tail in console, ring and sink alike', () => {
    const h = harness({ debug: true });
    h.logger.redactor.setToken(TOKEN);
    h.logger.warn('bg.hub', `call failed with ${TOKEN}`, {
      fields: { reason: `token tail ${TOKEN.slice(-8)} seen`, nested: { status: `retry ${TOKEN}` }, list: [`x ${TOKEN}`] },
      error: new Error(`401 for ${TOKEN}`),
    });
    const all = everywhere(h);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(TOKEN.slice(-8));
    expect(all).toContain(REDACTED);
  });

  it('[LG-003] keeps the list current on sign-in and sign-out', () => {
    const redactor = createRedactor();
    redactor.setToken('first_device_token_ABCDEFGH12345');
    redactor.setToken(null);
    expect(redactor.text('old first_device_token_ABCDEFGH12345')).toBe(`old ${REDACTED}`);
    redactor.setToken('second_token_value_QWERTYUI98765');
    expect(redactor.text('second_token_value_QWERTYUI98765 / first_device_token_ABCDEFGH12345')).toBe(`${REDACTED} / ${REDACTED}`);
    expect(redactor.secretCount).toBe(4);
    expect(tokenSecrets('short')).toEqual([]);
    expect(tokenSecrets('exactly8')).toEqual(['exactly8']);
  });

  it('[LG-003] masks secret shapes, labels and URL parameters without a known value', () => {
    const cases: [string, string][] = [
      ['key sk-ant-api03-abcdefgh12345678', `key ${REDACTED}`],
      ['sk-proj-ABCDEFGHijklmnop', REDACTED],
      ['Authorization: Bearer abc.def.ghi-123', `Authorization: ${REDACTED}`],
      ['jwt eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4', `jwt ${REDACTED}`],
      ['agency_hub_pending_device_ab12cd34ef', REDACTED],
      ['password=hunter22 next', `password=${REDACTED} next`],
      ['"apiKey": "abcdef123"', `"apiKey": "${REDACTED}"`],
      ['token: zyx987', `token: ${REDACTED}`],
      ['GET https://gosling-agency.ru/x/y?fan=123&t=abc#frag done', `GET https://gosling-agency.ru/x/y?${REDACTED} done`],
      ['moz-extension://uuid/debug-prompt.html?t=opaque', `moz-extension://uuid/debug-prompt.html?${REDACTED}`],
    ];
    for (const [input, output] of cases) expect(scrubText(input)).toBe(output);
    // Ordinary words and ids stay.
    expect(scrubText('inputTokens=1200 tokens: many, session 4, CG-AUTH-EXPIRED')).toBe('inputTokens=1200 tokens: many, session 4, CG-AUTH-EXPIRED');
  });

  it('[LG-003] drops forbidden fields at any depth, but not tabSessionId or inputTokens', () => {
    const redactor = createRedactor();
    const fields = sanitizeFields(
      {
        authorization: 'Basic abc',
        deep: { a: { b: { leaseToken: 'L', actionToken: 'A', 'set-cookie': 'c', dispatchTicket: 't', password: 'p', apiKey: 'k' } } },
        tabSessionId: OP,
        inputTokens: 1200,
      },
      redactor,
    );
    expect(fields['authorization']).toBe(REDACTED);
    expect(fields['deep']).toEqual({ a: { b: { leaseToken: REDACTED, actionToken: REDACTED, 'set-cookie': REDACTED, dispatchTicket: REDACTED, password: REDACTED, apiKey: REDACTED } } });
    expect(fields['tabSessionId']).toBe(OP);
    expect(fields['inputTokens']).toBe(1200);
  });

  it('[LG-003] lets a string through only under an allowlisted field name', () => {
    const fields = sanitizeFields(
      {
        text: 'привет, это переписка',
        draft: 'мой черновик',
        prompt: 'system prompt',
        fanName: 'Tomasz',
        parts: ['часть 1', 'часть 2'],
        message: 'not an error',
        code: 'CG-HUB-UNAVAILABLE',
        state: 'held',
        opId: OP,
        missing: ['app', 'router'],
        insertMs: 12,
        error: { name: 'TypeError', message: 'x is undefined', stack: 'at f (moz-extension://u/a.js:1:2)' },
      },
      createRedactor(),
    );
    expect(fields['text']).toBe(lengthMark('привет, это переписка'));
    expect(fields['draft']).toBe('[text len=12]');
    expect(fields['prompt']).toBe('[text len=13]');
    expect(fields['fanName']).toBe('[text len=6]');
    expect(fields['parts']).toEqual(['[text len=7]', '[text len=7]']);
    expect(fields['message']).toBe('[text len=12]');
    expect(fields['code']).toBe('CG-HUB-UNAVAILABLE');
    expect(fields['state']).toBe('held');
    expect(fields['opId']).toBe(OP);
    expect(fields['missing']).toEqual(['app', 'router']);
    expect(fields['insertMs']).toBe(12);
    expect(fields['error']).toEqual({ name: 'TypeError', message: 'x is undefined', stack: 'at f (moz-extension://u/a.js:1:2)' });
    expect(isAllowedStringField('message', 'cause')).toBe(true);
    expect(isAllowedStringField('message', null)).toBe(false);
    expect(isAllowedStringField('id', null)).toBe(false);
  });

  it('[LG-003] free text under common field names and data keys becomes its length', () => {
    const h = harness();
    h.logger.info('bg.x', 'm', {
      fields: {
        items: ['hey babe how are you'],
        account: 'Lora Real Name',
        fan: { name: 'Jess' },
        chat: 'fan wrote hello',
        result: 'Hey babe, model output here',
        from: 'Fan Display',
        to: 'Jess',
        paid: 'a fan wrote this',
        resource: 'resource text',
        barcode: 'secretword',
        format: 'free text here',
        error: 'model said: hi babe',
        reason: 'привет',
        byChat: { 'Alice Smith': 3, Алиса: 4, '518588958': 5 },
      },
    });
    const fields = h.sunk[0]?.fields ?? {};
    expect(fields).toEqual({
      items: ['[text len=20]'],
      account: '[text len=14]',
      fan: { name: '[text len=4]' },
      chat: '[text len=15]',
      result: '[text len=27]',
      from: '[text len=11]',
      to: '[text len=4]',
      paid: '[text len=16]',
      resource: '[text len=13]',
      barcode: '[text len=10]',
      format: '[text len=14]',
      error: '[text len=19]',
      reason: '[text len=6]',
      // An integer-like key comes first in an object, so the marks count from 1.
      byChat: { '518588958': 5, '[key#1]': 3, '[key#2]': 4 },
    });
    for (const name of ['chat', 'items', 'account', 'paid', 'resource', 'barcode', 'name', 'result', 'from', 'to', 'detail', 'format_text']) {
      expect(isAllowedStringField(name, null)).toBe(false);
    }
  });

  it('[LG-022] never leaks a secret through keys either', () => {
    const redactor = createRedactor();
    redactor.setToken(TOKEN);
    const out = JSON.stringify(sanitizeValue({ [`k_${TOKEN}`]: 1 }, redactor));
    expect(out).not.toContain(TOKEN);
  });

  it('[LG-022] a string without a field name is never let through', () => {
    const redactor = createRedactor();
    expect(sanitizeValue(['hey babe text', { text: 'x' }], redactor, { allowlist: true })).toEqual(['[text len=13]', { text: '[text len=1]' }]);
    expect(sanitizeValue('draft text here', redactor, { allowlist: true })).toBe('[text len=15]');
    expect(sanitizeFields('draft text here', redactor)).toEqual({ value: '[text len=15]' });
    // Without the allowlist (records already redacted) the string is only scrubbed.
    expect(sanitizeValue('ok text', redactor, { allowlist: false })).toBe('ok text');
  });

  it('[LG-003] a URL fragment alone is masked too', () => {
    expect(scrubText('open https://h.example/cb#access_token=abc123xyz now')).toBe(`open https://h.example/cb?${REDACTED} now`);
  });
});

describe('mandatory events', () => {

  it('[LG-013] sign-in and sign-out records never carry the password or the token', () => {
    const h = harness();
    h.logger.redactor.setToken(TOKEN);
    logEvent(h.logger, 'signedIn', { fields: { login: 'anna', password: 'hunter2', token: TOKEN, role: 'chatter', epoch: 4 } });
    logEvent(h.logger, 'signedOut', { fields: { serverRevoked: true, epoch: 5 } });
    const all = everywhere(h);
    expect(all).not.toContain('hunter2');
    expect(all).not.toContain(TOKEN);
    expect(h.sunk[0]?.fields).toMatchObject({ password: REDACTED, token: REDACTED, epoch: 4 });
  });

  it('[LG-017] the P1 journal: route, inserts and refusals, X8 states — ids and codes only', () => {
    const h = harness();
    logEvent(h.logger, 'routeChanged', { fields: { routeEpoch: 7, kind: 'chat' }, ctx: { routeEpoch: 7 } });
    logEvent(h.logger, 'insertApplied', { fields: { insertMs: 38, draftDigest: 'd1', text: 'hello babe' }, ctx: { opId: OP, routeEpoch: 7 } });
    logEvent(h.logger, 'insertRefused', { code: 'CG-INSERT-CHAT-CHANGED', fields: { reason: 'chat-changed' }, ctx: { opId: OP } });
    logEvent(h.logger, 'insertUncertain', { code: 'CG-INSERT-UNCERTAIN', ctx: { opId: OP } });
    logEvent(h.logger, 'sendAttemptState', { fields: { state: 'held', reason: 'CG-SEND-STALE' }, ctx: { attemptId: OP } });
    expect(h.sunk.map((r) => [r.level, r.scope, r.code ?? null])).toEqual([
      ['info', 'tab.route', null],
      ['info', 'tab.insert', null],
      ['warn', 'tab.insert', 'CG-INSERT-CHAT-CHANGED'],
      ['error', 'tab.insert', 'CG-INSERT-UNCERTAIN'],
      ['info', 'bg.send', null],
    ]);
    expect(h.sunk[1]?.fields).toEqual({ insertMs: 38, draftDigest: 'd1', text: '[text len=10]' });
    expect(everywhere(h)).not.toContain('hello babe');
  });
});
