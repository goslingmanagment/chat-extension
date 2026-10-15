// fansly.com in the tab protocol, the error registry and the settings
// (1.15.0, R20 P4a3; host: fansly-web): the site's own request registry
// (tab-messages-fansly.ts) beside the shared one, the sender kind `relay`, the
// host rules of a request, the Fansly CG codes against Appendix A «Коды
// Fansly», and the separate `settings.ext` key.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as F from '../src/errors-fansly';
import * as C from '../src/index';
import * as X from '../src/settings-ext';
import * as T from '../src/tab-messages-fansly';
import { FANSLY_TAB_EVENT_FIXTURES, FANSLY_TAB_REQUEST_FIXTURES, SETTINGS_EXT_FIXTURES, type Verdicts } from './fixtures/index';

const ARCHITECTURE = readFileSync(new URL('../../../docs/architecture.md', import.meta.url), 'utf8');

function expectVerdicts(label: string, schema: { safeParse(value: unknown): { success: boolean } }, verdicts: Verdicts): void {
  verdicts.valid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} valid[${index}]`).toBe(true));
  verdicts.invalid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} invalid[${index}]`).toBe(false));
}

const envelopeAccepts = (type: string): boolean => C.TabEnvelopeSchema.safeParse({ v: 1, kind: 'evt', type, payload: {} }).success;

