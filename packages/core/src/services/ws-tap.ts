// The WS tap switch (architecture.md §6.8 п. 10; NEW-08): the MAIN-world tap
// script is registered with `scripting` only while the bootstrap flag
// `wsTap` is on, and unregistered when it goes off. Calls are serialized and
// the latest wish wins: a burst of bootstrap updates ends in one registration
// state that matches the last flag value. A failed sync leaves the tap
// reported off (freshness then says «unknown», never «nothing new»).

import { isFlagOn, type Bootstrap } from '@cg/contracts/hub';

import { NO_LOG, type LogSink } from './ports';

export interface ScriptRegistrar {
  /** Registers (true) or unregisters (false) the tap script; idempotent. */
  sync(enabled: boolean): Promise<void>;
}

export class WsTapSwitch {
  private applied: boolean | null = null;
  private wanted: boolean | null = null;
  private running: Promise<boolean> | null = null;
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(
    private readonly registrar: ScriptRegistrar,
    private readonly log: LogSink = NO_LOG,
  ) {}

  /** The flag as the bootstrap says; no bootstrap — off. */
  static wanted(bootstrap: Bootstrap | null): boolean {
    return bootstrap !== null && isFlagOn(bootstrap.flags, 'wsTap');
  }

  /** Asks for a state; resolves with the state actually registered once the queue drained. */
  apply(enabled: boolean): Promise<boolean> {
    this.wanted = enabled;
    this.running ??= this.drain();
    return this.running;
  }

  fromBootstrap(bootstrap: Bootstrap | null): Promise<boolean> {
    return this.apply(WsTapSwitch.wanted(bootstrap));
  }

  /** Registered now (null — never synced yet). */
  get state(): boolean | null {
    return this.applied;
  }

  onChange(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * One queue at a time. It is released in the very step that finds nothing left to do — with no await
   * between that check and the release — so a wish cannot land between the two and be left behind: it is
   * either seen by the loop or starts a queue of its own.
   */
  private async drain(): Promise<boolean> {
    // Yield first: `apply` stores this promise in `running` before the loop below can release it
    // (a wish that is already applied runs the loop without a single await).
    await Promise.resolve();
    try {
      while (this.wanted !== null && this.wanted !== this.applied) {
        const target = this.wanted;
        try {
          await this.registrar.sync(target);
          this.set(target);
        } catch {
          this.log.write({ level: 'warn', scope: 'bg.ws-tap', msg: 'tap sync failed', fields: { wanted: target } });
          this.set(false);
          // The same wish again would fail the same way: it waits for the next one.
          if (this.wanted === target) break;
        }
      }
    } finally {
      this.running = null;
    }
    return this.applied ?? false;
  }

  private set(on: boolean): void {
    if (this.applied === on) return;
    this.applied = on;
    for (const listener of this.listeners) listener(on);
  }
}
