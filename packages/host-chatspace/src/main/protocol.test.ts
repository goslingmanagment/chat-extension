// MAIN cannot import anything: its copies of the contracts' literals and of
// the host contract are pinned here, and the contracts' bridge fixtures run
// through its hand-written request checks (docs/protocols/README.md: «R09
// обязан прогнать фикстуры моста через ручные проверки MAIN»).

import {
  BRIDGE_ERRORS,
  BRIDGE_ERRORS_BEFORE_EXECUTION,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TAG_KEY,
  BRIDGE_TAGS,
  BRIDGE_UNDROPPABLE_EVENTS,
  BRIDGE_WRITE_FAILURES,
  BRIDGE_WRITE_REQUESTS,
  BridgeResponseSchema,
  FROM_MAIN_TYPES,
  TO_MAIN_TYPES,
  WS_TAP_SYMBOL_KEY,
} from '@cg/contracts/bridge';
import { CG_CODES } from '@cg/contracts/errors';
import { BRIDGE_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { BRIDGE_LIMITS, LIVE_TEXT_LIMITS, PART_LIMITS, SEND_LIMITS } from '@cg/contracts/limits';
import { describe, expect, it } from 'vitest';

import * as contract from '../isolated/host-contract';
import * as wire from '../isolated/wire';
import { isRequestEnvelope } from './bridge';
import * as protocol from './protocol';
import { PAYLOAD } from './requests';

describe('[EX-008] MAIN bridge literals', () => {
  it('match @cg/contracts (MAIN cannot import it)', () => {
    expect(protocol.PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(protocol.TAG_KEY).toBe(BRIDGE_TAG_KEY);
    expect(protocol.EVT_FAULT).toBe(FROM_MAIN_TYPES.at(-1));
    expect(protocol.EVT_FUSE).toBe(FROM_MAIN_TYPES.at(-2));
    expect(BRIDGE_UNDROPPABLE_EVENTS).toContain(protocol.EVT_FUSE);
    expect(protocol.TAG_MAIN_READY).toBe(BRIDGE_TAGS.mainReady);
    expect(protocol.TAG_ISO_HELLO).toBe(BRIDGE_TAGS.isoHello);
    expect(protocol.TAG_CONNECT).toBe(BRIDGE_TAGS.connect);
    expect(protocol.WS_TAP_KEY).toBe(WS_TAP_SYMBOL_KEY);
    const errors = [protocol.ERR_UNKNOWN_REQUEST, protocol.ERR_BAD_REQUEST, protocol.ERR_NOT_READY, protocol.ERR_IDENTITY, protocol.ERR_STALE_DOCUMENT, protocol.ERR_DISABLED, protocol.ERR_INTERNAL];
    expect([...errors].sort()).toEqual([...BRIDGE_ERRORS].sort());
    expect(protocol.WRITE_REQUESTS).toEqual([...BRIDGE_WRITE_REQUESTS]);
    for (const t of protocol.LIVE_REQUESTS) expect(TO_MAIN_TYPES).toContain(t);
    // Without the tap script the answer is a refusal before execution: a send is `held`, never uncertain.
    expect(BRIDGE_ERRORS_BEFORE_EXECUTION).toContain(protocol.ERR_DISABLED);
    expect(protocol.SEND_MAX_CHARS).toBe(SEND_LIMITS.previewDraftMaxChars);
    expect(protocol.NATIVE_TIMEOUT_MS).toBe(SEND_LIMITS.nativeTimeoutMs);
    expect(protocol.QUEUE_MAX_PER_CHAT).toBe(SEND_LIMITS.nativeQueueMaxPerChat);
    expect(protocol.KNOWN_FAN_MESSAGES).toBe(SEND_LIMITS.knownFanMessagesMax);
    expect(protocol.MAX_STRING).toBe(BRIDGE_LIMITS.maxStringLength);
    expect(protocol.MAX_SNAPSHOT).toBe(BRIDGE_LIMITS.maxSnapshotMessages);
    expect(protocol.MAX_ARRAY).toBe(BRIDGE_LIMITS.maxArrayLength);
    expect(protocol.UI_EVENT_GAP_MS).toBe(1000 / BRIDGE_LIMITS.uiEventsPerSecond);
    expect(protocol.LIVE_TEXT_MAX_CHARS).toBe(LIVE_TEXT_LIMITS.maxChars);
    // MAIN's data budget per answer leaves room for the envelope within the frame limit.
    expect(protocol.FRAME_DATA_BUDGET).toBeLessThanOrEqual(BRIDGE_LIMITS.maxFrameBytes - 32 * 1024);
    expect(protocol.MAX_PARTS).toBe(PART_LIMITS.maxParts);
    expect(protocol.MAX_VARIANTS).toBe(PART_LIMITS.maxVariants);
    const codes = Object.entries(protocol).filter(([name]) => name.startsWith('CG_')).map(([, value]) => value);
    for (const code of codes) expect(CG_CODES).toContain(code);
  });

  it('the isolated side’s early copies match too (wire.ts)', () => {
    expect(wire.PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(wire.TAGS).toEqual(BRIDGE_TAGS);
    expect(wire.TAG_KEY).toBe(BRIDGE_TAG_KEY);
    expect([...wire.ERRORS_BEFORE_EXECUTION]).toEqual([...BRIDGE_ERRORS_BEFORE_EXECUTION]);
    expect([...wire.WRITE_REQUESTS]).toEqual([...BRIDGE_WRITE_REQUESTS]);
    expect([...wire.UNDROPPABLE_EVENTS]).toEqual([...BRIDGE_UNDROPPABLE_EVENTS]);
    expect(wire.WRITE_FAILURES.insertGuarded).toEqual(BRIDGE_WRITE_FAILURES.insertGuarded);
    expect(wire.WRITE_FAILURES.navigate).toEqual(BRIDGE_WRITE_FAILURES.navigate);
  });

  it('repeat the host contract (isolated/host-contract.ts)', () => {
    const shared = [
      'APP_SELECTOR',
      'SLOT_SELECTOR',
      'FRAME_SELECTOR',
      'EDITOR_SELECTOR',
      'BUILD_SELECTOR',
      'ROUTE_CHAT',
      'ROUTE_OVERVIEW',
      'STORE_CACHE',
      'STORE_CHATS',
      'STORE_QUEUE',
      'STORE_TRANSLATOR',
      'STORE_TABS',
      'KEY_ACCOUNTS',
      'KEY_MESSAGES',
      'KEY_FANS',
      'KEY_CHAT_LIST',
      'KEY_MIMIC_SETTINGS',
      'KEY_MIMIC_CHATS',
      'KEY_PERMISSIONS',
      'KEY_BUYING_POWERS',
      'KEY_INSIGHTS',
      'STORE_ACCOUNTS',
      'WS_PATH',
      'WS_NEW_MESSAGE',
      'WS_AUTHENTICATED',
      'PERMISSION_NO_SEND',
      'GUARD_CODE',
    ] as const;
    for (const name of shared) expect([name, protocol[name]]).toEqual([name, contract[name]]);
    expect(protocol.BUILD_PATTERN.source).toBe(contract.BUILD_PATTERN.source);
    expect(protocol.SEND_PATH.source).toBe(contract.SEND_PATH.source);
    expect(contract.draftKey('1001', '2002')).toBe('chat-space:draft:of:1001:2002');
  });

  it('builds response envelopes the contract accepts', () => {
    const base = { v: protocol.PROTOCOL_VERSION, id: 1, t: 'probe', documentEpoch: 'abc', seq: 0 };
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_RES, ok: true, data: {} }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_RES, ok: false, err: protocol.ERR_UNKNOWN_REQUEST }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_REQ, ok: true, data: {} }).success).toBe(false);
  });
});

