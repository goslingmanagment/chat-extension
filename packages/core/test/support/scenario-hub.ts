// The shared fake hub's HTTP scenario scripts (@cg/testing/hub
// HTTP_SCENARIOS, typed here structurally) replayed as a claim facade: every
// call must be the script's next exchange — same route, same facade-level
// request — and gets that exchange's answer; an error answer rejects the way
// the real facade does (HubCallError). Anything off script is recorded and
// rejected, so a test can prove the client made exactly the scripted calls.

import { type ClaimOp, type ClaimState, type HubRouteKey } from '@cg/contracts';

import { type FakeClock } from './clock';
import { FakeHub, hubError } from './fake-hub';

/** One exchange of an HTTP scenario (HttpExchange of @cg/testing/hub, the parts replayed here). */
export interface ScriptedExchange {
  readonly route: HubRouteKey;
  readonly request: unknown;
  readonly response: { readonly status: number; readonly body: unknown; readonly retryAfterSec?: number };
  /** What the client must make of an error answer. */
  readonly expect?: { readonly cg: string | null; readonly disposition: string };
}

/** JSON with sorted keys: two requests are the same when their canonical forms are. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class ScenarioHub extends FakeHub {
  private next = 0;
  /** Calls that were not the script's next exchange. */
  readonly offScript: { readonly route: HubRouteKey; readonly request: unknown }[] = [];

  constructor(
    clock: FakeClock,
    private readonly exchanges: readonly ScriptedExchange[],
  ) {
    super(clock);
  }

  /** Exchanges of the script not played yet. */
  get remaining(): number {
    return this.exchanges.length - this.next;
  }

  /** The next exchange the script expects (to drive it from the test when the client under test does not make it). */
  peek(): ScriptedExchange | null {
    return this.exchanges[this.next] ?? null;
  }

  override claim(op: ClaimOp): Promise<ClaimState> {
    this.claims.push(op);
    return this.play('clientFanClaim', op);
  }

  override claimStatus(pageLabel: string, fanRef: string): Promise<ClaimState> {
    this.statusReads.push({ pageLabel, fanRef });
    return this.play('clientFanClaimStatus', { pageLabel, fanRef });
  }

  private play(route: HubRouteKey, request: unknown): Promise<ClaimState> {
    const exchange = this.exchanges[this.next];
    if (exchange === undefined || exchange.route !== route || canonical(exchange.request) !== canonical(request)) {
      this.offScript.push({ route, request });
      return Promise.reject(new Error(`off script: ${route}`));
    }
    this.next += 1;
    const { status, body, retryAfterSec } = exchange.response;
    if (status >= 200 && status <= 299) return Promise.resolve(structuredClone(body) as ClaimState);
    const error = body as { readonly error?: string; readonly reason?: string };
    return Promise.reject(
      hubError(route, { kind: 'http', status, error: error.error ?? null, reason: error.reason ?? null, retryAfterMs: retryAfterSec === undefined ? null : retryAfterSec * 1000 }, this.epoch),
    );
  }
}
