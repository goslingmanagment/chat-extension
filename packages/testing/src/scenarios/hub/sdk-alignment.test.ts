// The contracts' hub DTOs against the vendored @kernel/sdk (test-only import;
// nothing that ships reaches the SDK outside the background): operation
// keys, methods and paths; the SDK's own schemas accept our scenario
// answers, requests and error bodies; and its response types are assignable
// to ours (a misnamed or missing field fails the build). Routes the SDK does
// not have yet must stay absent until a re-vendor brings them.

import {
  HUB_ROUTE_KEYS,
  HUB_ROUTES,
  type AutoLists,
  type Dossier,
  type HubAuthState,
  type HubHealth,
  type IngestResult,
  type PersonaCatalog,
  type RecapStatus,
  type SpenderBatch,
  type SpenderDetail,
  type SpendersPage,
} from '@cg/contracts';
import { kernelOperations, routeSchemas, type KernelOperationResponse } from '@kernel/sdk';
import { describe, expect, it } from 'vitest';

import { HTTP_SCENARIOS } from './http';
import { SSE_SCENARIOS } from './sse';
import { HUB_ROUTE_PATHS } from './types';

type Assignable<From extends To, To> = [From, To];
export type SdkResponsesFitOurDtos = [
  Assignable<KernelOperationResponse<'health'>, HubHealth>,
  Assignable<KernelOperationResponse<'me'>, HubAuthState>,
  Assignable<KernelOperationResponse<'aiPersonaCatalog'>, PersonaCatalog>,
  Assignable<KernelOperationResponse<'aiRecapStatus'>, RecapStatus>,
  Assignable<KernelOperationResponse<'pageConversationProfile'>, Dossier>,
  Assignable<KernelOperationResponse<'pageFanProfile'>, Dossier>,
  Assignable<KernelOperationResponse<'spenders'>, SpendersPage>,
  Assignable<KernelOperationResponse<'spenderDetail'>, SpenderDetail>,
  Assignable<KernelOperationResponse<'spenderBatch'>, SpenderBatch>,
  Assignable<KernelOperationResponse<'pageSpenderAutoLists'>, AutoLists>,
  Assignable<KernelOperationResponse<'ingestObservations'>, IngestResult>,
];

interface LooseSchema {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}
interface LooseRoute {
  readonly querystring?: LooseSchema;
  readonly body?: LooseSchema;
  readonly response: Readonly<Record<number, LooseSchema>>;
}
const sdkRoutes = routeSchemas as unknown as Readonly<Record<string, LooseRoute>>;
const sdkOperations = kernelOperations as unknown as Readonly<Record<string, { method: string; path: string }>>;

const existing = HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since === 'sdk');

/** Our facade request → the SDK's querystring/body for the routes whose request we mirror one to one. */
function sdkRequestOf(route: string, request: Record<string, unknown>): { part: 'querystring' | 'body'; value: unknown } | null {
  switch (route) {
    case 'authIssueDeviceTokenWithPassword':
      return { part: 'body', value: request };
    case 'aiRecapStatus':
    case 'spenders':
      return { part: 'querystring', value: request };
    case 'spenderBatch':
    case 'ingestObservations':
      return { part: 'body', value: request };
    default:
      return null;
  }
}

describe('contracts vs the vendored SDK', () => {
  it('existing operations: same key, method and path; new ones not vendored yet', () => {
    for (const key of HUB_ROUTE_KEYS) {
      const operation = sdkOperations[key];
      if (HUB_ROUTES[key].since === 'sdk') {
        expect(operation, key).toEqual({ method: HUB_ROUTES[key].method, path: HUB_ROUTE_PATHS[key] });
      } else {
        expect(operation, `${key} arrived in the SDK: set its \`since\` to 'sdk' and drop the raw call`).toBeUndefined();
      }
    }
  });

  it("the SDK accepts our scenarios' answers, requests and error bodies on existing routes", () => {
    for (const s of HTTP_SCENARIOS) {
      for (const exchange of s.exchanges) {
        if (!existing.includes(exchange.route)) continue;
        const route = sdkRoutes[exchange.route];
        if (route === undefined) throw new Error(exchange.route);
        const label = `${s.name} ${exchange.route} ${exchange.response.status}`;
        const answer = route.response[exchange.response.status];
        expect(answer, `${label}: status declared by the SDK`).toBeDefined();
        const parsed = answer?.safeParse(exchange.response.body);
        expect(parsed?.success, `${label}: ${JSON.stringify(parsed?.error ?? '').slice(0, 300)}`).toBe(true);
        const request = exchange.request === null ? null : sdkRequestOf(exchange.route, exchange.request as Record<string, unknown>);
        if (request !== null) expect(route[request.part]?.safeParse(request.value).success, `${label} request`).toBe(true);
      }
    }
  });

  it('stream bodies pass the SDK body until H-4b/H-4c fields; those need a re-vendor', () => {
    const body = sdkRoutes['aiFeatureStream']?.body;
    if (body === undefined) throw new Error('aiFeatureStream body');
    for (const s of SSE_SCENARIOS) {
      const { knownFanMessageId, liveTextContext, ...current } = s.request.body;
      expect(body.safeParse(current).success, s.name).toBe(true);
      if (knownFanMessageId !== undefined || liveTextContext !== undefined) expect(body.safeParse(s.request.body).success, `${s.name}: H-4 fields`).toBe(false);
    }
  });
});
