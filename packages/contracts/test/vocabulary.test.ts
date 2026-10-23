// The send and secret vocabularies: bridge writes that may have run, log redaction, the X8 attempt machine and its
// «Отправить» row, the hub custody machine, the retry rule of the CG registry, and what a page session may carry.

import { describe, expect, it } from 'vitest';

import { NetworkSessionSnapshotSchema } from '../src/diagnostics';
import * as C from '../src/index';
import { networkSession } from './fixtures/diagnostics';

describe('bridge writes that may have run', () => {
  it('fix an outcome each receipt schema accepts, and only for the four writes', () => {
    expect(Object.keys(C.BRIDGE_WRITE_FAILURES).sort()).toEqual([...C.BRIDGE_WRITE_REQUESTS].sort());
    expect(C.InsertReceiptSchema.safeParse(C.BRIDGE_WRITE_FAILURES.insertGuarded).success).toBe(true);
    expect(C.NavigationReceiptSchema.safeParse(C.BRIDGE_WRITE_FAILURES.navigate).success).toBe(true);
    expect(C.PreviewSendCommitSchema.safeParse(C.BRIDGE_WRITE_FAILURES.previewSendCommit).success).toBe(true);
    expect(C.AttachAnswerSchema.safeParse(C.BRIDGE_WRITE_FAILURES.attachFile).success).toBe(true);
    expect(C.BRIDGE_ERRORS_BEFORE_EXECUTION).not.toContain('internal');
  });
});

describe('logs and page sessions', () => {
  it('redact secrets by name and suffix, not ids or counts (LG-003)', () => {
    for (const key of ['token', 'leaseToken', 'actionToken', 'promptToken', 'ticket', 'dispatchTicket', 'Authorization', 'set-cookie', 'refresh_token', 'password', 'apiKey', 'session'])
      expect(C.isRedactedLogField(key), key).toBe(true);
    for (const key of ['tabSessionId', 'inputTokens', 'tokenCount', 'attemptId', 'textLength', 'chatKey']) expect(C.isRedactedLogField(key), key).toBe(false);
  });

  it('[LG-026] session values, tokens and cookies are not page fields', () => {
    expect(NetworkSessionSnapshotSchema.safeParse(networkSession).success).toBe(true);
    for (const key of ['headers', 'token', 'cookie', 'authorization']) expect(NetworkSessionSnapshotSchema.safeParse({ ...networkSession, [key]: 'secret' }).success).toBe(false);
    expect(NetworkSessionSnapshotSchema.safeParse({ ...networkSession, headerNames: ['Authorization: secret'] }).success).toBe(false);
  });
});

