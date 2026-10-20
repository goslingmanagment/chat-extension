// The fixed vocabularies and tables: the CG codes of Appendix A, the X8
// attempt machine of §6.7.7, the operation model and timeouts of §7, the
// histogram bounds of client_health.

import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as C from '../src/index';
import { contractReport, siteContractReport } from './fixtures/samples';

describe('CG codes (Appendix A)', () => {
  it('are unique and keep the CG-<AREA>-<NAME> form', () => {
    expect(new Set(C.CG_CODES).size).toBe(C.CG_CODES.length);
    for (const code of C.CG_CODES) expect(code).toMatch(C.CG_CODE_PATTERN);
    expect(C.isCgCode('CG-SEND-UNCERTAIN')).toBe(true);
    expect(C.isCgCode('CG-HUB-401')).toBe(false);
  });

  it('every code used by the contracts is registered', () => {
    const admissionCodes = ['CG-OP-CHAT-BUSY', 'CG-OP-TAB-LIMIT'];
    for (const code of admissionCodes) expect(C.isCgCode(code)).toBe(true);
  });
});

describe('host kinds in the light modules', () => {
  it('tab.register takes exactly the host kinds of hosts.ts (1.15.0: imported, no copy left to pin)', () => {
    for (const host of C.HOST_KINDS) expect(C.TabRegisterRequestSchema.safeParse({ host, lateInjection: false, contractsVersion: '1.0.0' }).success).toBe(true);
    expect(C.TabRegisterRequestSchema.shape.host.options).toEqual([...C.HOST_KINDS]);
    expect(C.TAB_REQUESTS['tab.register'].req).toBe(C.TabRegisterRequestSchema);
  });
});

