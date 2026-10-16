import { describe, expect, it, vi } from 'vitest';

import { traceFanslyTransport } from './http-trace';
import type { FanslyRoute, FanslyTransport, FanslyWireRequest } from './transport';

describe('pass HTTP diagnostics at the existing request boundary', () => {
  it.each(['direct', 'tab:one'] as const)('keeps %s, its final check and synchronous dispatch, and observes retries and failures', async (label) => {
    const response = new Response('{}', { status: 503 });
    const error = new TypeError('offline');
    const send = vi.fn<FanslyRoute['send']>().mockResolvedValueOnce(response).mockRejectedValueOnce(error);
    const holds = () => true;
    const transport: FanslyTransport = { route: () => Promise.resolve({ transport: label, holds, send }) };
    const events: string[] = [];
    const traced = traceFanslyTransport(transport, (event) => events.push(event));
    const request: FanslyWireRequest = { url: 'https://example.invalid/api/', path: '', method: 'GET', headers: {}, signal: new AbortController().signal };
    const route = await traced.route({ legacyId: '1', canonicalId: null });
    expect(route.transport).toBe(label);
    expect(route.holds).toBe(holds);
    const first = route.send(request);
    expect(send).toHaveBeenCalledExactlyOnceWith(request);
    await expect(first).resolves.toBe(response);
    await expect(route.send(request)).rejects.toBe(error);
    expect(events).toEqual(['http.start', 'http.end', 'call.wait', 'http.start', 'http.failed']);
  });
});