describe('X8 attempt machine (§6.7.7)', () => {
  const T = C.SEND_ATTEMPT_TRANSITIONS as Record<C.SendAttemptState, readonly C.SendAttemptState[]>;

  it('covers every state and starts from ready only', () => {
    expect(Object.keys(T).sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
    for (const targets of Object.values(T)) expect(targets).not.toContain('ready');
  });

  it('uncertain is never retried: it only resolves to sentObserved by a late linked pair', () => {
    expect(T.uncertain).toEqual(['sentObserved']);
    expect(T.sentObserved).toEqual([]);
    expect(T.rejected).toEqual([]);
  });

  it('nothing after a possible queue call goes back before it', () => {
    const before: C.SendAttemptState[] = ['ready', 'preparing', 'held', 'notEnqueued'];
    for (const state of ['nativeEnqueued', 'nativeAccepted', 'uncertain'] as const) {
      for (const next of T[state]) expect(before).not.toContain(next);
    }
  });

  it('a new attempt is allowed only after an end that proves nothing was queued', () => {
    for (const state of C.SEND_ATTEMPT_RETRYABLE_ENDS) expect(T[state]).toEqual([]);
    for (const state of C.SEND_ATTEMPT_CUSTODY_STATES) expect(C.SEND_ATTEMPT_RETRYABLE_ENDS as readonly string[]).not.toContain(state);
    expect(C.SEND_ATTEMPT_CUSTODY_STATES).toContain('uncertain');
  });

  it('another click lifts a hold only when the code allows it (§6.7.5, §6.7.8)', () => {
    expect(C.isRetryableEnd('notEnqueued', 'CG-SEND-QUEUE')).toBe(true);
    expect(C.isRetryableEnd('held', 'CG-SEND-BUSY')).toBe(true);
    expect(C.isRetryableEnd('held', 'CG-NETWORK')).toBe(true);
    expect(C.isRetryableEnd('held', 'CG-SEND-UNCERTAIN')).toBe(true);
    for (const code of C.SEND_HOLD_CODES_WITHOUT_RETRY) expect(C.isRetryableEnd('held', code), code).toBe(false);
    for (const state of ['rejected', 'uncertain', 'sentObserved', 'nativeAccepted'] as const) expect(C.isRetryableEnd(state, undefined)).toBe(false);
  });

  it('custody reports: proof only, never for an unknown outcome (H-7)', () => {
    expect(Object.keys(C.SEND_CUSTODY_REPORTS).sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
    expect(C.SEND_CUSTODY_REPORTS.uncertain).toBeNull();
    expect(C.SEND_CUSTODY_REPORTS.nativeAccepted).toBeNull();
    expect(C.SEND_CUSTODY_REPORTS.sentObserved).toBe('sent');
    for (const state of C.SEND_ATTEMPT_RETRYABLE_ENDS) expect(C.SEND_CUSTODY_REPORTS[state]).toBe('failed-not-enqueued');
    expect(C.isNativeRefusalStatus(401)).toBe(false);
    expect(C.isNativeRefusalStatus(422)).toBe(true);
    expect(C.isNativeRefusalStatus(500)).toBe(false);
  });

  it('the served-context check lifts a hold only when every known id is included (§6.7.5)', () => {
    const ids = ['4004', '4006'];
    expect(C.servedContextCovers([], undefined)).toBe(true);
    expect(C.servedContextCovers(ids, undefined)).toBe(false);
    expect(C.servedContextCovers(ids, [{ id: '4006', state: 'included' }])).toBe(false);
    expect(C.servedContextCovers(ids, [{ id: '4006', state: 'included' }, { id: '4004', state: 'absent' }])).toBe(false);
    expect(C.servedContextCovers(ids, [{ id: '4006', state: 'included' }, { id: '4004', state: null }])).toBe(false);
    expect(C.servedContextCovers(ids, [{ id: '4004', state: 'included' }, { id: '4006', state: 'included' }])).toBe(true);
  });

  it('a server deadline moves onto the local clock by the server\'s remaining time', () => {
    const received = 1_000_000;
    // The client clock is 5 minutes off; the ticket still has 10 s on the server.
    expect(C.localDeadline('2026-10-03T10:00:10.000Z', '2026-10-03T10:00:00.000Z', received)).toBe(received + 10_000 - C.SERVER_DEADLINE_MARGIN_MS);
    expect(C.localDeadline('soon', '2026-10-03T10:00:00.000Z', received)).toBeNull();
  });

  it('the lock key is (hubOrigin, pageId, platform, fanRef)', () => {
    expect(C.sendLockKey({ hubOrigin: 'https://hub.example.test', pageId: 11, platform: 'onlyfans', fanRef: '2002' })).toBe('https://hub.example.test|11|onlyfans|2002');
  });
});

describe('«Отправить» row (previewSendStateOf)', () => {
  const ok: C.PreviewSendPreflight = { ok: true };
  const attempt = (state: C.SendAttemptState, code?: C.CgCode): C.SendAttemptView => ({ attemptId: '00000000-0000-4000-8000-000000000005', state, ...(code ? { code } : {}) });

  // «Отправить всем» of «Новые» (`SendBatch`) is the owner's one exception (2026-10-27): still a click, never a timer or a key.
  it('has no auto-send or hotkey-send action', () => {
    for (const type of C.UI_ACTION_TYPES) expect(type).not.toMatch(/SendAll|AutoSend|SendNext/);
  });

  it('maps the attempt machine onto the row (ui-design §4.13)', () => {
    expect(C.previewSendStateOf(null, ok)).toEqual({ s: 'available' });
    expect(C.previewSendStateOf(null, { ok: false, code: 'CG-SEND-FAN' })).toEqual({ s: 'unavailable', code: 'CG-SEND-FAN' });
    expect(C.previewSendStateOf(null, { ok: false, code: 'CG-SEND-STALE' })).toEqual({ s: 'held-stale' });
    expect(C.previewSendStateOf(attempt('preparing'), ok).s).toBe('queued');
    expect(C.previewSendStateOf(attempt('nativeEnqueued'), ok).s).toBe('sending');
    expect(C.previewSendStateOf(attempt('nativeAccepted'), ok).s).toBe('accepted');
    expect(C.previewSendStateOf(attempt('sentObserved'), ok).s).toBe('sent');
    expect(C.previewSendStateOf(attempt('uncertain', 'CG-SEND-UNCERTAIN'), ok).s).toBe('uncertain');
    expect(C.previewSendStateOf(attempt('rejected', 'CG-SEND-GUARD'), ok)).toEqual({ s: 'rejected', code: 'CG-SEND-GUARD', canRetry: false });
    expect(C.previewSendStateOf(attempt('notEnqueued', 'CG-SEND-QUEUE'), ok)).toEqual({ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true });
  });

  it('a hold: stale stays held, a final code stays off, a cleared condition frees the button, a failed dispatch may be clicked again', () => {
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-STALE'), ok)).toEqual({ s: 'held-stale' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-PART'), ok)).toEqual({ s: 'unavailable', code: 'CG-SEND-PART' });
    // The hub's refusal inside another send's ticket (`custody_held`) holds nothing: wait a few seconds, click again (2026-10-23 audit).
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-UNCERTAIN'), ok)).toEqual({ s: 'rejected', code: 'CG-SEND-UNCERTAIN', canRetry: true });
    expect(C.previewSendStateOf(attempt('held', 'CG-CLAIM-BUSY'), ok)).toEqual({ s: 'unavailable', code: 'CG-CLAIM-BUSY' });
    expect(C.previewSendStateOf(attempt('held', 'CG-HUB-RATE-LIMIT'), ok)).toEqual({ s: 'unavailable', code: 'CG-HUB-RATE-LIMIT' });
    // No lease is named any more (2026-10-22): an expired one is no condition of the row, only a failed dispatch.
    expect(C.previewSendStateOf(attempt('held', 'CG-CLAIM-EXPIRED'), ok).s).toBe('rejected');
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-BUSY'), ok)).toEqual({ s: 'available' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-BUSY'), { ok: false, code: 'CG-SEND-MIMIC' })).toEqual({ s: 'unavailable', code: 'CG-SEND-MIMIC' });
    expect(C.previewSendStateOf(attempt('held', 'CG-NETWORK'), ok)).toEqual({ s: 'rejected', code: 'CG-NETWORK', canRetry: true });
    expect(C.previewSendStateOf(attempt('held', 'CG-TIMEOUT'), ok)).toEqual({ s: 'rejected', code: 'CG-TIMEOUT', canRetry: true });
  });
});