describe('sites (1.15.0, R20)', () => {
  it('every host kind serves one known platform, and the table names no other host', () => {
    expect(C.HOST_PLATFORM).toEqual({ chatspace: 'onlyfans', 'fansly-web': 'fansly' });
    expect(Object.keys(C.HOST_PLATFORM)).toEqual([...C.HOST_KINDS]);
    for (const host of C.HOST_KINDS) expect(C.narrowPlatform(C.HOST_PLATFORM[host]), host).toBe(C.HOST_PLATFORM[host]);
  });

  it('Target binds a chat to a page of exactly the platform of its host', () => {
    for (const host of C.HOST_KINDS)
      for (const platform of C.KNOWN_PLATFORMS) {
        const chat = { host, hostAccountId: '1001', platformFanId: '2002' };
        const binding = { hubOrigin: 'https://hub.example.test', principalId: 7, loginEpoch: 3, host, hostAccountId: '1001', platform, platformAccountId: '3003', pageId: 11, pageLabel: 'page', bindingRevision: 1 };
        const verdict = C.TargetSchema.safeParse({ binding, chat, fanRef: '2002', conversationRef: '2002' }).success;
        expect(verdict, `${host} → ${platform}`).toBe(C.HOST_PLATFORM[host] === platform);
      }
  });

  it('R20 F6b: a chat is its fan on OnlyFans alone (CHAT_IS_FAN), the rule Target pins; every known platform says which', () => {
    expect(C.CHAT_IS_FAN).toEqual({ onlyfans: true, fansly: false });
    expect(Object.keys(C.CHAT_IS_FAN).sort()).toEqual([...C.KNOWN_PLATFORMS].sort());
    for (const host of C.HOST_KINDS) {
      const platform = C.HOST_PLATFORM[host];
      const chat = { host, hostAccountId: '1001', platformFanId: '2002' };
      const binding = { hubOrigin: 'https://hub.example.test', principalId: 7, loginEpoch: 3, host, hostAccountId: '1001', platform, platformAccountId: '3003', pageId: 11, pageLabel: 'page', bindingRevision: 1 };
      // A conversation apart from the fan is a Target only where a chat is not its fan.
      expect(C.TargetSchema.safeParse({ binding, chat, fanRef: '2002', conversationRef: '2003' }).success, host).toBe(!C.CHAT_IS_FAN[platform]);
    }
  });

  it('R20 P9d: a greeting\'s dispatch needs `previewSend` too only where it leaves through the preview\'s queue (OnlyFans); every known platform says which', () => {
    expect(C.GREETING_DISPATCH_FLAGS).toEqual({ onlyfans: ['previewSend', 'newcomers'], fansly: ['newcomers'] });
    expect(Object.keys(C.GREETING_DISPATCH_FLAGS).sort()).toEqual([...C.KNOWN_PLATFORMS].sort());
    for (const flags of Object.values(C.GREETING_DISPATCH_FLAGS)) for (const flag of flags) expect(C.CLIENT_FEATURE_FLAG_NAMES).toContain(flag);
  });

  it('a route names its conversation only where it fits (conversationFits)', () => {
    const fansly = { host: 'fansly-web', hostAccountId: '700000000000000001', platformFanId: '700000000000000002' } as const;
    const chatspace = { host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' } as const;
    const group = '700000000000000003';
    // No conversation: what every route before 1.15.0 is.
    expect(C.conversationFits({ name: 'chat', chat: chatspace })).toBe(true);
    expect(C.conversationFits({ name: 'other', chat: null })).toBe(true);
    // Fansly: the group from the address, before and after the fan is known; a group chat has no fan of its own.
    expect(C.conversationFits({ name: 'chat', chat: null, conversationRef: group })).toBe(true);
    expect(C.conversationFits({ name: 'chat', chat: fansly, conversationRef: group, conversationKind: 'direct' })).toBe(true);
    expect(C.conversationFits({ name: 'chat', chat: null, conversationRef: group, conversationKind: 'group' })).toBe(true);
    expect(C.conversationFits({ name: 'chat', chat: fansly, conversationRef: group, conversationKind: 'group' })).toBe(false);
    // Only a chat route names a conversation, and a kind comes only with it.
    expect(C.conversationFits({ name: 'other', chat: null, conversationRef: group })).toBe(false);
    expect(C.conversationFits({ name: 'chat', chat: fansly, conversationKind: 'direct' })).toBe(false);
    // On OnlyFans the conversation is the fan (HOST_PLATFORM), as in Target.
    expect(C.conversationFits({ name: 'chat', chat: chatspace, conversationRef: '2002' })).toBe(true);
    expect(C.conversationFits({ name: 'chat', chat: chatspace, conversationRef: '2003' })).toBe(false);
  });

  it('hosts.ts stays light (no imports), and ids.ts still exports its host kinds', async () => {
    const source = readFileSync(new URL('../src/hosts.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*(import|export \* from|export \{[^}]*\} from)/m);
    const ids = await import('../src/ids');
    const hosts = await import('../src/hosts');
    expect(ids.HOST_KINDS).toBe(hosts.HOST_KINDS);
    expect(C.HostKindSchema.options).toEqual([...hosts.HOST_KINDS]);
  });
});

describe('bridge writes that may have run', () => {
  it('fix an outcome each receipt schema accepts, and only for the three writes', () => {
    expect(Object.keys(C.BRIDGE_WRITE_FAILURES).sort()).toEqual([...C.BRIDGE_WRITE_REQUESTS].sort());
    expect(C.InsertReceiptSchema.safeParse(C.BRIDGE_WRITE_FAILURES.insertGuarded).success).toBe(true);
    expect(C.NavigationReceiptSchema.safeParse(C.BRIDGE_WRITE_FAILURES.navigate).success).toBe(true);
    expect(C.PreviewSendCommitSchema.safeParse(C.BRIDGE_WRITE_FAILURES.previewSendCommit).success).toBe(true);
    expect(C.BRIDGE_ERRORS_BEFORE_EXECUTION).not.toContain('internal');
  });
});

describe('logs', () => {
  it('redact secrets by name and suffix, not ids or counts (LG-003)', () => {
    for (const key of ['token', 'leaseToken', 'actionToken', 'promptToken', 'ticket', 'dispatchTicket', 'Authorization', 'set-cookie', 'refresh_token', 'password', 'apiKey', 'session'])
      expect(C.isRedactedLogField(key), key).toBe(true);
    for (const key of ['tabSessionId', 'inputTokens', 'tokenCount', 'attemptId', 'textLength', 'chatKey']) expect(C.isRedactedLogField(key), key).toBe(false);
  });
});

describe('settings keys', () => {
  it('a host account key names the host, as ChatKey does', () => {
    expect(C.hostAccountKeyOf('chatspace', '1001')).toBe('chatspace:1001');
    for (const host of C.HOST_KINDS) expect(C.HostAccountKeySchema.safeParse(C.hostAccountKeyOf(host, '1001')).success, host).toBe(true);
  });
});

describe('X8 attempt machine (§6.7.7)', () => {
  const T = C.SEND_ATTEMPT_TRANSITIONS as Record<C.SendAttemptState, readonly C.SendAttemptState[]>;

  it('covers every state and starts from ready only', () => {
    expect(Object.keys(T).sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
    for (const targets of Object.values(T)) expect(targets).not.toContain('ready');
  });

  it('reaches every state from ready', () => {
    const seen = new Set<C.SendAttemptState>(['ready']);
    const queue: C.SendAttemptState[] = ['ready'];
    while (queue.length > 0) {
      const state = queue.shift() as C.SendAttemptState;
      for (const next of T[state]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...seen].sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
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

describe('operations (§5.5, §7)', () => {
  it('states and transitions: terminal states have no way out', () => {
    for (const state of C.OP_TERMINAL_STATES) expect(C.OP_TRANSITIONS[state]).toEqual([]);
    expect(Object.keys(C.OP_TRANSITIONS).sort()).toEqual([...C.OP_STATES].sort());
  });

  it('timeouts follow the §7 table for every feature', () => {
    const s = (v: number) => v * 1000;
    expect(Object.keys(C.OP_TIMEOUTS).sort()).toEqual([...C.FEATURE_IDS].sort());
    for (const feature of ['reply', 'fix', 'hi', 'ping'] as const) {
      expect(C.OP_TIMEOUTS[feature]).toEqual({ untilMetaMs: s(30), firstChunkAfterMetaMs: s(30), silenceMs: s(30), maxMs: s(60) });
    }
    expect(C.OP_TIMEOUTS['recap-short']).toEqual({ untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(120) });
    for (const feature of ['review', 'recap'] as const) {
      expect(C.OP_TIMEOUTS[feature]).toEqual({ untilMetaMs: s(180), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(300) });
    }
    expect(C.OP_TIMEOUTS.coach).toEqual({ untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(180) });
  });

  it('concurrency and the one transparent retry (А3, §7)', () => {
    expect(C.OP_LIMITS.perChat).toBe(1);
    expect(C.OP_LIMITS.perTab).toBe(3);
    expect(C.OP_LIMITS.serviceUnavailableRetries).toBe(1);
    expect(C.OP_LIMITS.serviceUnavailableRetryDelayMs).toBe(5000);
  });

  it('fresh text and Split belong to the right features (D-14, D-15)', () => {
    expect(C.FRESH_TEXT_FEATURES).toEqual(['reply', 'fix', 'hi', 'ping']);
    expect(C.SPLIT_FEATURES).not.toContain('recap');
    expect(C.SPLIT_FEATURES).not.toContain('review');
    expect(C.isFreshTextFeature('coach')).toBe(false);
    expect(C.isSplitFeature('coach')).toBe(true);
  });
});

describe('client_health histograms', () => {
  it('fixed bounds are positive and strictly increasing; at most 16 metrics', () => {
    expect(C.PERF_METRIC_NAMES.length).toBeLessThanOrEqual(C.TELEMETRY_LIMITS.healthMaxPerf);
    for (const metric of C.PERF_METRIC_NAMES) {
      const { bounds } = C.PERF_METRICS[metric];
      expect(bounds.length).toBeGreaterThan(0);
      expect(bounds.length).toBeLessThanOrEqual(32);
      bounds.forEach((bound, i) => {
        expect(bound).toBeGreaterThan(0);
        if (i > 0) expect(bound).toBeGreaterThan(bounds[i - 1] ?? Number.POSITIVE_INFINITY);
      });
    }
  });

  it('names every metric of §5.7', () => {
    for (const metric of ['panelOpenMs', 'insertMs', 'ttfcMs', 'firstChunkPaintMs', 'routeToDockMs', 'handlerMs', 'boardOpenMs', 'searchMs', 'eventLatencyMs']) {
      expect(C.PERF_METRIC_NAMES).toContain(metric);
    }
  });

  it('[R20 F7] names Fansly\'s four of HF-13; each budget is an edge of its buckets', () => {
    // Their bounds are the hub's (hub #577, `CLIENT_HEALTH_PERF_METRICS`): since the SDK is vendored past it (R20 P2v),
    // packages/testing's sdk-alignment test holds every metric of ours to the vendored SDK's table, these four included.
    for (const metric of ['frameParseMs', 'xhrParseMs', 'snapshotMs', 'snapshotRoundTripMs']) expect(C.PERF_METRIC_NAMES).toContain(metric);
    // Each budget is an edge (architecture §8.13): 0.1 ms a frame, 2 ms a response, 5 ms the snapshot's step.
    expect(C.PERF_METRICS.frameParseMs.bounds).toContain(0.1);
    expect(C.PERF_METRICS.xhrParseMs.bounds).toContain(2);
    expect(C.PERF_METRICS.snapshotMs.bounds).toContain(5);
    // The registry has 15 and a report carries at most 16, as the hub's schema.
    expect(C.PERF_METRIC_NAMES).toHaveLength(15);
  });
});

describe('the host contract report by site (1.15.0, R20 F7)', () => {
  it('every site but ChatSpace reports in its own shape', () => {
    expect([...C.SITE_REPORT_HOSTS].sort()).toEqual(C.HOST_KINDS.filter((host) => host !== 'chatspace').sort());
    expectTypeOf<(typeof C.SITE_REPORT_HOSTS)[number]>().toEqualTypeOf<Exclude<C.HostKind, 'chatspace'>>();
  });

  it('a report names its site — none is ChatSpace — and its anchors where its site keeps them', () => {
    expect(C.contractHostOf(contractReport)).toBe('chatspace');
    expect(C.contractHostOf({ ...contractReport, host: 'chatspace' })).toBe('chatspace');
    expect(C.contractHostOf(siteContractReport)).toBe('fansly-web');
    expect(C.contractAnchorsOf(contractReport)).toBe(contractReport.anchors);
    expect(C.contractAnchorsOf(siteContractReport)).toBe(siteContractReport.extensions['fansly-web']?.anchors);
  });

  it("ChatSpace's expected set is every anchor of the report, part B its owner's switches", () => {
    expect(C.CHATSPACE_CONTRACT.anchors).toEqual(C.ANCHOR_IDS);
    expect(C.CHATSPACE_CONTRACT.switchedAnchors.every((anchor) => (C.ANCHOR_IDS as readonly string[]).includes(anchor))).toBe(true);
    expect([...C.CHATSPACE_CONTRACT.switchedCapabilities].sort()).toEqual(['incoming', 'previewSend', 'receipt', 'sendObserve']);
  });

  it('«Статус» has one `host` row a site, and ChatSpace\'s words are its texts', () => {
    expect(C.STATUS_ROW_IDS).toContain('host');
    expect(C.STATUS_ROW_IDS as readonly string[]).not.toContain('chatspace');
    for (const key of Object.values(C.CHATSPACE_STATUS_TEXTS)) expect(C.UI_TEXT_KEYS).toContain(key);
  });
});
