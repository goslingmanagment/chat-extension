// Errors caught at the edges of a context (architecture.md §9.2 «Ошибки»;
// ER-021 page and tab `onerror`/`unhandledrejection`, ER-022 every failed
// background call, ER-023 the background's own uncaught errors). Pure
// helpers over structural event shapes: core has no DOM, the composition
// root hands its `window`/`self` in.
//
// Errors of the site's own scripts are not collected as ours: in a tab, an
// error counts only when its file or stack points at our extension origin.
// Extension pages and the background run nothing but our code.
// A flood is cut: at most CAPTURE_LIMITS per minute, the rest only counted.

import { type CgCode } from '@cg/contracts/errors';
import { type LogRecord } from '@cg/contracts/logs';

import { logEvent } from './events';
import { type Logger } from './logger';
import { serializeError } from './redact';

export interface ErrorEventLike {
  readonly message?: unknown;
  readonly filename?: unknown;
  readonly lineno?: unknown;
  readonly colno?: unknown;
  readonly error?: unknown;
}

export interface RejectionEventLike {
  readonly reason?: unknown;
}

type Listener = (event: unknown) => void;

/** `window`, `self` or `globalThis` of the context, as far as capture needs it. */
export interface ErrorEventTargetLike {
  addEventListener(type: 'error' | 'unhandledrejection', listener: Listener): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: Listener): void;
}

export interface CaptureScope {
  /** `moz-extension://<uuid>` of this extension. */
  readonly ownOrigin: string;
  /** Extension pages and the background: every error is ours. A tab: only those pointing at ownOrigin. */
  readonly everythingIsOurs: boolean;
}

export interface CapturedError {
  readonly own: boolean;
  readonly fields: Record<string, unknown>;
}

export const CAPTURE_LIMITS = { perMinute: 30, perFingerprintPerMinute: 5 } as const;

function stackText(value: unknown): string {
  if (value === null || typeof value !== 'object') return '';
  try {
    const stack = (value as { stack?: unknown }).stack;
    return typeof stack === 'string' ? stack : '';
  } catch {
    return '';
  }
}

function pointsAt(text: string, ownOrigin: string): boolean {
  return ownOrigin.length > 0 && text.includes(ownOrigin);
}

/** ER-021: an `error` event of a window or worker. */
export function describeErrorEvent(event: ErrorEventLike, scope: CaptureScope): CapturedError {
  const file = typeof event.filename === 'string' ? event.filename : '';
  const error = event.error !== undefined && event.error !== null ? event.error : { name: 'Error', message: typeof event.message === 'string' ? event.message : '' };
  const own = scope.everythingIsOurs || pointsAt(file, scope.ownOrigin) || pointsAt(stackText(event.error), scope.ownOrigin);
  return {
    own,
    fields: {
      kind: 'error-event',
      file,
      line: typeof event.lineno === 'number' ? event.lineno : null,
      column: typeof event.colno === 'number' ? event.colno : null,
      error: serializeError(error),
    },
  };
}

/** ER-021/ER-023: an `unhandledrejection` event. */
export function describeRejection(event: RejectionEventLike, scope: CaptureScope): CapturedError {
  const own = scope.everythingIsOurs || pointsAt(stackText(event.reason), scope.ownOrigin);
  return { own, fields: { kind: 'unhandled-rejection', error: serializeError(event.reason) } };
}

function fingerprint(fields: Record<string, unknown>): string {
  const error = fields['error'];
  if (error === null || typeof error !== 'object') return String(fields['kind']);
  const record = error as Record<string, unknown>;
  return `${String(fields['kind'])}|${String(record['name'])}|${String(record['message']).slice(0, 200)}`;
}

export interface ErrorCapture {
  /** Removes the listeners. */
  readonly uninstall: () => void;
  readonly stats: () => { readonly logged: number; readonly suppressed: number; readonly foreign: number };
}

/**
 * Listens for uncaught errors and unhandled rejections on `target` and
 * writes them to the context's logger (which forwards them to the
 * background). Never throws, including from inside the listeners.
 */
export function installErrorCapture(target: ErrorEventTargetLike, logger: Logger, scope: CaptureScope, now: () => number): ErrorCapture {
  let windowStart = 0;
  let inWindow = 0;
  const perPrint = new Map<string, number>();
  let logged = 0;
  let suppressed = 0;
  let foreign = 0;

  const admit = (print: string): boolean => {
    const at = now();
    if (at - windowStart >= 60_000) {
      windowStart = at;
      inWindow = 0;
      perPrint.clear();
    }
    const seen = perPrint.get(print) ?? 0;
    if (inWindow >= CAPTURE_LIMITS.perMinute || seen >= CAPTURE_LIMITS.perFingerprintPerMinute) return false;
    inWindow += 1;
    perPrint.set(print, seen + 1);
    return true;
  };

  const handle = (captured: CapturedError, event: 'uncaughtError' | 'unhandledRejection'): void => {
    if (!captured.own) {
      foreign += 1;
      return;
    }
    if (!admit(fingerprint(captured.fields))) {
      suppressed += 1;
      return;
    }
    logged += 1;
    logEvent(logger, event, { fields: captured.fields });
  };

  const onError: Listener = (event) => {
    try {
      handle(describeErrorEvent((event ?? {}), scope), 'uncaughtError');
    } catch {
      suppressed += 1;
    }
  };
  const onRejection: Listener = (event) => {
    try {
      handle(describeRejection((event ?? {}), scope), 'unhandledRejection');
    } catch {
      suppressed += 1;
    }
  };

  try {
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
  } catch {
    // A context without events: nothing to capture.
  }
  return {
    uninstall: () => {
      try {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
      } catch {
        // Already gone.
      }
    },
    stats: () => ({ logged, suppressed, foreign }),
  };
}

/** ER-022: one failed call to the background (tab or page side), by request type and code. */
export interface RpcFailure {
  readonly type: string;
  readonly code?: CgCode;
  readonly error?: unknown;
  readonly ms?: number;
}

export function logRpcFailure(logger: Logger, failure: RpcFailure): LogRecord | null {
  return logEvent(logger, 'rpcFailed', {
    ...(failure.code === undefined ? {} : { code: failure.code }),
    fields: { type: failure.type, ...(failure.ms === undefined ? {} : { ms: failure.ms }) },
    ...(failure.error === undefined ? {} : { error: failure.error }),
  });
}