describe('hub custody and the retry rule', () => {
  it('custody never frees itself: uncertain-held ends only by proof or resolve', () => {
    expect(C.isCustodyTransition(null, 'dispatching')).toBe(true);
    expect(C.isCustodyTransition(null, 'sent')).toBe(true);
    expect(C.isCustodyTransition(null, 'uncertain-held')).toBe(false);
    expect(C.isCustodyTransition('dispatching', 'uncertain-held')).toBe(true);
    expect(C.isCustodyTransition('uncertain-held', 'failed')).toBe(false);
    expect(C.isCustodyTransition('uncertain-held', 'dispatching')).toBe(false);
    expect(C.isCustodyTransition('uncertain-held', 'sent')).toBe(true);
    for (const terminal of ['sent', 'failed', 'resolved-sent', 'resolved-not-sent'] as const) expect(C.CUSTODY_TRANSITIONS[terminal]).toEqual([]);
    for (const state of C.CUSTODY_BLOCKING_STATES) expect(C.CUSTODY_TRANSITIONS[state].length).toBeGreaterThan(0);
  });

  it('the CG registry keeps the retry rule and the recovery consistent: nothing uncertain is offered again', () => {
    for (const entry of Object.values(C.CG_REGISTRY)) {
      // A deadline is waited out, then retried by hand (ER-006).
      expect(entry.retry === 'after-deadline', entry.code).toBe(entry.recovery === 'wait-until');
      // «никогда»: no retry and no rerun is offered for an unknown or forbidden outcome.
      if (entry.retry === 'never') expect(['retry', 'new-generation'], entry.code).not.toContain(entry.recovery);
    }
    for (const code of C.CG_P1_CODES) expect(C.cgEntry(code).retry).toBe('never');
    expect(C.cgEntry('CG-SEND-UNCERTAIN').retry).toBe('never');
    expect(C.cgEntry('CG-INSERT-UNCERTAIN').retry).toBe('never');
  });
});
