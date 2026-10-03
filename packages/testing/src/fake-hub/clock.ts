// The fake hub's clock: manual (unit tests: deterministic, moved by the test)
// or the system clock (loopback e2e). Leases, tickets, token expiry, `asOf`
// and `serverNow` all read it; SSE delays use real timers either way.

export interface HubClock {
  now(): number;
}

export class FakeHubClock implements HubClock {
  private mode: 'manual' | 'system';
  private manualMs: number;

  constructor(start: number | 'system') {
    this.mode = start === 'system' ? 'system' : 'manual';
    this.manualMs = start === 'system' ? Date.now() : start;
  }

  now(): number {
    return this.mode === 'system' ? Date.now() : this.manualMs;
  }

  get manual(): boolean {
    return this.mode === 'manual';
  }

  /** Freezes the clock at `ms` (manual mode). */
  set(ms: number): void {
    this.mode = 'manual';
    this.manualMs = ms;
  }

  /** Moves a manual clock forward; switches a system clock to manual at now + ms. */
  advance(ms: number): void {
    if (ms < 0) throw new Error('the fake hub clock only moves forward');
    this.set(this.now() + ms);
  }

  useSystem(): void {
    this.mode = 'system';
  }
}

/** ISO 8601 with Z, as the hub sends instants. */
export const iso = (ms: number): string => new Date(ms).toISOString();
