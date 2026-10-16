// «Новые» on Fansly as pure rules (R20 P10a): the background's rows in the neutral words of a pass, the periods and
// the pages, and the pass's own rules the window lists with — «К обработке», the filters, the search, the merge of
// changes and the conversation's cap.

import { describe, expect, it } from 'vitest';

import { FANSLY_TAB_LIMITS, type FanslyFollowerRow, type FanslyPassView } from '@cg/contracts/tab-messages-fansly';
import { NEWCOMER_CHECKS, NEWCOMER_CHECK_FILTERS, type NewcomerMessageVM } from '@cg/contracts/vm';

import { filterLeavesTodo, historyReadable, inPassTab, matchesPassSearch, mergePassRows, passesCheckFilter, placePassPage, prependHistory, writable } from '../../../newcomers/pass';
import { FANSLY_NEWCOMERS_HISTORY, FANSLY_NEWCOMERS_PAGE, FANSLY_NEWCOMERS_WINDOWS, checkOf, fanslyChatPath, passRowOf, passStateOf } from './rows';

const ISO = '2026-10-03T10:00:00.000Z';
const row = (patch: Partial<FanslyFollowerRow> = {}): FanslyFollowerRow => ({
  fanRef: '800000000000000001',
  groupId: '900000000000000001',
  username: 'fan_one',
  displayName: 'Fan One',
  followedAt: ISO,
  status: 'ready',
  dmClosed: null,
  historyRevision: '00000000-0000-4000-8000-000000000501',
  checkedAt: ISO,
  ...patch,
});
const msg = (id: number): NewcomerMessageVM => ({ id: String(id), fromFan: id % 2 === 0, at: ISO, text: `m${id}`, automated: false, attachments: 0 });

