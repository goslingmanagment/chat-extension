// Port adapters of the background composition root (architecture.md §4:
// only dependency wiring here). The wave-1 packages speak three dialects of
// the same ports — R07 (storage results, `Timers`, `ServiceLog`), R10
// (`Clock` with timers, a throwing key-value store — background/ops-store.ts
// and background/send-journal-store.ts —, `LogSink`) and R18
// (`Scheduler`, one key as a port, `Logger`) — over the same platform
// storage, the same timers and the one logger. Nothing here decides anything.

import { isCgCode } from '@cg/contracts/errors';
import { type LogOptions, type Logger } from '@cg/core/domain/logging';
import { type Clock, type IdSource, type KeyValueStore as ThrowingStore, type LogSink, type ServiceLog, type TabEventSink, type Timers } from '@cg/core/services';
import { type KeyValuePort as KeyPort, type Scheduler } from '@cg/core/services/logs';
import { type KeyValueStore } from '@cg/platform';

/** The event page's own timers and wall clock. */
export const TIMERS: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** R10's clock: epoch ms and one-shot timers with numeric handles. */
export const CLOCK: Clock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => setTimeout(fn, ms) as unknown as number,
  clearTimer: (handle) => clearTimeout(handle),
};

/** R18's scheduler: the same clock, a timer that returns its own cancel. */
export const SCHEDULER: Scheduler = {
  now: () => Date.now(),
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

const HEX = '0123456789abcdef';

/** Fresh ids: v4 UUIDs and action tokens (`ACTION_TOKEN_PATTERN`: 16–128 of [A-Za-z0-9_-]). */
export const IDS: IdSource = {
  uuid: () => crypto.randomUUID(),
  token() {
    let out = '';
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
    return out;
  },
};

/** A storage call that failed, as the throwing stores raise it: the code only, never a value. */
export class StorageCallError extends Error {
  override readonly name = 'StorageCallError';
  constructor(
    readonly code: string,
    readonly key: string,
  ) {
    super(`${code} ${key}`);
  }
}

/** A storage area as R10's and R17's services take it: one key at a time, a failure rejects with its code. */
export function throwingStoreOf(store: KeyValueStore): ThrowingStore {
  return {
    async get(key) {
      const read = await store.get([key]);
      if (!read.ok) throw new StorageCallError(read.code, key);
      return read.value[key];
    },
    async set(key, value) {
      const written = await store.set({ [key]: value });
      if (!written.ok) throw new StorageCallError(written.code, key);
    },
  };
}

/** One key of a storage area as R18's port: read whatever is there, write the whole value; a failure rejects. */
export function keyOf(store: KeyValueStore, key: string): KeyPort {
  return {
    async load() {
      const read = await store.get([key]);
      if (!read.ok) throw new StorageCallError(read.code, key);
      return read.value[key];
    },
    async save(value) {
      const written = await store.set({ [key]: value });
      if (!written.ok) throw new StorageCallError(written.code, key);
    },
  };
}

const options = (entry: { readonly code?: LogOptions['code']; readonly fields?: LogOptions['fields']; readonly ctx?: LogOptions['ctx'] }): LogOptions => ({
  ...(entry.code === undefined ? {} : { code: entry.code }),
  ...(entry.fields === undefined ? {} : { fields: entry.fields }),
  ...(entry.ctx === undefined ? {} : { ctx: entry.ctx }),
});

/** R07's log function over the one logger. */
export const serviceLogOf =
  (logger: Logger): ServiceLog =>
  (entry) => {
    logger.write(entry.level, entry.scope, entry.msg, options(entry));
  };

/** R10's log sink over the one logger. */
export const logSinkOf = (logger: Logger): LogSink => ({
  write(entry) {
    logger.write(entry.level, entry.scope, entry.msg, options(entry));
  },
});

/**
 * The hub layer's log (level, message, facts) over the one logger. Its
 * messages start with their area («auth: …», «hub: …»): that prefix picks the
 * scope the debug journals route by (`bg.auth`, `bg.hub`).
 */
export const hubLogOf =
  (logger: Logger) =>
  (level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void => {
    const area = /^([a-z]+): /.exec(message)?.[1];
    const scope = area === 'auth' ? 'bg.auth' : 'bg.hub';
    const code = isCgCode(fields?.['code']) ? fields['code'] : undefined;
    logger.write(level, scope, area === undefined ? message : message.slice(area.length + 2), { ...(code === undefined ? {} : { code }), ...(fields === undefined ? {} : { fields }) });
  };

/** R10's event sink over the RPC's emit: `to: null` — every tab and page the event's spec allows. */
export function eventSinkOf(emit: (type: never, payload: never, target?: { readonly tabSessionId: string }) => number): TabEventSink {
  return {
    emit(to, type, payload) {
      if (to === null) emit(type as never, payload as never);
      else emit(type as never, payload as never, { tabSessionId: to });
    },
  };
}
