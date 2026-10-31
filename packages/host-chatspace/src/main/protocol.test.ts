// MAIN's hand-written request checks (MAIN cannot import the contracts' schemas): a navigation's deferred insert
// may only aim at the chat the navigation opens; an attach of ours takes what the contract takes.

import { BRIDGE_UNDROPPABLE_EVENTS, BRIDGE_WRITE_FAILURES, BRIDGE_WRITE_REQUESTS } from '@cg/contracts/bridge';
import { BRIDGE_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { OM_NOTE_COLOR_PATTERN, OM_NOTE_ID_PATTERN } from '@cg/contracts/host';
import { ONLYFANS_FEED_MAX_RECORDS, ONLYFANS_FEED_MEDIA_MAX, ONLYFANS_FEED_MONEY_MAX, ONLYFANS_FEED_TEXT_MAX } from '@cg/contracts/hub';
import { FAN_NOTES_LIMITS, ONLINE_SOURCE_LIMITS } from '@cg/contracts/limits';
import { WRITE_REQUESTS as BOOT_WRITES } from '@cg/host-kit/main/protocol';
import { describe, expect, it } from 'vitest';

import { UNDROPPABLE_EVENTS, WRITE_FAILURES, WRITE_REQUESTS } from '../isolated/wire';
import * as CONTRACT from '../isolated/host-contract';
import { EVT_FAN_NOTES, EVT_FEED, FEED_MAX_RECORDS, FEED_MEDIA_MAX, FEED_MONEY_MAX, FEED_TEXT_MAX, FAN_NOTE_COLOR, FAN_NOTE_ID, FAN_NOTE_TEXT_MAX, FAN_NOTE_TITLE_MAX, FAN_NOTES_MAX, ONLINE_PROBE_MAX, ONLINE_PROBE_REQUEST_MS, ONLINE_SEEN_MAX, ONLINE_SEEN_SCAN_MAX, ONLINE_SEEN_WINDOW_MS, WS_DATA_UPDATED, WS_USER_NOTES } from './protocol';
import { PAYLOAD } from './requests';

describe('[EX-008] MAIN request checks', () => {
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

  it('an attach of ours: the name the page reads, the MP3 itself within the cap, no token — as the contract fixtures say', () => {
    const { valid, invalid } = BRIDGE_REQUEST_FIXTURES.attachFile.payload;
    for (const payload of valid) expect(PAYLOAD['attachFile']?.(payload)).toBe(true);
    for (const [index, payload] of invalid.entries()) expect(PAYLOAD['attachFile']?.(payload), `invalid #${index}`).toBe(false);
  });

  it('2026-10-28: the open fan’s OnlyMonster notes — never a blank note, an id that leaves its path segment or a colour that is no colour', () => {
    for (const t of ['fanNotes', 'createFanNote', 'updateFanNote', 'deleteFanNote'] as const) {
      const { valid, invalid } = BRIDGE_REQUEST_FIXTURES[t].payload;
      for (const payload of valid) expect(PAYLOAD[t]?.(payload), `${t} ${JSON.stringify(payload)}`).toBe(true);
      for (const payload of invalid) expect(PAYLOAD[t]?.(payload), `${t} ${JSON.stringify(payload)}`).toBe(false);
    }
  });

  it('2026-11-01: the copies of the OnlyFans feed’s bounds and its event are the contracts’', () => {
    expect([FEED_MAX_RECORDS, FEED_TEXT_MAX, FEED_MEDIA_MAX, FEED_MONEY_MAX]).toEqual([ONLYFANS_FEED_MAX_RECORDS, ONLYFANS_FEED_TEXT_MAX, ONLYFANS_FEED_MEDIA_MAX, ONLYFANS_FEED_MONEY_MAX]);
    expect(UNDROPPABLE_EVENTS).toContain(EVT_FEED);
  });

  it('2026-10-31: the copies of «Онлайн»’s bounds on OnlyFans are the contracts’', () => {
    expect([ONLINE_SEEN_MAX, ONLINE_SEEN_WINDOW_MS, ONLINE_SEEN_SCAN_MAX, ONLINE_PROBE_MAX, ONLINE_PROBE_REQUEST_MS]).toEqual([ONLINE_SOURCE_LIMITS.seenMax, ONLINE_SOURCE_LIMITS.seenWindowMs, ONLINE_SOURCE_LIMITS.seenScanMax, ONLINE_SOURCE_LIMITS.probeMax, ONLINE_SOURCE_LIMITS.probeRequestMs]);
  });

  it('2026-10-28: the copies of the notes’ bounds, the writes and the events are the contracts’', () => {
    expect([FAN_NOTE_TITLE_MAX, FAN_NOTE_TEXT_MAX, FAN_NOTES_MAX]).toEqual([FAN_NOTES_LIMITS.titleMax, FAN_NOTES_LIMITS.textMax, FAN_NOTES_LIMITS.listMax]);
    expect([FAN_NOTE_ID.source, FAN_NOTE_COLOR.source]).toEqual([OM_NOTE_ID_PATTERN.source, OM_NOTE_COLOR_PATTERN.source]);
    expect([WS_DATA_UPDATED, WS_USER_NOTES]).toEqual([CONTRACT.WS_DATA_UPDATED, CONTRACT.WS_USER_NOTES]);
    expect([...BOOT_WRITES]).toEqual([...BRIDGE_WRITE_REQUESTS]);
    expect([...WRITE_REQUESTS]).toEqual([...BRIDGE_WRITE_REQUESTS]);
    expect(WRITE_FAILURES).toEqual(BRIDGE_WRITE_FAILURES);
    expect([...UNDROPPABLE_EVENTS]).toEqual([...BRIDGE_UNDROPPABLE_EVENTS]);
    expect(BRIDGE_UNDROPPABLE_EVENTS).toContain(EVT_FAN_NOTES);
  });
});
