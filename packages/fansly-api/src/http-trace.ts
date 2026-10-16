import type { FanslyTransport } from './transport';

type HttpEvent = 'call.wait' | 'http.start' | 'http.end' | 'http.failed';
type HttpFields = { readonly attempt?: number; readonly httpStatus?: number; readonly durationMs?: number; readonly waitMs?: number; readonly reason?: string };

/** Observe actual transport attempts, including retries, inside the API's request boundary. */
export function traceFanslyTransport(transport: FanslyTransport, trace: (event: HttpEvent, fields: HttpFields) => void): FanslyTransport {
  let attempt = 0;
  let lastResponse: number | null = null;
  return {
    async route(request) {
      const route = await transport.route(request);
      return {
        ...route,
        async send(wire) {
          const started = performance.now();
          const number = ++attempt;
          if (lastResponse !== null) trace('call.wait', { waitMs: Math.max(0, started - lastResponse), reason: 'retry-gap' });
          trace('http.start', { attempt: number });
          try {
            const response = await route.send(wire);
            lastResponse = performance.now();
            trace('http.end', { attempt: number, httpStatus: response.status, durationMs: Math.max(0, lastResponse - started) });
            return response;
          } catch (error) {
            lastResponse = performance.now();
            trace('http.failed', { attempt: number, durationMs: Math.max(0, lastResponse - started) });
            throw error;
          }
        },
      };
    },
  };
}
