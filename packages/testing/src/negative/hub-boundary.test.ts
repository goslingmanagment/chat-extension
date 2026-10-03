// Negative checks at the hub boundary (R02; docs/parity, PARITY_EXCEPTIONS):
// functions the new client does not have must not come back. Each check has
// three layers: the contracts the client is built on do not carry the
// function, no shipped source names it (a gate over every non-test file),
// and the fake hub refuses and journals the call, so any e2e or facade test
// against it fails the moment the client makes one.

import {
  CG_CODES,
  DEFAULT_SETTINGS,
  HUB_FORBIDDEN_OPERATIONS,
  HUB_ROUTE_KEYS,
  HubStreamRequestSchema,
  PREFERENCE_KEYS,
  STORAGE_KEYS,
} from '@cg/contracts';
import { PARITY_EXCEPTIONS } from '@cg/contracts/parity/exceptions';
import { describe, expect, it } from 'vitest';

import { HUB_ROUTE_PATHS, streamBody, uuid } from '../scenarios/hub';
import { createFakeHub } from '../fake-hub/hub';
import { hubCall } from '../fake-hub/kit';
import { FORBIDDEN_OPERATION_ROUTES, matchRoute } from '../fake-hub/routing';
import { OFAPI_CODE_PATTERN, ofapiScanPattern, vendoredSdkOfapiNames } from './ofapi';
import { clientSources, findInClientSources, findInFile } from './sources';

/** The files that name the forbidden things to forbid them. */
const REGISTRIES = ['packages/contracts/src/parity/exceptions.ts', 'packages/contracts/src/hub/routes.ts'];

const settingPaths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => [`${prefix}${key}`, ...settingPaths(inner, `${prefix}${key}.`)]) : [];
const SETTING_PATHS = settingPaths(DEFAULT_SETTINGS);

const rowsOf = (id: string): readonly string[] => PARITY_EXCEPTIONS.find((exception) => exception.id === id)?.rows ?? [];

