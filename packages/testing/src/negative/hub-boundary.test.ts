// Negative checks at the hub boundary (R02; docs/parity, PARITY_EXCEPTIONS):
// no paid OFAPI route, no harvest of chats to the hub, and no AI request that
// picks a model or a prompt or carries a transcript. The contracts the client
// is built on do not carry them, and the fake hub refuses them.

import { CG_CODES, DEFAULT_SETTINGS, HUB_ROUTE_KEYS, HubStreamRequestSchema } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { HUB_ROUTE_PATHS, streamBody, uuid } from '../scenarios/hub';
import { createFakeHub } from '../fake-hub/hub';
import { hubCall } from '../fake-hub/kit';
import { findInClientSources } from './sources';

/** The files that name the forbidden things to forbid them. */
const REGISTRIES = ['packages/contracts/src/parity/exceptions.ts', 'packages/contracts/src/hub/routes.ts'];

const settingPaths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => [`${prefix}${key}`, ...settingPaths(inner, `${prefix}${key}.`)]) : [];
const SETTING_PATHS = settingPaths(DEFAULT_SETTINGS);

/** The journal's verdict on one call with a narrow token. */
async function journaled(method: string, path: string): Promise<{ status: number; kind: string; violation: boolean }> {
  const hub = createFakeHub();
  const token = hub.issueToken();
  const response = await hub.fetch(`${hub.origin}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const entry = hub.read().entries.at(-1);
  return { status: response.status, kind: entry?.kind ?? 'none', violation: hub.violations().length === 1 };
}

describe('[SP-025] [SP-057] [NF-040] [SN-024] [PU-019] [ST-103] [ST-105] [ER-019] [ER-079] [DB-023] [TL-016] [TL-017] [RB-026] NEG-OFAPI', () => {
  it('the client’s hub routes reach no OFAPI path; no CG-OFAPI code; no credits or paid refresh in settings', () => {
    expect(Object.values(HUB_ROUTE_PATHS).filter((path) => /ofapi/i.test(path))).toEqual([]);
    expect(HUB_ROUTE_KEYS.filter((key) => /ofapi/i.test(key))).toEqual([]);
    expect(CG_CODES.filter((code) => code.startsWith('CG-OFAPI'))).toEqual([]);
    expect(SETTING_PATHS.filter((path) => /ofapi|credit|paid|refresh/i.test(path))).toEqual([]);
  });
});

describe('[TL-015] NEG-LOCAL-HARVEST', () => {
  it('the hub routes carry no harvest route, no shipped source names one, and the fake hub refuses it', async () => {
    expect([...HUB_ROUTE_KEYS, ...Object.values(HUB_ROUTE_PATHS)].filter((item) => /harvest/i.test(item))).toEqual([]);
    expect(findInClientSources(/harvest/i, REGISTRIES)).toEqual([]);
    expect(await journaled('POST', '/api/v1/ingest/harvest')).toEqual({ status: 403, kind: 'forbidden', violation: true });
  });
});

describe('[AI-098] [ST-098] [ST-099] [ST-100] [TL-014] [RU-003] NEG-HUB-OWNS-AI', () => {
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
});