describe('[EX-015] [DB-029] [host:fansly] the tab protocol of fansly.com (fansly-web, 1.15.0)', () => {
  it('has fixtures for exactly the registered request and event types', () => {
    expect(Object.keys(FANSLY_TAB_REQUEST_FIXTURES).sort()).toEqual([...T.FANSLY_TAB_REQUEST_TYPES].sort());
    expect(Object.keys(FANSLY_TAB_EVENT_FIXTURES).sort()).toEqual([...T.FANSLY_TAB_EVENT_TYPES].sort());
  });

  for (const type of T.FANSLY_TAB_REQUEST_TYPES) {
    it(`${type}: payload and response schemas (zod, both ways)`, () => {
      const spec = T.FANSLY_TAB_REQUESTS[type];
      const fixtures = FANSLY_TAB_REQUEST_FIXTURES[type];
      for (const verdicts of [fixtures.req, fixtures.res]) expect(verdicts.valid.length * verdicts.invalid.length, type).toBeGreaterThan(0);
      expectVerdicts(`${type} req`, spec.req, fixtures.req);
      expectVerdicts(`${type} res`, spec.res, fixtures.res);
      for (const payload of fixtures.req.valid) expect(T.parseFanslyTabPayload('req', type, payload), type).toEqual({ ok: true, payload });
      for (const payload of fixtures.res.invalid) expect(T.parseFanslyTabPayload('res', type, payload), type).toEqual({ ok: false });
    });
  }

  for (const type of T.FANSLY_TAB_EVENT_TYPES) {
    it(`${type}: event payload schema`, () => {
      const fixtures = FANSLY_TAB_EVENT_FIXTURES[type];
      expect(fixtures.valid.length * fixtures.invalid.length).toBeGreaterThan(0);
      expectVerdicts(`${type} evt`, T.FANSLY_TAB_EVENTS[type].payload, fixtures);
    });
  }

  it('names its types `fansly.<family>.<name>`: two dots, the six families, none a shared type', () => {
    const families = new Set<string>();
    for (const type of [...T.FANSLY_TAB_REQUEST_TYPES, ...T.FANSLY_TAB_EVENT_TYPES]) {
      expect(type, type).toMatch(/^fansly\.[a-z]+\.[a-zA-Z]+$/);
      expect(type.startsWith(T.FANSLY_TAB_TYPE_PREFIX), type).toBe(true);
      expect(envelopeAccepts(type), type).toBe(true);
      families.add(type.split('.')[1] ?? '');
    }
    expect([...families].sort()).toEqual(['followers', 'notes', 'relay', 'sound', 'vault', 'voice']);
    for (const type of [...C.TAB_REQUEST_TYPES, ...C.TAB_EVENT_TYPES]) expect(type.startsWith(T.FANSLY_TAB_TYPE_PREFIX), type).toBe(false);
    expect(T.isFanslyTabRequestType('settings.get')).toBe(false);
    expect(T.isFanslyTabRequestType('__proto__')).toBe(false);
    expect(T.parseFanslyTabPayload('req', 'settings.get', {})).toEqual({ ok: false });
    expect(T.parseFanslyTabPayload('evt', 'fansly.notes.read', {})).toEqual({ ok: false });
  });

  it('every request is the site’s own: a fansly.com tab or its relay sends it, never ChatSpace or a page', () => {
    for (const type of T.FANSLY_TAB_REQUEST_TYPES) {
      const spec: C.TabRequestSpec = T.FANSLY_TAB_REQUESTS[type];
      expect(spec.hosts, type).toEqual(['fansly-web']);
      const relay = type.startsWith('fansly.relay.');
      expect(spec.from, type).toEqual(relay ? ['relay'] : ['tab']);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, 'fansly-web'), type).toBe(true);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, 'chatspace'), type).toBe(false);
      expect(T.mayRequestFansly(type, relay ? 'relay' : 'tab', null, null), type).toBe(false);
      expect(T.mayRequestFansly(type, relay ? 'tab' : 'relay', null, 'fansly-web'), type).toBe(false);
      expect(T.mayRequestFansly(type, 'page', 'options', null), type).toBe(false);
    }
    expect(T.fanslyEventTargets('fansly.relay.fetch')).toEqual(['relay']);
    expect(T.fanslyEventTargets('fansly.followers.changed')).toEqual(['tab']);
  });

  it('the relay fetches Fansly’s API only, and its own last check rides with each request (FS-NET-1, FS-NET-4)', () => {
    const fetch = T.FANSLY_TAB_EVENTS['fansly.relay.fetch'].payload;
    const base = { requestId: '00000000-0000-4000-8000-000000000001', method: 'GET', headers: [], expect: { hostAccountId: '700000000000000001' } };
    expect(fetch.safeParse({ ...base, url: `${T.FANSLY_RELAY_TARGET}group/1` }).success).toBe(true);
    for (const url of ['https://apiv3.fansly.com/api/v2/x', 'https://apiv3.fansly.com.evil.test/api/v1/x', 'http://apiv3.fansly.com/api/v1/x', 'https://chat.onlymonster.ai/api/v1/x']) {
      expect(fetch.safeParse({ ...base, url }).success, url).toBe(false);
    }
  });

  it('a site failure rides in the payload with either registry’s code; the shared envelope stays shared', () => {
    const res = T.FANSLY_TAB_REQUESTS['fansly.notes.read'].res;
    expect(res.safeParse({ ok: false, error: { code: 'CG-NOTE-READ' } }).success).toBe(true);
    expect(res.safeParse({ ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } }).success).toBe(true);
    expect(res.safeParse({ ok: false, error: { code: 'CG-AUTH-01' } }).success).toBe(false);
    const envelope = { v: 1, kind: 'res', id: 3, type: 'fansly.notes.read', ok: false } as const;
    expect(C.TabEnvelopeSchema.safeParse({ ...envelope, error: { code: 'CG-NETWORK' } }).success).toBe(true);
    // A ChatSpace receiver never meets a code it cannot read.
    expect(C.TabEnvelopeSchema.safeParse({ ...envelope, error: { code: 'CG-NOTE-READ' } }).success).toBe(false);
  });
});