/** The journal's verdict on one call with a narrow token. */
async function journaled(method: string, path: string): Promise<{ status: number; kind: string; violation: boolean }> {
  const hub = createFakeHub();
  const token = hub.issueToken();
  const response = await hub.fetch(`${hub.origin}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const entry = hub.read().entries.at(-1);
  return { status: response.status, kind: entry?.kind ?? 'none', violation: hub.violations().length === 1 };
}

describe('negative scans: what they read', () => {
  it('every shipped source root, the lazy chunks (lazy/entries → lazy/dock.js in the XPI) included; no test file', () => {
    const paths = clientSources().map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(['apps/extension/lazy/entries/dock.ts', 'packages/contracts/src/index.ts']));
    expect(paths.filter((path) => /\.(?:test|spec)\.tsx?$/.test(path))).toEqual([]);
  });
});

describe('[SP-025] [SP-057] [NF-040] [SN-024] [PU-019] [ST-103] [ST-105] [ER-019] [ER-079] [DB-023] [TL-016] [TL-017] [RB-026] NEG-OFAPI', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-OFAPI')).toEqual(['SP-025', 'SP-057', 'NF-040', 'SN-024', 'PU-019', 'ST-103', 'ST-105', 'ER-019', 'ER-079', 'DB-023', 'TL-016', 'TL-017', 'RB-026']);
  });

  it('the client’s hub routes reach no OFAPI path; no CG-OFAPI code; no credits or paid refresh in settings', () => {
    expect(Object.values(HUB_ROUTE_PATHS).filter((path) => /ofapi/i.test(path))).toEqual([]);
    expect(HUB_ROUTE_KEYS.filter((key) => /ofapi/i.test(key))).toEqual([]);
    expect(CG_CODES.filter((code) => code.startsWith('CG-OFAPI'))).toEqual([]);
    expect(SETTING_PATHS.filter((path) => /ofapi|credit|paid|refresh/i.test(path))).toEqual([]);
  });

  it('no shipped source names an OFAPI path, any OFAPI operation, schema or constant of the vendored SDK, or the vendor', () => {
    expect(findInClientSources(ofapiScanPattern(), REGISTRIES)).toEqual([]);
  });

  it('the scan catches every OFAPI name the vendored SDK exposes, the namespace used as code, paths and the vendor; prose stays allowed', () => {
    const sdkNames = vendoredSdkOfapiNames();
    // Derived from the vendored dist, like the sdk-custody gate's markers: a re-vendor brings its own.
    expect(sdkNames.length).toBeGreaterThan(100);
    expect(sdkNames).toEqual(expect.arrayContaining(['ofapiActionDispatch', 'ofapiMediaUploadCreate', 'adminOfapiCreditsDaily', 'ofapiReadGateway', 'OFAPI_READ_CATALOG']));
    // The generic shape alone already covers every SDK name used as code (only the bare namespace word needs the code shapes).
    expect(sdkNames.filter((name) => !/^ofapi$/i.test(name) && !OFAPI_CODE_PATTERN.test(name))).toEqual([]);
    const caught = [
      'await sdk.ofapiActionDispatch({ params });',
      'const chats = await sdk.ofapi.read({ path: "chats" });',
      'sdk.ofapi?.read(x);',
      'void client.adminOfapiCreditsDaily();',
      'const catalog = OFAPI_READ_CATALOG;',
      "fetch(`${origin}/api/v1/ofapi/read/chats`);",
      "fetch('https://app.onlyfansapi.com/api/acct_1/chats');",
      'const op = cancelOfapiCommand;',
      "const capability = 'ofapi_chats';",
    ];
    const allowed = ['// Database only on the hub (no OFAPI, no refresh).', 'const profile = await sdk.pageFanProfile(params);', 'const sofapics = 1; // «ofapi» inside a longer word is not a name of it'];
    const scan = (lines: readonly string[]) => findInFile({ path: 'fixture.ts', text: lines.join('\n') }, ofapiScanPattern());
    expect(scan(caught)).toHaveLength(caught.length);
    expect(scan(allowed)).toEqual([]);
  });

  it('the fake hub refuses an OFAPI call and journals it as forbidden', async () => {
    expect(await journaled('GET', '/api/v1/ofapi/read/chats')).toEqual({ status: 403, kind: 'forbidden', violation: true });
    expect(await journaled('POST', '/api/v1/ofapi/commands/send')).toEqual({ status: 403, kind: 'forbidden', violation: true });
  });
});

describe('[PU-018] [PU-021] [ST-104] [ST-112] [HB-009] [CS-007] [CS-013] NEG-NO-SYNC', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-NO-SYNC')).toEqual(['PU-018', 'PU-021', 'ST-104', 'ST-112', 'HB-009', 'CS-007', 'CS-013']);
  });

  it('no sync keys in settings or storage; the hub routes open no event stream; the event routes are forbidden operations', () => {
    expect(SETTING_PATHS.filter((path) => /sync|event|reconcil|poll/i.test(path))).toEqual([]);
    expect(Object.values(STORAGE_KEYS).filter((key) => /sync|event|chat.?list/i.test(key))).toEqual([]);
    expect(Object.values(HUB_ROUTE_PATHS).filter((path) => /\/events\b/.test(path))).toEqual([]);
    expect(HUB_FORBIDDEN_OPERATIONS.filter((operation) => operation.startsWith('events'))).toEqual(['eventsStream', 'eventsSnapshot', 'eventsV2Stream', 'eventsV2Snapshot', 'eventsV2Facts']);
  });

  it('no shipped source subscribes to the hub’s events or names their paths', () => {
    expect(findInClientSources(/\/events\/|\bsubscribe(?:Domain|Sync)Events\b|\bevents(?:V2)?(?:Stream|Snapshot|Facts)\b|decodeDomainEventCursor/, REGISTRIES)).toEqual([]);
  });

  it('the fake hub refuses the event streams and journals them as forbidden', async () => {
    for (const [operation, spec] of Object.entries(FORBIDDEN_OPERATION_ROUTES).filter(([key]) => key.startsWith('events'))) {
      expect(matchRoute(spec.method, spec.path), operation).toEqual({ kind: 'forbidden', operation });
      expect(await journaled(spec.method, spec.path), operation).toEqual({ status: 403, kind: 'forbidden', violation: true });
    }
  });
});

describe('[TL-015] NEG-LOCAL-HARVEST', () => {
  it('lists exactly this row', () => {
    expect(rowsOf('NEG-LOCAL-HARVEST')).toEqual(['TL-015']);
  });

  it('the hub routes carry no harvest route, no shipped source names one, and the fake hub refuses it', async () => {
    expect([...HUB_ROUTE_KEYS, ...Object.values(HUB_ROUTE_PATHS)].filter((item) => /harvest/i.test(item))).toEqual([]);
    expect(findInClientSources(/harvest/i, REGISTRIES)).toEqual([]);
    expect(await journaled('POST', '/api/v1/ingest/harvest')).toEqual({ status: 403, kind: 'forbidden', violation: true });
  });
});

describe('[AI-098] [ST-098] [ST-099] [ST-100] [TL-014] [RU-003] NEG-HUB-OWNS-AI', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-HUB-OWNS-AI')).toEqual(['AI-098', 'ST-098', 'ST-099', 'ST-100', 'TL-014', 'RU-003']);
  });

  it('settings have no default tone, model, reasoning or prompt cache; the UI cannot set one', () => {
    expect(SETTING_PATHS.filter((path) => /tone$|model|reasoning|effort|cache|prompt|provider|temperature/i.test(path) && !path.startsWith('sound.'))).toEqual([]);
    expect(PREFERENCE_KEYS.filter((key) => /tone|model|reasoning|effort|cache|prompt/i.test(key) && !key.startsWith('sound.'))).toEqual([]);
  });

  it('an AI request cannot pick a model, an effort or a prompt, nor carry a transcript or usage: the contract and the hub refuse it', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    const base = { feature: 'fast-reply' as const, body: streamBody({ clientRequestId: uuid(0xb00) }), capabilities: [] };
    expect(HubStreamRequestSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ model: 'm' }, { reasoningEffort: 'max' }, { effort: 'high' }, { systemPrompt: 'p' }, { promptCache: '1h' }, { transcript: [] }, { messages: [] }, { usage: {} }]) {
      const request = { ...base, body: { ...base.body, ...extra } };
      expect(HubStreamRequestSchema.safeParse(request).success, Object.keys(extra)[0]).toBe(false);
      expect((await hubCall(hub.fetch, hub.origin, 'aiFeatureStream', request, { token })).status, Object.keys(extra)[0]).toBe(400);
    }
    // The raw gateway and the full personas are the hub's, not ours.
    expect(await journaled('POST', '/api/v1/ai/gateway/stream')).toEqual({ status: 403, kind: 'forbidden', violation: true });
    expect(await journaled('GET', '/api/v1/ai/personas')).toEqual({ status: 403, kind: 'forbidden', violation: true });
  });

  it('no shipped source calls the raw gateway or the full persona routes', () => {
    expect(findInClientSources(/\/ai\/gateway|\/ai\/personas\b|streamAiGateway|aiPersona(?:sList|Upsert|Archive)/, REGISTRIES)).toEqual([]);
  });
});
