import { LogRecordSchema, type LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import { CAPTURE_LIMITS, createLogger, describeErrorEvent, describeRejection, installErrorCapture, logRpcFailure, type ErrorEventTargetLike } from './index';

const OWN = 'moz-extension://11111111-2222-4333-8444-555555555555';
const SITE = 'https://chat.example.test';

function target() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const port: ErrorEventTargetLike = {
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  };
  const fire = (type: 'error' | 'unhandledrejection', event: unknown): void => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return { port, fire, count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}

function logger() {
  const sunk: LogRecord[] = [];
  let now = 0;
  const log = createLogger({ now: () => now, debugEnabled: () => false, sinks: [(r) => sunk.push(r)] });
  return { log, sunk, advance: (ms: number) => (now += ms) };
}

describe('[ER-021] errors of our pages and tabs go to the log', () => {
  it('[ER-021] an uncaught error from our script is logged with its file and stack', () => {
    const t = target();
    const l = logger();
    installErrorCapture(t.port, l.log, { ownOrigin: OWN, everythingIsOurs: false }, () => 0);
    const error = new TypeError('cannot read x');
    error.stack = `TypeError: cannot read x\n    at render (${OWN}/chunks/dock.js:10:5)`;
    t.fire('error', { message: error.message, filename: `${OWN}/chunks/dock.js?v=1`, lineno: 10, colno: 5, error });
    expect(l.sunk).toHaveLength(1);
    expect(l.sunk[0]).toMatchObject({ scope: 'runtime.error', msg: 'uncaught error', level: 'error' });
    expect(l.sunk[0]?.fields).toMatchObject({
      kind: 'error-event',
      file: `${OWN}/chunks/dock.js?[redacted]`,
      line: 10,
      column: 5,
      error: { name: 'TypeError', message: 'cannot read x' },
    });
    expect(LogRecordSchema.safeParse(l.sunk[0]).success).toBe(true);
  });

  it('[ER-021] errors of the site’s own scripts are not collected as ours', () => {
    const t = target();
    const l = logger();
    const capture = installErrorCapture(t.port, l.log, { ownOrigin: OWN, everythingIsOurs: false }, () => 0);
    t.fire('error', { message: 'Script error.', filename: `${SITE}/assets/index.js`, error: new Error('site') });
    t.fire('error', { message: 'Script error.', filename: '' });
    t.fire('unhandledrejection', { reason: new Error('site promise') });
    t.fire('unhandledrejection', { reason: 'a string' });
    expect(l.sunk).toHaveLength(0);
    expect(capture.stats()).toEqual({ logged: 0, suppressed: 0, foreign: 4 });
  });

  it('[ER-021] an unhandled rejection with our stack is logged; a flood is cut and counted', () => {
    const t = target();
    const l = logger();
    let now = 0;
    const capture = installErrorCapture(t.port, l.log, { ownOrigin: OWN, everythingIsOurs: false }, () => now);
    const reason = new Error('same');
    reason.stack = `Error: same\n    at x (${OWN}/a.js:1:1)`;
    for (let i = 0; i < 10; i += 1) t.fire('unhandledrejection', { reason });
    expect(l.sunk).toHaveLength(CAPTURE_LIMITS.perFingerprintPerMinute);
    for (let i = 0; i < 40; i += 1) {
      const other = new Error(`distinct ${i}`);
      other.stack = `Error\n at y (${OWN}/b.js:1:1)`;
      t.fire('unhandledrejection', { reason: other });
    }
    expect(l.sunk).toHaveLength(CAPTURE_LIMITS.perMinute);
    expect(capture.stats().suppressed).toBe(50 - CAPTURE_LIMITS.perMinute);
    now = 61_000;
    t.fire('unhandledrejection', { reason });
    expect(l.sunk).toHaveLength(CAPTURE_LIMITS.perMinute + 1);
    capture.uninstall();
    expect(t.count()).toBe(0);
  });

  it('[ER-021] describes events defensively', () => {
    const scope = { ownOrigin: OWN, everythingIsOurs: true };
    expect(describeErrorEvent({}, scope)).toMatchObject({ own: true, fields: { kind: 'error-event', file: '', line: null, column: null, error: { name: 'Error', message: '' } } });
    expect(describeRejection({ reason: undefined }, scope)).toMatchObject({ own: true, fields: { error: { name: 'NonError' } } });
    const t = target();
    const l = logger();
    installErrorCapture(t.port, l.log, scope, () => 0);
    t.fire('error', null);
    t.fire('unhandledrejection', null);
    expect(l.sunk).toHaveLength(2);
    const broken: ErrorEventTargetLike = {
      addEventListener: () => {
        throw new Error('no events');
      },
      removeEventListener: () => {
        throw new Error('no events');
      },
    };
    expect(() => installErrorCapture(broken, l.log, scope, () => 0).uninstall()).not.toThrow();
  });
});

describe('[ER-023] the background’s own uncaught errors', () => {
  it('[ER-023] everything in the background is ours, file or not', () => {
    const t = target();
    const l = logger();
    installErrorCapture(t.port, l.log, { ownOrigin: OWN, everythingIsOurs: true }, () => 0);
    t.fire('unhandledrejection', { reason: { name: 'HubCallError', route: 'ingest', epoch: 2, failure: { kind: 'transport', failure: 'network' } } });
    expect(l.sunk[0]).toMatchObject({ msg: 'unhandled rejection', fields: { error: { name: 'HubCallError', route: 'ingest', failure: { kind: 'transport', failure: 'network' } } } });
  });
});

describe('[ER-022] every failed background call is logged', () => {
  it('[ER-022] by request type and code, with the error facts', () => {
    const l = logger();
    logRpcFailure(l.log, { type: 'op.start', code: 'CG-RUNTIME-UNREACHABLE', ms: 2000, error: new Error('Could not establish connection') });
    logRpcFailure(l.log, { type: 'settings.get' });
    expect(l.sunk[0]).toMatchObject({ scope: 'runtime.rpc', code: 'CG-RUNTIME-UNREACHABLE', fields: { type: 'op.start', ms: 2000, error: { message: 'Could not establish connection' } } });
    expect(l.sunk[1]?.fields).toEqual({ type: 'settings.get' });
    expect(l.log.counters.sessionCounts()).toEqual([{ code: 'CG-RUNTIME-UNREACHABLE', count: 1 }]);
  });
});
