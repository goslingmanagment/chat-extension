// Loads and starts the sites' background chunks (docs/project-unite/
// architecture.md §3.3; spike.md п. 1). A chunk `bg/<site>.js` is an ES
// module of its own Vite build (apps/extension/bg/vite.config.ts), loaded
// from the classic event page with `import(runtime.getURL(…))` — Firefox
// takes it there, and WXT leaves the call as it is.
//
// - When: the site's tab registers, a request of the site's own types comes,
//   or — at the background's start — the site has unfinished work stored (its
//   spec names the keys: an X8 journal, a fuse, greeting leases). A profile
//   that has none of these never loads the chunk.
// - Once per realm: concurrent callers share one load and one start; a
//   started module is kept until the event page goes.
// - A failure — the file, its evaluation, the module's shape or its `start` —
//   is the site's state `failed`, logged with its stage; the core goes on, and
//   a request of the site answers CG-RUNTIME-UNREACHABLE (nothing is sent).
//   The next try comes with the next trigger, not before RETRY_AFTER_MS and
//   at most MAX_ATTEMPTS times in one realm, each at a new address
//   (`?attempt=N`): Firefox keeps a module whose evaluation threw under its
//   address, and the same address would answer the same error without running
//   the file again. The next start of the event page is a new realm and tries
//   afresh.
// - Events reach a module that runs or is starting (after its start); a module
//   that never started has nothing to hear — it reads the current state when it
//   starts.

import type { HostKind } from '@cg/contracts/hosts';
import type { LogSink } from '@cg/core/services';

import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit, HostAnswer, HostModuleEvent, HostModuleFacts, VerifiedTabMessage } from './host-module';

export type HostModuleState = 'idle' | 'starting' | 'started' | 'failed';

/** After a failed start, the next try waits at least this long (a tab's requests do not hammer a broken chunk). */
export const RETRY_AFTER_MS = 10_000;
/** Tries in one realm of the event page; the next start of the page tries again. */
export const MAX_ATTEMPTS = 5;

export interface HostModuleSpec {
  /** The chunk inside the extension (`bg/<site>.js`; the host registry's `background.file`). */
  readonly chunk: string;
  /** Storage keys whose presence means unfinished work of the site: its module starts with the background. */
  readonly pending: { readonly local: readonly string[]; readonly session: readonly string[] };
}

export interface HostModulesDeps {
  readonly specs: Readonly<Partial<Record<HostKind, HostModuleSpec>>>;
  /** The kit a site's module is started with: the core's ports, its telemetry counted for that site (R20 F7). */
  readonly kit: (host: HostKind) => BackgroundKit;
  /** `runtime.getURL`. */
  readonly url: (path: string) => string;
  /** `import(url)`; a test hands in the module itself. */
  readonly load: (url: string) => Promise<unknown>;
  readonly now: () => number;
  readonly log: LogSink;
}

export interface HostModules {
  /** The running module of a site, starting it first; null — it is not there (`failed`, or no chunk for the site). */
  ensure(host: HostKind): Promise<BackgroundHostHandle | null>;
  /** A request routed to its site's module; a module that does not start answers CG-RUNTIME-UNREACHABLE. */
  request(host: HostKind, message: VerifiedTabMessage): Promise<HostAnswer>;
  /** Tells every module that runs or is starting (or only the site's own), and waits; rejects if one failed to take it. */
  notify(event: HostModuleEvent, only?: HostKind): Promise<void>;
  /** The background's start: every site with unfinished work stored starts now. */
  resume(pending: (spec: HostModuleSpec) => Promise<boolean>): Promise<void>;
  /** Waits (at most `ms`) for the modules that are starting. */
  settled(ms: number): Promise<void>;
  /** Each site with a chunk, and where its module stands. */
  states(): ReadonlyArray<{ readonly host: HostKind; readonly state: HostModuleState }>;
  /** What the running modules add to the diagnostics. */
  facts(): HostModuleFacts;
}

interface Slot {
  readonly host: HostKind;
  readonly spec: HostModuleSpec;
  state: HostModuleState;
  attempts: number;
  failedAt: number;
  handle: BackgroundHostHandle | null;
  starting: Promise<BackgroundHostHandle | null> | null;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

function isHostModule(value: unknown, host: HostKind): value is BackgroundHostModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BackgroundHostModule>;
  return candidate.host === host && typeof candidate.start === 'function';
}