describe('[host:fansly] «Новые» on Fansly: the rows of the pass (R20 P10a)', () => {
  it('[NF-003] the periods of the old window: 1 hour to 30 days, 48 hours first, inside the registry’s 1–720', () => {
    expect(FANSLY_NEWCOMERS_WINDOWS).toEqual({ options: [1, 3, 6, 12, 24, 48, 72, 168, 336, 720], initial: 48, min: 1, max: 720 });
    for (const hours of FANSLY_NEWCOMERS_WINDOWS.options) expect(hours >= FANSLY_TAB_LIMITS.windowHoursMin && hours <= FANSLY_TAB_LIMITS.windowHoursMax).toBe(true);
    expect([FANSLY_NEWCOMERS_PAGE, FANSLY_NEWCOMERS_HISTORY]).toEqual([100, { page: 250, cap: 750 }]);
  });

  it('[NF-005] the verdict of a row: «Ждёт ответа» where the fan wrote first; a chat not read to its start is «not checked», never «nobody wrote»', () => {
    expect(checkOf(row())).toBe('ready');
    expect(checkOf(row({ fanWrote: true }))).toBe('reply');
    expect(checkOf(row({ historyRevision: null }))).toBe('unverified');
    expect(checkOf(row({ fanWrote: true, historyRevision: null }))).toBe('unverified');
    for (const status of ['pending', 'checking', 'greeted', 'dm-closed', 'excluded', 'failed'] as const) expect(checkOf(row({ status }))).toBe(status);
  });

  it('[NF-009] [NF-011] a row in the words of a pass: the group as the conversation (never the fan’s id), the person’s name for the fan, the proof, the failure', () => {
    const proof = { messageId: '600000000000000001', fromFan: false, at: ISO, text: 'hey', automated: false, attachments: 0 };
    expect(passRowOf(row({ customName: 'Алекс', bio: 'NYC', proof, error: { code: 'CG-FAN-REQUEST', retryAt: 99 } }))).toEqual({
      fanRef: '800000000000000001',
      conversationRef: '900000000000000001',
      username: 'fan_one',
      displayName: 'Fan One',
      customName: 'Алекс',
      bio: 'NYC',
      followedAt: ISO,
      check: 'ready',
      dmClosed: null,
      dmPriceMills: null,
      checkedAt: ISO,
      proof: { id: proof.messageId, fromFan: false, at: ISO, text: 'hey', automated: false, attachments: 0 },
      failure: { code: 'CG-FAN-REQUEST', retryAt: 99 },
      // R20 P10c: the revision of the history checked in full, which a greeting is sent on.
      historyRevision: '00000000-0000-4000-8000-000000000501',
    });
    // What an older background leaves out is unknown, not empty.
    expect(passRowOf(row({ groupId: null }))).toMatchObject({ conversationRef: null, customName: null, bio: null, proof: null, failure: null });
    expect(fanslyChatPath('900000000000000001')).toBe('/messages/900000000000000001');
  });

  it('[NF-008] [NF-025] the pass: its stage and phase, how many are checked, whether it is whole, why it stopped', () => {
    const view: FanslyPassView = {
      passId: '00000000-0000-4000-8000-000000000301',
      hostAccountId: '700000000000000017',
      windowHours: 48,
      state: 'scanning',
      phase: 'profiles',
      startedAt: ISO,
      counts: { total: 120, checked: 40, ready: 31, greeted: 5, dmClosed: 2, excluded: 1 },
      partial: true,
      cooldownUntil: null,
      error: { code: 'CG-FAN-RATE-LIMIT', retryAt: 5 },
    };
    expect(passStateOf(view)).toEqual({ passId: view.passId, hostAccountId: view.hostAccountId, windowHours: 48, state: 'scanning', phase: 'profiles', startedAt: ISO, total: 120, checked: 40, partial: true, cooldownUntil: null, failure: { code: 'CG-FAN-RATE-LIMIT', retryAt: 5 } });
    expect(passStateOf({ ...view, phase: undefined }).phase).toBeNull();
  });

  it('[NF-006] «К обработке» holds whom the person can still act on; each filter takes its statuses; «Уже писали» shows «Все»', () => {
    const todo = NEWCOMER_CHECKS.filter((check) => inPassTab(check, 'todo'));
    expect(todo).toEqual(['checking', 'pending', 'ready', 'reply', 'unverified', 'dm-closed', 'failed']);
    expect(NEWCOMER_CHECKS.every((check) => inPassTab(check, 'all'))).toBe(true);
    const taken = Object.fromEntries(NEWCOMER_CHECK_FILTERS.map((filter) => [filter, NEWCOMER_CHECKS.filter((check) => passesCheckFilter(check, filter))]));
    expect(taken).toEqual({
      any: [...NEWCOMER_CHECKS],
      ready: ['ready'],
      pending: ['pending'],
      reply: ['reply'],
      unchecked: ['checking', 'pending', 'unverified', 'failed'],
      'dm-closed': ['dm-closed', 'excluded'],
      contacted: ['greeted'],
    });
    expect(NEWCOMER_CHECK_FILTERS.filter(filterLeavesTodo)).toEqual(['contacted']);
    expect(NEWCOMER_CHECKS.filter(writable)).toEqual(['ready', 'reply']);
  });

  it('[NF-006] the search: the name, @username, the person’s own name for the fan or the id; case and width folded', () => {
    const fan = { fanRef: '800000000000000001', username: 'Lora_Fan', displayName: 'Tomasz W.', customName: 'Томас' };
    for (const query of ['', 'tomasz', '@lora_fan', 'LORA', 'томас', '000000001', 'ｔｏｍａｓｚ']) expect(matchesPassSearch(fan, query), query).toBe(true);
    for (const query of ['anna', '@@x', '999']) expect(matchesPassSearch(fan, query), query).toBe(false);
    expect(matchesPassSearch({ fanRef: '1', username: null, displayName: null, customName: null }, 'a')).toBe(false);
  });

  it('[NF-004] [NF-010] changes merge in place; a page lays over what is shown; the conversation stays oldest first and within its cap', () => {
    const a = { fanRef: 'a', v: 1 };
    const b = { fanRef: 'b', v: 1 };
    expect(mergePassRows([a, b], [{ fanRef: 'b', v: 2 }, { fanRef: 'c', v: 1 }], true)).toEqual([a, { fanRef: 'b', v: 2 }, { fanRef: 'c', v: 1 }]);
    expect(mergePassRows([a, b], [{ fanRef: 'c', v: 1 }], false)).toEqual([a, b]);
    expect(placePassPage([a, b], 1, [{ fanRef: 'b', v: 3 }, { fanRef: 'a', v: 9 }, { fanRef: 'd', v: 1 }])).toEqual([a, { fanRef: 'b', v: 3 }, { fanRef: 'd', v: 1 }]);
    expect(placePassPage([a, b, { fanRef: 'z', v: 1 }], 0, [{ fanRef: 'b', v: 2 }])).toEqual([{ fanRef: 'b', v: 2 }]);

    const first = prependHistory([], [msg(9), msg(8), msg(7)], 5);
    expect([first.messages.map((m) => m.id), first.truncated]).toEqual([['7', '8', '9'], false]);
    const second = prependHistory(first.messages, [msg(7), msg(6), msg(5), msg(4)], 5);
    expect([second.messages.map((m) => m.id), second.truncated]).toEqual([['5', '6', '7', '8', '9'], true]);
  });

  it('[NF-010] a conversation is read only when the pass found it and gave its verdict', () => {
    expect(NEWCOMER_CHECKS.filter((check) => historyReadable(check, '900000000000000001'))).toEqual(['ready', 'reply', 'greeted', 'dm-closed', 'excluded']);
    expect(NEWCOMER_CHECKS.some((check) => historyReadable(check, null))).toBe(false);
  });
});