describe('[EX-008] MAIN request checks agree with the contracts fixtures', () => {
  const ownTypes = TO_MAIN_TYPES.filter((t) => t !== 'probe');

  it.each(ownTypes)('%s: valid payloads pass, invalid ones are refused', (t) => {
    const check = PAYLOAD[t];
    expect(check).toBeTypeOf('function');
    const fixtures = BRIDGE_REQUEST_FIXTURES[t].payload;
    for (const payload of fixtures.valid) expect([t, payload, check?.(payload)]).toEqual([t, payload, true]);
    for (const payload of fixtures.invalid) expect([t, payload, check?.(payload)]).toEqual([t, payload, false]);
  });

  it('R20 F6a, ChatSpace: an identity or a chat of another site is refused — ChatSpace MAIN serves ChatSpace alone', () => {
    // The contracts' schemas are shared by both sites and take either kind of host; ChatSpace's isolated world only
    // ever names its own, so MAIN takes `chatspace` alone (docs/project-unite/architecture.md §1.9).
    const draft = BRIDGE_REQUEST_FIXTURES.readDraft.payload.valid[0] as { readonly expected: Record<string, unknown> };
    const insert = BRIDGE_REQUEST_FIXTURES.insertGuarded.payload.valid[0] as { readonly intent: Record<string, unknown> & { readonly target: Record<string, unknown> } };
    expect([PAYLOAD['readDraft']?.(draft), PAYLOAD['insertGuarded']?.(insert)]).toEqual([true, true]);
    expect(PAYLOAD['readDraft']?.({ expected: { ...draft.expected, host: 'fansly-web' } })).toBe(false);
    expect(PAYLOAD['insertGuarded']?.({ intent: { ...insert.intent, target: { ...insert.intent.target, host: 'fansly-web' } } })).toBe(false);
  });

  it('[NEW-01] a navigation’s deferred insert must aim at the navigation’s own account and fan', () => {
    const then = (fan: string, acc = '1001') => ({
      intentId: '00000000-0000-4000-8000-000000000011',
      operationId: '00000000-0000-4000-8000-000000000012',
      part: { index: 0 },
      target: { host: 'chatspace', hostAccountId: acc, platformFanId: fan },
      expected: { kind: 'deferred', documentEpoch: 'doc' },
      mode: 'replace',
      text: 'hi',
      confirmationId: null,
      createdAt: 1,
      expiresAt: 2,
    });
    const navigate = (fan: string | null, insert: unknown) => ({ intent: { intentId: '00000000-0000-4000-8000-000000000010', acc: '1001', fan, thenInsert: insert } });
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2002')))).toBe(true);
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2003')))).toBe(false);
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2002', '1009')))).toBe(false);
    expect(PAYLOAD['navigate']?.(navigate(null, then('2002')))).toBe(false);
  });

  it('the envelope check takes the contract’s request frames and nothing else', () => {
    const frame = { v: 1, kind: 'req', id: 1, t: 'probe', documentEpoch: null, seq: 0, payload: {} };
    expect(isRequestEnvelope(frame)).toBe(true);
    expect(isRequestEnvelope({ ...frame, documentEpoch: 'doc' })).toBe(true);
    expect(isRequestEnvelope({ ...frame, extra: 1 })).toBe(false);
    expect(isRequestEnvelope({ ...frame, id: 0 })).toBe(false);
    expect(isRequestEnvelope({ ...frame, kind: 'res' })).toBe(false);
    expect(isRequestEnvelope({ ...frame, documentEpoch: 'bad epoch' })).toBe(false);
    expect(isRequestEnvelope(null)).toBe(false);
  });
});