export function createHostModules(deps: HostModulesDeps): HostModules {
  const slots = new Map<HostKind, Slot>();
  for (const [host, spec] of Object.entries(deps.specs) as Array<[HostKind, HostModuleSpec | undefined]>) {
    if (spec !== undefined) slots.set(host, { host, spec, state: 'idle', attempts: 0, failedAt: 0, handle: null, starting: null });
  }

  async function start(slot: Slot): Promise<BackgroundHostHandle | null> {
    slot.attempts += 1;
    const attempt = slot.attempts;
    const base = deps.url(slot.spec.chunk);
    const address = attempt === 1 ? base : `${base}?attempt=${attempt}`;
    const began = deps.now();
    let stage: 'import' | 'shape' | 'start' = 'import';
    try {
      const loaded = (await deps.load(address)) as { readonly default?: unknown } | null;
      stage = 'shape';
      const exported = loaded?.default;
      if (!isHostModule(exported, slot.host)) throw new TypeError(`${slot.spec.chunk} is not the background module of ${slot.host}`);
      stage = 'start';
      const handle = await exported.start(deps.kit(slot.host));
      slot.handle = handle;
      slot.state = 'started';
      deps.log.write({ level: 'info', scope: 'bg.hosts', msg: 'site module started', fields: { host: slot.host, attempt, ms: deps.now() - began } });
      return handle;
    } catch (error) {
      slot.state = 'failed';
      slot.failedAt = deps.now();
      deps.log.write({ level: 'error', scope: 'bg.hosts', msg: 'site module did not start', fields: { host: slot.host, attempt, stage, error: errorName(error) } });
      return null;
    } finally {
      slot.starting = null;
    }
  }

  function ensure(host: HostKind): Promise<BackgroundHostHandle | null> {
    const slot = slots.get(host);
    if (slot === undefined) return Promise.resolve(null);
    if (slot.state === 'started') return Promise.resolve(slot.handle);
    if (slot.starting !== null) return slot.starting;
    if (slot.state === 'failed' && (slot.attempts >= MAX_ATTEMPTS || deps.now() - slot.failedAt < RETRY_AFTER_MS)) return Promise.resolve(null);
    slot.state = 'starting';
    slot.starting = start(slot);
    return slot.starting;
  }

  return {
    ensure,

    async request(host, message) {
      const handle = await ensure(host);
      if (handle === null) return { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: `${host} services` } };
      return handle.onTabMessage(message);
    },

    async notify(event, only) {
      const running = [...slots.values()]
        .filter((slot) => only === undefined || slot.host === only)
        .flatMap((slot) => (slot.state === 'started' && slot.handle !== null ? [Promise.resolve(slot.handle)] : slot.starting === null ? [] : [slot.starting]));
      const told = await Promise.allSettled(
        running.map(async (pending) => {
          const handle = await pending;
          await handle?.onEvent(event);
        }),
      );
      const failed = told.filter((outcome) => outcome.status === 'rejected').length;
      if (failed === 0) return;
      deps.log.write({ level: 'warn', scope: 'bg.hosts', msg: 'site module did not take an event', fields: { kind: event.kind, failed } });
      throw new Error(`${failed} site module(s) did not take ${event.kind}`);
    },

    async resume(pending) {
      await Promise.all(
        [...slots.values()].map(async (slot) => {
          if (slot.state === 'idle' && (await pending(slot.spec))) await ensure(slot.host);
        }),
      );
    },

    async settled(ms) {
      const starting = [...slots.values()].flatMap((slot) => (slot.starting === null ? [] : [slot.starting]));
      if (starting.length === 0) return;
      await Promise.race([Promise.allSettled(starting), new Promise<void>((done) => setTimeout(done, ms))]);
    },

    states: () => [...slots.values()].map((slot) => ({ host: slot.host, state: slot.state })),

    facts() {
      let sends: HostModuleFacts['sends'];
      let sendFuse: HostModuleFacts['sendFuse'];
      for (const slot of slots.values()) {
        if (slot.state !== 'started' || slot.handle === null) continue;
        const own = slot.handle.facts();
        if (own.sends !== undefined) {
          sends = sends === undefined ? own.sends : { open: sends.open + own.sends.open, uncertain: sends.uncertain + own.sends.uncertain, journal: [...sends.journal, ...own.sends.journal] };
        }
        sendFuse ??= own.sendFuse;
      }
      return { ...(sends === undefined ? {} : { sends }), ...(sendFuse === undefined ? {} : { sendFuse }) };
    },
  };
}
