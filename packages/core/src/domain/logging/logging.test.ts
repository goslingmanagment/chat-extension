import { LOG_LIMITS } from '@cg/contracts/limits';
import { LogRecordFromUiSchema, LogRecordSchema, type LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import {
  CodeCounters,
  LOG_EVENTS,
  REDACTED,
  Ring,
  buildRecord,
  createLogForwarder,
  createLogger,
  createRedactor,
  formatRecordLine,
  isAllowedStringField,
  jsonBytes,
  lengthMark,
  localDayKey,
  logEvent,
  logHostContract,
  logStart,
  logUsage,
  normalizeScope,
  recordBytes,
  redactRecord,
  sanitizeFields,
  sanitizeValue,
  scrubText,
  serializeError,
  tokenSecrets,
  truncateText,
  utf8Length,
  type ConsolePort,
  type LogEventId,
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

  it('[LG-003] machine values stay: word-boundary endings, exact names, codes in `error`', () => {
    const fields = sanitizeFields(
      {
        op_id: OP,
        STARTED_AT: '2026-10-03T12:00:00.000Z',
        accountId: '36408',
        chatKey: 'chatspace:36408:518588958',
        format: 'json',
        error: 'CG-HUB-UNAVAILABLE',
        route: 'https://gosling-agency.ru/v1/x?fan=1',
        degraded: ['fansMap:off'],
        counts: { 'CG-NETWORK': 2, 'p1.insert-misplaced': 1 },
      },
      createRedactor(),
    );
    expect(fields).toEqual({
      op_id: OP,
      STARTED_AT: '2026-10-03T12:00:00.000Z',
      accountId: '36408',
      chatKey: 'chatspace:36408:518588958',
      format: 'json',
      error: 'CG-HUB-UNAVAILABLE',
      route: `https://gosling-agency.ru/v1/x?${REDACTED}`,
      degraded: ['fansMap:off'],
      counts: { 'CG-NETWORK': 2, 'p1.insert-misplaced': 1 },
    });
    // An error keeps its own text (LG-009), only inside an error container.
    expect(sanitizeFields({ cause: { name: 'TypeError', message: 'x is undefined', detail: 'a b' } }, createRedactor())).toEqual({
      cause: { name: 'TypeError', message: 'x is undefined', detail: 'a b' },
    });
  });

  it('[LG-003] is idempotent, so the background can redact a tab record again', () => {
    const redactor = createRedactor();
    redactor.setToken(TOKEN);
    const once = sanitizeFields({ reason: `token=${TOKEN} and https://h/p?q=1`, text: 'hello', list: Array.from({ length: 150 }, (_, i) => i) }, redactor);
    const twice = sanitizeFields(once, redactor);
    expect(twice).toEqual(once);
    expect(scrubText(scrubText('token=abcdef'))).toBe(scrubText('token=abcdef'));
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

describe('[LG-008] record limits', () => {
  const env = { now: T0, seq: 1, redactor: createRedactor(), maxBytes: LOG_LIMITS.maxRecordBytes };

  it('[LG-008] cuts depth at 8, arrays and keys at 100, strings at 20 000', () => {
    let deep: Record<string, unknown> = { state: 'bottom' };
    for (let i = 0; i < 12; i += 1) deep = { state: `level${i}`, child: deep };
    const wide = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}Id`, i]));
    const value = sanitizeValue({ deep, wide, list: Array.from({ length: 150 }, (_, i) => i), reason: 'x'.repeat(30_000) }, createRedactor(), {
      baseDepth: 1,
    }) as Record<string, unknown>;
    expect(JSON.stringify(value)).toContain('[depth]');
    expect(Object.keys(value['wide'] as object)).toHaveLength(100);
    expect((value['wide'] as Record<string, unknown>)['_truncatedKeys']).toBe(51);
    expect(value['list']).toHaveLength(100);
    expect((value['list'] as unknown[])[99]).toBe('[+51 more]');
    expect((value['reason'] as string).length).toBeLessThanOrEqual(LOG_LIMITS.maxStringLength);
    expect(value['reason'] as string).toMatch(/…\[\+\d+\]$/);
  });

  it('[LG-008] the depth limit is exact: an object at the limit depth becomes a mark', () => {
    const limits = { maxDepth: 3, maxArrayLength: 100, maxObjectKeys: 100, maxStringLength: 100 };
    expect(sanitizeValue({ a: { b: { c: { d: 1 } } } }, createRedactor(), { limits })).toEqual({ a: { b: { c: '[depth]' } } });
    expect(sanitizeValue({ a: { b: { c: 1 } } }, createRedactor(), { limits })).toEqual({ a: { b: { c: 1 } } });
    expect(sanitizeValue({ a: { b: 1 } }, createRedactor(), { limits, baseDepth: 2 })).toEqual({ a: '[depth]' });
  });

  it('[LG-008] keeps every record within 8 KiB and valid by the schema, however large the input', () => {
    const huge = { reason: 'é'.repeat(20_000), list: Array.from({ length: 100 }, () => ({ state: 'z'.repeat(5000) })) };
    const record = buildRecord({ level: 'error', scope: 'bg.test', msg: 'm'.repeat(2000), fields: huge, code: 'CG-UNKNOWN' }, env);
    expect(recordBytes(record)).not.toBeNull();
    expect(recordBytes(record)).toBeLessThanOrEqual(LOG_LIMITS.maxRecordBytes);
    expect(LogRecordSchema.safeParse(record).success).toBe(true);
    expect(record.msg.length).toBeLessThanOrEqual(500);
    expect(record.code).toBe('CG-UNKNOWN');
  });

  it('[LG-008] replaces fields by a note only when nothing smaller fits', () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`stage${i}`, 'é'.repeat(200)]));
    const shrunk = buildRecord({ level: 'info', scope: 'bg.test', msg: 'm', fields: many }, { ...env, maxBytes: 600 });
    expect(shrunk.fields?.['_truncatedKeys']).toBe(85);
    const record = buildRecord({ level: 'info', scope: 'bg.test', msg: 'm', fields: many }, { ...env, maxBytes: 200 });
    expect(record.fields).toEqual({ _truncated: true, _fieldCount: 100 });
    expect(recordBytes(record, 200)).not.toBeNull();
    const tiny = buildRecord({ level: 'info', scope: 'bg.test', msg: 'm'.repeat(400), fields: many }, { ...env, maxBytes: 120 });
    expect(tiny.fields).toEqual({ _truncated: true });
  });

  it('[LG-008] truncates text with a visible mark and never splits a surrogate pair', () => {
    expect(truncateText('short', 10)).toBe('short');
    const cut = truncateText('a'.repeat(100), 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut).toMatch(/^a+…\[\+\d+\]$/);
    const emoji = truncateText('😀'.repeat(10), 12);
    expect(emoji.length).toBeLessThanOrEqual(12);
    expect(() => encodeURIComponent(emoji)).not.toThrow();
    expect(truncateText('abcdefgh', 3)).toBe('abc');
    expect(truncateText(`${'a'.repeat(9_990)}😀${'b'.repeat(30)}`, 10_000).length).toBeLessThanOrEqual(10_000);
  });

  it('[LG-008] normalizes scope and drops bad ctx and codes', () => {
    expect(normalizeScope('bg.ops')).toBe('bg.ops');
    expect(normalizeScope('Tab.Dock/Main')).toBe('tab.dock-main');
    expect(normalizeScope('9lives')).toBe('x9lives');
    expect(normalizeScope('...')).toBe('unknown');
    const record = buildRecord(
      { level: 'info', scope: 'bg.x', msg: '', code: 'CG-NOPE', ctx: { opId: 'not-a-uuid', session: 3, routeEpoch: -1, chatKey: 'chatspace:1:2', documentEpoch: 'doc_1' } },
      env,
    );
    expect(record.code).toBeUndefined();
    expect(record.fields).toEqual({ invalidCode: 'CG-NOPE' });
    expect(record.ctx).toEqual({ session: 3, chatKey: 'chatspace:1:2', documentEpoch: 'doc_1' });
    expect(record.msg).toBe('(no message)');
    expect(LogRecordSchema.safeParse(record).success).toBe(true);
  });
});

describe('[LG-011] records from a tab or page', () => {
  it('[LG-011] a UI logger keeps records within 4 KiB', () => {
    const h = harness({ maxBytes: LOG_LIMITS.maxRecordBytesFromUi });
    const record = h.logger.error('tab.dock', 'render failed', { fields: { reason: 'é'.repeat(20_000) }, code: 'CG-UI-FAILED' });
    expect(record).not.toBeNull();
    expect(LogRecordFromUiSchema.safeParse(record).success).toBe(true);
  });

  it('[LG-011] batches up to 50 per write, keeps a bounded backlog and counts losses', async () => {
    const batches: number[] = [];
    let fail = true;
    const scheduled: (() => void)[] = [];
    const forwarder = createLogForwarder({
      send: (records) => {
        if (fail) return Promise.reject(new Error('unreachable'));
        batches.push(records.length);
        return Promise.resolve({ accepted: records.length - 1, dropped: 1 });
      },
      schedule: (fn) => scheduled.push(fn),
      backlogMax: 120,
    });
    const h = harness();
    const record = h.logger.info('tab.x', 'm');
    if (record === null) throw new Error('no record');
    for (let i = 0; i < 130; i += 1) forwarder.push(record);
    expect(scheduled).toHaveLength(1);
    expect(forwarder.stats()).toMatchObject({ pending: 120, lost: 10 });
    await forwarder.flush();
    expect(forwarder.stats()).toMatchObject({ pending: 120, failures: 1 });
    fail = false;
    scheduled[0]?.();
    await forwarder.flush();
    expect(batches).toEqual([50, 50, 20]);
    expect(forwarder.stats()).toEqual({ pending: 0, sent: 117, lost: 13, failures: 1 });
  });

  it('[LG-011] an overflow while a batch is on its way trims only the waiting records', async () => {
    const batches: string[][] = [];
    const gate = { open: (): void => undefined, fail: false };
    const forwarder = createLogForwarder({
      send: (records) => {
        batches.push(records.map((r) => r.msg));
        if (batches.length > 1) return Promise.resolve({ accepted: records.length, dropped: 0 });
        return new Promise((resolve) => {
          gate.open = () => resolve({ accepted: records.length, dropped: 0 });
        });
      },
      schedule: () => undefined,
      batchMax: 2,
      backlogMax: 4,
    });
    const record = (msg: string): LogRecord => ({ ts: new Date(T0).toISOString(), seq: 1, level: 'info', scope: 'tab.x', msg });
    forwarder.push(record('a'));
    const first = forwarder.flush();
    for (const msg of ['b', 'c', 'd', 'e', 'f']) forwarder.push(record(msg));
    // `a` travels; of the five waiting, the oldest (`b`) goes.
    expect(forwarder.stats()).toMatchObject({ pending: 5, lost: 1 });
    gate.open();
    await first;
    expect(batches).toEqual([['a'], ['c', 'd'], ['e', 'f']]);
    expect(forwarder.stats()).toEqual({ pending: 0, sent: 5, lost: 1, failures: 0 });

    // A failed batch returns to the head, and the bound still holds: the oldest go.
    batches.length = 0;
    const second = createLogForwarder({
      send: (records) => {
        batches.push(records.map((r) => r.msg));
        if (!gate.fail) return Promise.resolve({ accepted: records.length, dropped: 0 });
        return new Promise((_resolve, reject) => {
          gate.open = () => reject(new Error('away'));
        });
      },
      schedule: () => undefined,
      batchMax: 2,
      backlogMax: 4,
    });
    gate.fail = true;
    second.push(record('a'));
    second.push(record('b'));
    const pendingSend = second.flush();
    for (const msg of ['c', 'd', 'e', 'f', 'g']) second.push(record(msg));
    gate.open();
    await pendingSend;
    expect(second.stats()).toEqual({ pending: 4, sent: 0, lost: 3, failures: 1 });
    gate.fail = false;
    await second.flush();
    expect(batches).toEqual([['a', 'b'], ['d', 'e'], ['f', 'g']]);
  });
});

describe('[LG-009] error fields', () => {
  it('[LG-009] keeps name, message, stack, code, detail and cause', () => {
    const cause = Object.assign(new RangeError('inner'), { code: 'E_INNER' });
    const error = Object.assign(new TypeError('outer', { cause }), { code: 'CG-HUB-REQUEST', detail: 'HTTP 400 • bad_request' });
    const out = serializeError(error);
    expect(out).toMatchObject({ name: 'TypeError', message: 'outer', code: 'CG-HUB-REQUEST', detail: 'HTTP 400 • bad_request' });
    expect(typeof out['stack']).toBe('string');
    expect(out['cause']).toMatchObject({ name: 'RangeError', message: 'inner', code: 'E_INNER' });
  });

  it('[LG-009] reads a hub call failure by its facts and cuts long cause chains', () => {
    const hubError = { name: 'HubCallError', route: 'bootstrap', epoch: 3, failure: { kind: 'http', status: 503, error: 'service_unavailable', reason: null, retryAfterMs: null } };
    expect(serializeError(hubError)).toEqual({
      name: 'HubCallError',
      route: 'bootstrap',
      epoch: 3,
      failure: { kind: 'http', status: 503, error: 'service_unavailable' },
    });
    let chain: Error = new Error('e0');
    for (let i = 1; i < 6; i += 1) chain = new Error(`e${i}`, { cause: chain });
    expect(JSON.stringify(serializeError(chain))).toContain('[depth]');
    expect(serializeError('thrown text')).toEqual({ name: 'NonError', message: 'thrown text' });
    expect(serializeError(42)).toEqual({ name: 'NonError', message: '[number]' });
    const hostile = new Proxy({}, { get: () => { throw new Error('no'); } });
    expect(serializeError(hostile)).toEqual({ name: 'Unreadable' });
  });
});

describe('[LG-001] [LG-002] [LG-004] levels', () => {
  it('[LG-001] debug records and console debug only in debug mode', () => {
    const h = harness();
    expect(h.logger.debug('bg.x', 'hidden')).toBeNull();
    h.logger.info('bg.x', 'info line');
    expect(h.lines).toEqual([]);
    expect(h.logger.stats().skippedDebug).toBe(1);
    h.setDebug(true);
    h.logger.debug('bg.x', 'shown');
    expect(h.lines.map((l) => l.level)).toEqual(['debug']);
    expect(h.lines[0]?.line).toMatch(/^\[ChatGoose\] .* DEBUG \[bg\.x\] shown$/);
  });

  it('[LG-002] warnings and errors reach the console always', () => {
    const h = harness();
    h.logger.warn('bg.x', 'w');
    h.logger.error('bg.x', 'e', { code: 'CG-NETWORK' });
    expect(h.lines.map((l) => l.level)).toEqual(['warn', 'error']);
    expect(h.lines[1]?.line).toContain('CG-NETWORK');
  });

  it('[LG-004] every level lands in the sink with its level; debug only in debug mode', () => {
    const h = harness({ debug: true });
    for (const level of ['debug', 'info', 'warn', 'error'] as const) h.logger.write(level, 'bg.x', level);
    expect(h.sunk.map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(h.logger.stats().byLevel).toEqual({ debug: 1, info: 1, warn: 1, error: 1 });
    expect(h.sunk.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
  });

  it('[LG-004] a child logger adds its ctx and shares the ring', () => {
    const h = harness();
    h.logger.child({ opId: OP }).info('bg.ai', 'started');
    expect(h.logger.recent(1)[0]?.ctx).toEqual({ opId: OP });
  });
});

describe('[LG-006] ring of the last records', () => {
  it('[LG-006] keeps the last 1000 records per context', () => {
    const h = harness();
    for (let i = 0; i < 1005; i += 1) h.logger.info('bg.x', `m${i}`);
    const recent = h.logger.recent();
    expect(recent).toHaveLength(1000);
    expect(recent[0]?.msg).toBe('m5');
    expect(h.logger.stats().ringOverwritten).toBe(5);
    expect(h.logger.recent(2).map((r) => r.msg)).toEqual(['m1003', 'm1004']);
  });

  it('[LG-006] ring basics', () => {
    const ring = new Ring<number>(3);
    expect(ring.tail(5)).toEqual([]);
    [1, 2, 3, 4].forEach((n) => ring.push(n));
    expect(ring.toArray()).toEqual([2, 3, 4]);
    expect(ring.size).toBe(3);
    ring.clear();
    expect(ring.toArray()).toEqual([]);
  });
});

describe('[LG-007] record format', () => {
  it('[LG-007] ISO time, level, [scope], CG code, message, ctx and fields as JSON', () => {
    const record = buildRecord(
      { level: 'warn', scope: 'bg.hub', msg: 'bootstrap failed', code: 'CG-HUB-TIMEOUT', fields: { ms: 20_000 }, ctx: { session: 2 } },
      { now: T0, seq: 7, redactor: createRedactor(), maxBytes: 8192 },
    );
    expect(record).toEqual({
      ts: '2026-10-03T12:00:00.000Z',
      seq: 7,
      level: 'warn',
      scope: 'bg.hub',
      msg: 'bootstrap failed',
      code: 'CG-HUB-TIMEOUT',
      ctx: { session: 2 },
      fields: { ms: 20_000 },
    });
    expect(formatRecordLine(record)).toBe('2026-10-03T12:00:00.000Z WARN  [bg.hub] CG-HUB-TIMEOUT bootstrap failed ctx={"session":2} {"ms":20000}');
  });
});

describe('[LG-010] error counters by CG code for the day', () => {
  it('[LG-010] counts codes per local day and rolls over at midnight', () => {
    const h = harness();
    h.logger.error('bg.hub', 'x', { code: 'CG-HUB-UNAVAILABLE' });
    h.logger.error('bg.hub', 'x', { code: 'CG-HUB-UNAVAILABLE' });
    h.logger.warn('bg.ai', 'x', { code: 'CG-PROVIDER-STREAM' });
    expect(h.logger.counters.todayCounts(T0)).toEqual([
      { code: 'CG-HUB-UNAVAILABLE', count: 2 },
      { code: 'CG-PROVIDER-STREAM', count: 1 },
    ]);
    expect(h.logger.counters.todayOfKind(T0, 'hub')).toEqual([{ code: 'CG-HUB-UNAVAILABLE', count: 2 }]);
    const tomorrow = T0 + 24 * 3600_000;
    expect(h.logger.counters.todayCounts(tomorrow)).toEqual([]);
    expect(h.logger.counters.snapshot(tomorrow).previous).toEqual({ 'CG-HUB-UNAVAILABLE': 2, 'CG-PROVIDER-STREAM': 1 });
    expect(h.logger.counters.sessionCounts()).toHaveLength(2);
  });

  it('[LG-010] a late record from before midnight never wipes today’s counts', () => {
    const midnight = new Date(2026, 9, 4, 0, 0, 0).getTime();
    const counters = new CodeCounters(midnight);
    counters.count('CG-NETWORK', midnight + 5000);
    counters.count('CG-NETWORK', midnight + 5000);
    // A tab's record of 23:59:59 the day before, delivered late.
    counters.count('CG-NETWORK', midnight - 1000);
    counters.count('CG-NETWORK', midnight + 6000);
    // Two days back: only since the start.
    counters.count('CG-TIMEOUT', midnight - 2 * 86_400_000);
    const snapshot = counters.snapshot(midnight + 7000);
    expect(snapshot.today).toEqual({ 'CG-NETWORK': 3 });
    expect(snapshot.day).toBe(localDayKey(midnight));
    expect(snapshot.previous).toEqual({});
    expect(counters.sessionCounts()).toEqual([
      { code: 'CG-NETWORK', count: 4 },
      { code: 'CG-TIMEOUT', count: 1 },
    ]);
    // After a real roll, a late record of the previous day lands there.
    const later = new CodeCounters(midnight - 3_600_000);
    later.count('CG-NETWORK', midnight - 3_600_000);
    later.count('CG-TIMEOUT', midnight + 1000);
    later.count('CG-NETWORK', midnight - 500);
    expect(later.snapshot(midnight + 2000)).toMatchObject({ today: { 'CG-TIMEOUT': 1 }, previous: { 'CG-NETWORK': 2 } });
  });

  it('[LG-010] survives a background restart through a snapshot, ignoring junk', () => {
    const first = new CodeCounters(T0);
    first.count('CG-NETWORK', T0, 3);
    first.count('not-a-code', T0);
    first.count('CG-NETWORK', T0, -1);
    const snapshot = JSON.parse(JSON.stringify(first.snapshot(T0))) as unknown;
    const second = new CodeCounters(T0);
    second.restore(snapshot, T0 + 1000);
    second.restore(null, T0);
    second.restore({ day: localDayKey(T0), today: { 'CG-NETWORK': 'x', 'CG-NOPE': 3 } }, T0);
    expect(second.todayCounts(T0)).toEqual([{ code: 'CG-NETWORK', count: 3 }]);
    const nextDay = new CodeCounters(T0 + 86_400_000);
    nextDay.restore(snapshot, T0 + 86_400_000);
    expect(nextDay.todayCounts(T0 + 86_400_000)).toEqual([]);
    expect(nextDay.snapshot(T0 + 86_400_000).previous).toEqual({ 'CG-NETWORK': 3 });
  });
});

describe('[LG-012] the logger never throws and never blocks', () => {
  it('[LG-012] survives throwing sinks, consoles, clocks, ctx providers and hostile values', () => {
    const throwing = (): never => {
      throw new Error('boom');
    };
    const logger = createLogger({
      now: throwing,
      debugEnabled: throwing,
      console: { debug: throwing, info: throwing, warn: throwing, error: throwing },
      sinks: [throwing],
      ctx: throwing,
    });
    const circular: Record<string, unknown> = { state: 'a' };
    circular['self'] = circular;
    const getter = Object.defineProperty({}, 'reason', { enumerable: true, get: throwing });
    const proxy = new Proxy({}, { ownKeys: throwing });
    const fields = { circular, getter, proxy, big: 10n, sym: Symbol('s'), fn: () => 1, nan: Number.NaN, date: new Date(T0), bad: new Date(Number.NaN), map: new Map([[1, 2]]), set: new Set([1]), bytes: new Uint8Array(4), undef: undefined };
    expect(() => logger.warn('bg.x', 'hostile', { fields, error: proxy })).not.toThrow();
    const record = logger.recent(1)[0];
    expect(record).toBeDefined();
    expect(LogRecordSchema.safeParse(record).success).toBe(true);
    expect(record?.fields).toMatchObject({
      circular: { state: 'a', self: '[circular]' },
      getter: { reason: '[unreadable]' },
      proxy: '[unreadable]',
      big: '10',
      sym: '[symbol]',
      fn: '[function]',
      nan: null,
      date: '2026-10-03T12:00:00.000Z',
      bad: null,
      map: '[map size=1]',
      set: '[set size=1]',
      bytes: '[binary bytes=4]',
      undef: null,
    });
    expect(logger.stats()).toMatchObject({ sinkFailures: 1, consoleFailures: 1 });
  });

  it('[LG-012] buildRecord falls back to a minimal record when its environment is broken', () => {
    const broken = { text: () => { throw new Error('x'); } };
    const record = buildRecord({ level: 'warn', scope: 'bg.x', msg: 'm' }, { now: T0, seq: 1, redactor: broken, maxBytes: 8192 });
    expect(record).toMatchObject({ scope: 'log', level: 'error', msg: 'log record could not be built' });
    expect(createRedactor().text.call(null, 'x')).toBe('x');
    const fallback = buildRecord({ level: 'info', scope: 'bg.x', msg: 'm' }, { now: T0, seq: 1, redactor: null as never, maxBytes: 8192 });
    expect(fallback).toMatchObject({ scope: 'log', level: 'error' });
  });
});

describe('mandatory events', () => {
  it('[LG-016] the start record carries versions, browser and OS', () => {
    const h = harness();
    logStart(h.logger, { version: '0.1.0', contractsVersion: '1.1.0', browser: 'firefox', browserMajor: 157, os: 'macos', testBuild: false, reason: 'update', previousVersion: '0.0.9' });
    expect(h.sunk[0]).toMatchObject({
      scope: 'bg.lifecycle',
      msg: 'background started',
      fields: { version: '0.1.0', contractsVersion: '1.1.0', browser: 'firefox', browserMajor: 157, os: 'macos', reason: 'update', previousVersion: '0.0.9' },
    });
  });

  it('[LG-016] the host contract record names the build and the missing anchors, with a code when broken', () => {
    const h = harness();
    logHostContract(h.logger, { build: 'index-DEVowLko', adapterVersion: '1', ok: false, missing: ['fansMap'], degraded: ['freshText'] }, 'changed');
    expect(h.sunk[0]).toMatchObject({ code: 'CG-HOST-CONTRACT', msg: 'host contract changed', fields: { build: 'index-DEVowLko', missing: ['fansMap'], degraded: ['freshText'] } });
    logHostContract(h.logger, { build: null, adapterVersion: '1', ok: true, missing: [], degraded: [] });
    expect(h.sunk[1]?.code).toBeUndefined();
    logHostContract(h.logger, { build: 'index-DEVowLko', adapterVersion: '1', ok: false, missing: ['fansMap'], degraded: [] });
    expect(h.sunk[2]).toMatchObject({ level: 'info', code: 'CG-HOST-CONTRACT', msg: 'host contract checked' });
    expect(h.logger.counters.todayCounts(T0)).toEqual([{ code: 'CG-HOST-CONTRACT', count: 2 }]);
  });

  it('[LG-016] a broken contract while ChatSpace is still starting is an info record without the code: not an error of the day, no warning', () => {
    const h = harness();
    logHostContract(h.logger, { build: 'index-p8xPkCj8', adapterVersion: '1', ok: false, missing: ['accounts', 'mimic'], degraded: ['identity'] }, 'starting');
    expect(h.sunk[0]).toMatchObject({ level: 'info', msg: 'host contract checked', fields: { ok: false, missing: ['accounts', 'mimic'], starting: true } });
    expect(h.sunk[0]?.code).toBeUndefined();
    expect(h.logger.counters.todayCounts(T0)).toEqual([]);
    expect(h.lines.filter((line) => line.level === 'warn')).toEqual([]);
  });

  it('[LG-013] [LG-014] [LG-015] [LG-018] every mandatory event has a valid scope and a fixed message', () => {
    const h = harness({ debug: true });
    for (const id of Object.keys(LOG_EVENTS) as LogEventId[]) {
      const record = logEvent(h.logger, id, { fields: { reason: 'r' } });
      expect(record?.scope).toBe(LOG_EVENTS[id].scope);
      expect(LogRecordSchema.safeParse(record).success).toBe(true);
    }
    const scopes = new Set(Object.values(LOG_EVENTS).map((e) => e.scope));
    expect(scopes).toContain('bg.auth');
    expect(scopes).toContain('bg.telemetry');
    expect(scopes).toContain('bg.ai');
    expect(scopes).toContain('bg.lifecycle');
  });

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

  it('[LG-015] [DB-018] usage numbers are logged, never text', () => {
    const h = harness();
    logUsage(h.logger, { feature: 'reply', generationRef: OP, inputTokens: 3412, outputTokens: 286, cacheWriteTokens: 0, cacheReadTokens: 3000, costMicroUsd: 14_300, costApproximate: false, cacheHit: true }, { opId: OP });
    expect(h.sunk[0]).toMatchObject({ msg: 'generation usage', ctx: { opId: OP }, fields: { inputTokens: 3412, costMicroUsd: 14_300, generationRef: OP } });
  });
});

describe('[LG-005] sizes of records', () => {
  it('[LG-005] UTF-8 bytes of text and JSON, surrogate pairs and lone halves included', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('жё')).toBe(4);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
    expect(utf8Length('\ud83d')).toBe(3);
    expect(utf8Length('\ud83dx')).toBe(4);
    expect(jsonBytes({ a: 'ж' })).toBe(10);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(jsonBytes(cyclic)).toBe(0);
    expect(jsonBytes(undefined)).toBe(0);
  });

  it('[LG-003] redactRecord keeps time and order, adds ctx, and is a no-op on a clean record', () => {
    const redactor = createRedactor();
    redactor.setToken(TOKEN);
    const clean = buildRecord({ level: 'info', scope: 'bg.ops', msg: 'op started', fields: { feature: 'reply', text: 'hello' } }, { now: T0, seq: 3, redactor, maxBytes: LOG_LIMITS.maxRecordBytes });
    expect(redactRecord(clean, redactor)).toEqual(clean);
    const again = redactRecord({ ...clean, ts: 'not a time', msg: `uses ${TOKEN}` }, redactor, { ctx: { opId: OP } });
    expect(again).toMatchObject({ ts: new Date(0).toISOString(), seq: 3, msg: 'uses [redacted]', ctx: { opId: OP } });
  });
});