describe('[EX-015] [host:fansly] the envelope and the sender rules (1.15.0)', () => {
  it('a type is a word and up to two dotted words', () => {
    for (const type of ['toast', 'op.start', 'fansly.notes.read', 'fansly.followers.prioritize']) expect(envelopeAccepts(type), type).toBe(true);
    for (const type of ['a.b.c.d', 'Fansly.notes.read', 'fansly..read', 'fansly.notes.', '.op', 'op-start', `fansly.${'x'.repeat(40)}`]) expect(envelopeAccepts(type), type).toBe(false);
  });

  it('three ports, three sender kinds: the relay has its own (`cg-relay`)', () => {
    expect([C.TAB_PORT_NAME, C.PAGE_PORT_NAME, C.RELAY_PORT_NAME]).toEqual(['cg-tab', 'cg-page', 'cg-relay']);
    for (const type of C.TAB_REQUEST_TYPES) expect(C.mayRequest(type, 'relay', null, 'fansly-web'), type).toBe(false);
    for (const type of C.TAB_EVENT_TYPES) expect(C.TAB_EVENTS[type].to, type).not.toContain('relay');
  });

  it('X8 and the hub’s «Новые» are ChatSpace’s: a fansly.com tab is refused them, a page is not affected', () => {
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
});

/** Rows of Appendix A «Коды Fansly»: code, meaning, «Повтор», the old extension's codes. */
function fanslyAppendixRows(): { code: string; meaning: string; retry: string; old: string }[] {
  const start = ARCHITECTURE.indexOf('**Коды Fansly**');
  const end = ARCHITECTURE.indexOf('**Хаб → коды Fansly**', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return [...ARCHITECTURE.slice(start, end).matchAll(/^\| (CG-[A-Z0-9-]+) \| (.+?) \| (\S+) \| (.+) \|$/gm)].map((m) => ({ code: m[1] ?? '', meaning: m[2] ?? '', retry: m[3] ?? '', old: m[4] ?? '' }));
}

function fanslyHubAppendixRows(): { error: string; status: number; cg: string }[] {
  const start = ARCHITECTURE.indexOf('**Хаб → коды Fansly**');
  const end = ARCHITECTURE.indexOf('**Колонка «chat-extension»', start);
  expect(end).toBeGreaterThan(start);
  return [...ARCHITECTURE.slice(start, end).matchAll(/^\| `([a-z_]+)` \| (\d{3}) \| (CG-[A-Z0-9-]+) \|$/gm)].map((m) => ({ error: m[1] ?? '', status: Number(m[2]), cg: m[3] ?? '' }));
}

describe('[ER-001] [ER-002] [ER-004] [host:fansly] the Fansly CG codes (errors-fansly.ts, Appendix A «Коды Fansly»)', () => {
  const entries = Object.values(F.CG_FANSLY_REGISTRY);

  it('are exactly the Appendix A list, in its order, and follow its «Повтор» column', () => {
    const rows = fanslyAppendixRows();
    expect(rows.map((row) => row.code)).toEqual([...F.CG_FANSLY_CODES]);
    expect(Object.keys(F.CG_FANSLY_REGISTRY)).toEqual([...F.CG_FANSLY_CODES]);
    for (const row of rows) expect(C.CG_RETRY_APPENDIX_A[F.cgFanslyEntry(row.code as F.CgFanslyCode).retry], row.code).toBe(row.retry);
  });

  it('keep the CG-<AREA>-<NAME> form in the five Fansly areas, apart from the shared codes', () => {
    expect(new Set(F.CG_FANSLY_CODES).size).toBe(F.CG_FANSLY_CODES.length);
    for (const code of F.CG_FANSLY_CODES) {
      expect(code).toMatch(C.CG_CODE_PATTERN);
      expect(code).toMatch(/^CG-(FAN|NOTE|VOICE|VAULT|FNEW)-[A-Z]+(?:-[A-Z]+)*$/);
      expect(C.isCgCode(code), code).toBe(false);
    }
    expect(F.CG_ANY_CODES).toEqual([...C.CG_CODES, ...F.CG_FANSLY_CODES]);
    expect(new Set(F.CG_ANY_CODES).size).toBe(F.CG_ANY_CODES.length);
    expect(F.isCgAnyCode('CG-NETWORK') && F.isCgAnyCode('CG-FAN-TAB') && !F.isCgFanslyCode('CG-NETWORK')).toBe(true);
  });

  it('[ER-083] [ER-003] never take a number of the old extension — its retired ones least of all', () => {
    expect([...F.FANSLY_RETIRED_OLD_CODES]).toEqual(['CG-AUTH-01', 'CG-AUTH-02', 'CG-API-02', 'CG-API-03', 'CG-API-04']);
    for (const old of F.FANSLY_RETIRED_OLD_CODES) {
      expect(F.isCgAnyCode(old), old).toBe(false);
      expect(F.CgAnyErrorWireSchema.safeParse({ code: old }).success, old).toBe(false);
    }
    // No numeric code at all: the old extension's numbers mean something else (CG-FAN-01…04, CG-VOICE-01…12).
    for (const code of F.CG_ANY_CODES) expect(code, code).not.toMatch(/-\d+$/);
    expect(F.CG_FANSLY_RETIRED_CODES).toEqual([]);
    for (const entry of entries) expect(entry.retired).toBeUndefined();
  });

  it('name the old extension’s code they replace, and only codes of its registry', () => {
    const old = fanslyAppendixRows().flatMap((row) => (row.old === '—' ? [] : row.old.split(', ')));
    for (const code of old) expect(code).toMatch(/^CG-(FAN|API|VOICE)-\d{2}$/);
    expect(old.filter((code) => code.startsWith('CG-VOICE-')).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `CG-VOICE-${String(i + 1).padStart(2, '0')}`));
    expect(old).toEqual(expect.arrayContaining(['CG-FAN-01', 'CG-FAN-02', 'CG-FAN-03', 'CG-FAN-04', 'CG-API-01']));
    for (const retired of F.FANSLY_RETIRED_OLD_CODES) expect(old).not.toContain(retired);
  });

  it('entries: known vocabularies, text keys from the code, keys apart from the shared catalog, settings links with their own code', () => {
    const shared = new Set<string>(C.I18N_KEYS);
    for (const entry of entries) {
      expect(F.CG_FANSLY_KINDS, entry.code).toContain(entry.kind);
      expect(C.CG_SEVERITIES, entry.code).toContain(entry.severity);
      expect(C.CG_RECOVERIES, entry.code).toContain(entry.recovery);
      expect(C.CG_RETRIES, entry.code).toContain(entry.retry);
      expect(C.CG_TELEMETRY_CLASSES, entry.code).toContain(entry.telemetry);
      expect(entry.title).toBe(C.cgTitleKey(entry.code));
      expect(entry.body).toBe(C.cgBodyKey(entry.code));
      expect(shared.has(entry.title) || shared.has(entry.body), entry.code).toBe(false);
      if (entry.settings !== undefined) {
        expect(entry.settings.code).toBe(entry.code);
        expect(C.SETTINGS_SECTIONS).toContain(entry.settings.section);
      }
      const area = entry.code.split('-')[1];
      expect(entry.kind, entry.code).toBe({ FAN: 'fansly', NOTE: 'note', VOICE: 'voice', VAULT: 'vault', FNEW: 'newcomers' }[area ?? '']);
    }
    expect(F.CG_FANSLY_I18N_KEYS).toHaveLength(2 * F.CG_FANSLY_CODES.length);
    expect(new Set(F.CG_FANSLY_I18N_KEYS).size).toBe(F.CG_FANSLY_I18N_KEYS.length);
  });

  it('keep the retry rule and the recovery consistent; nothing indeterminate is offered again', () => {
    for (const entry of entries) {
      expect(entry.retry === 'after-deadline', entry.code).toBe(entry.recovery === 'wait-until');
      if (entry.retry === 'never') expect(['retry', 'new-generation'], entry.code).not.toContain(entry.recovery);
    }
    expect(F.cgFanslyEntry('CG-VOICE-UNCERTAIN').retry).toBe('never');
    // An unknown write is read again, never written again (FS-NOTE-4, FS-VLT-1, FS-VOI-2).
    expect(F.cgFanslyEntry('CG-NOTE-UNCERTAIN').retry).toBe('safe-read');
    for (const code of ['CG-VAULT-UNCERTAIN', 'CG-VOICE-ATTACH-UNKNOWN'] as const) expect(F.cgFanslyEntry(code).recovery, code).toBe('none');
  });

  it('the hub’s voice codes read as Fansly codes by the table, and no shared rule claims one', () => {
    const rows = fanslyHubAppendixRows();
    expect(Object.fromEntries(rows.map((row) => [row.error, { status: row.status, cg: row.cg }]))).toEqual(F.HUB_FANSLY_ERROR_CODES);
    for (const error of Object.keys(F.HUB_FANSLY_ERROR_CODES)) {
      expect(C.HUB_HTTP_ERROR_RULES.some((rule) => rule.error === error), error).toBe(false);
      expect(error in C.HUB_ERROR_STATUSES, error).toBe(false);
    }
    expect(C.HUB_HTTP_ERROR_RULES.some((rule) => rule.error?.startsWith('gate_voice_') === true)).toBe(false);
  });

  it('[HF-9] `conversation_fan_mismatch` (409) is a shared code — the AI stream and its op view are shared: CG-CONTEXT-CHANGED', () => {
    expect(C.HUB_ERROR_STATUSES.conversation_fan_mismatch).toBe(409);
    const rules = C.HUB_HTTP_ERROR_RULES.filter((rule) => rule.error === 'conversation_fan_mismatch');
    expect(rules).toEqual([{ error: 'conversation_fan_mismatch', cg: 'CG-CONTEXT-CHANGED', disposition: 'show' }]);
    expect(C.isCgCode(rules[0]?.cg)).toBe(true);
  });
});

describe('[RB-012] [host:fansly] `settings.ext` (FS-SET-1): its own key and version; settings v1 unchanged', () => {
  it('is a separate storage key, and v1 still holds the depth up to 3000 only', () => {
    expect(C.STORAGE_KEYS.settingsExt).toBe('settings.ext');
    expect(C.STORAGE_KEYS.settings).toBe('settings');
    expect(C.SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(C.SETTINGS_RANGES.windowDeep).toEqual({ min: 100, max: 3000 });
    expect(C.DEFAULT_SETTINGS.generation.windows.deep).toBe(3000);
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, generation: { ...C.DEFAULT_SETTINGS.generation, windows: { ...C.DEFAULT_SETTINGS.generation.windows, deep: 3001 } } }).success).toBe(false);
    expect(Object.keys(C.SettingsV1Schema.shape)).not.toContain('hosts');
  });

  it('the view, the patch and the state', () => {
    expectVerdicts('settings.ext view', X.SettingsExtSchema, SETTINGS_EXT_FIXTURES.view);
    expectVerdicts('settings.ext patch', X.SettingsExtPatchSchema, SETTINGS_EXT_FIXTURES.patch);
    expect(X.SettingsExtSchema.safeParse(X.DEFAULT_SETTINGS_EXT).success).toBe(true);
    expect(X.SettingsExtStateSchema.safeParse({ ext: X.DEFAULT_SETTINGS_EXT, revision: 0, readOnly: false }).success).toBe(true);
    expect(X.SettingsExtStateSchema.safeParse({ ext: X.DEFAULT_SETTINGS_EXT, revision: -1, readOnly: false }).success).toBe(false);
  });

  it('defaults: Fansly off, no relay, notes on demand, the Fansly extension’s tones (X26, X33), no depth above 3000', () => {
    expect(X.DEFAULT_SETTINGS_EXT).toEqual({
      v: 1,
      hosts: { 'fansly-web': { enabled: false, viaTab: false, notesView: 'drawer', sound: { messagesTone: 'chime', subscribersTone: 'double' } } },
      windows: { deep: null },
    });
    expect(X.SETTINGS_EXT_RANGES.windowDeep).toEqual({ min: C.SETTINGS_RANGES.windowDeep.max + 1, max: 5000 });
  });
});

describe('[host:fansly] light modules and the package index', () => {
  it('tab.register and the settings keys take the host kinds of hosts.ts itself, not a copy', () => {
    const read = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const file of ['tab-protocol.ts', 'settings.ts']) {
      expect(read(file), file).toMatch(/import \{ HOST_KINDS, type HostKind \} from '\.\/hosts';/);
      expect(read(file), file).not.toMatch(/\['chatspace', 'fansly-web'\]/);
    }
    expect(C.TabRegisterRequestSchema.shape.host.options).toEqual([...C.HOST_KINDS]);
  });

  it('the Fansly modules and settings.ext are subpaths only: nothing that imports the index carries them', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    for (const module of ['tab-messages-fansly', 'errors-fansly', 'settings-ext']) expect(index, module).not.toContain(`'./${module}'`);
    for (const name of ['FANSLY_TAB_REQUESTS', 'CG_FANSLY_CODES', 'SettingsExtSchema', 'CgAnyErrorWireSchema']) expect(name in C, name).toBe(false);
  });
});
