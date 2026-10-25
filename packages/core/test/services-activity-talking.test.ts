// Chat Memory week 1: the beat of the hub's shift and «в разговоре» in the background.
// - The beat: each bound page once, idle from its most recent input over its tabs; the first bound tab beats at once;
//   the last one going, or a sign-out, closes the install once.
// - «В разговоре»: the person themself never shows; a mark that ran out is gone; a mark names its page's fan and the
//   chat of every account of this browser bound to the page.

import { type ActivityBeatRequest, type InConversationResult } from '@cg/contracts';
import { talkingKeyOfHandle } from '@cg/contracts/vm';
import { createTalkingController } from '@cg/core/application/navigation';
import { ActivityBeat, TalkingMarksService, beatPagesOf, beatTabsOf, talkingMarksOf, type BeatTab } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, settle } from './support/clock';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const INSTANCE = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

describe('the beat', () => {
  it('a page once, idle from its most recent input over its tabs; a page with no input since its tabs opened says null', () => {
    const tabs: BeatTab[] = [
      { pageLabel: 'ari-1', lastInputAt: NOW - 9 * 60_000 },
      { pageLabel: 'ari-1', lastInputAt: NOW - 20_000 },
      { pageLabel: 'lora-1', lastInputAt: null },
      { pageLabel: null, lastInputAt: NOW },
    ];
    expect(beatPagesOf(tabs, NOW)).toEqual([
      { pageLabel: 'ari-1', idleMs: 20_000 },
      { pageLabel: 'lora-1', idleMs: null },
    ]);
    // Older than the hub takes: said as the longest it takes.
    expect(beatPagesOf([{ pageLabel: 'ari-1', lastInputAt: NOW - 3 * 86_400_000 }], NOW)).toEqual([{ pageLabel: 'ari-1', idleMs: 86_400_000 }]);
  });

  it('the first bound tab beats at once; the alarm beats again; the last tab going closes once; a sign-out closes before the token goes', async () => {
    const clock = new FakeClock(NOW);
    const sent: ActivityBeatRequest[] = [];
    let tabs: BeatTab[] = [];
    let enabled = true;
    const beat = new ActivityBeat({
      clock,
      hub: () => ({ activityBeat: (request) => Promise.resolve(void sent.push(request)).then(() => ({ recorded: request.pages.length, serverNow: new Date(clock.now()).toISOString() })) }),
      enabled: () => enabled,
      instanceId: () => INSTANCE,
      tabs: () => tabs,
    });
    // A tab of no page: nothing to say.
    tabs = [{ pageLabel: null, lastInputAt: null }];
    await beat.tabsChanged();
    expect(sent).toEqual([]);
    tabs = [{ pageLabel: 'ari-1', lastInputAt: NOW - 1000 }];
    await beat.tabsChanged();
    // Its keepalive changes nothing until the alarm.
    await beat.tabsChanged();
    await beat.beat();
    expect(sent).toEqual([
      { instanceId: INSTANCE, pages: [{ pageLabel: 'ari-1', idleMs: 1000 }] },
      { instanceId: INSTANCE, pages: [{ pageLabel: 'ari-1', idleMs: 1000 }] },
    ]);
    tabs = [];
    await beat.tabsChanged();
    await beat.tabsChanged();
    await beat.close();
    expect(sent.slice(2)).toEqual([{ instanceId: INSTANCE, pages: [], closed: true }]);
    // Open again, then a sign-out: one closing beat, and nothing at all once the hub does not take beats.
    tabs = [{ pageLabel: 'ari-1', lastInputAt: null }];
    await beat.tabsChanged();
    await beat.close();
    expect(sent.slice(3)).toEqual([
      { instanceId: INSTANCE, pages: [{ pageLabel: 'ari-1', idleMs: null }] },
      { instanceId: INSTANCE, pages: [], closed: true },
    ]);
    enabled = false;
    await beat.tabsChanged();
    await beat.beat();
    expect(sent).toHaveLength(5);
  });

  it("ChatSpace's overview «/» keeps the page the tab was last on — not the pages it lists, not input made on it", () => {
    const pageOf = (account: string | null) => ({ 'chatspace:1': 'lora-of', 'chatspace:2': 'lora-vip-of', 'chatspace:9': null }[account ?? ''] ?? null);
    const last = new Map<string, BeatTab>();
    expect(beatTabsOf([{ tabSessionId: 't1', routeAccount: 'chatspace:1', lastInputAt: NOW - 60_000 }], pageOf, last))
      .toEqual([{ pageLabel: 'lora-of', lastInputAt: NOW - 60_000 }]);
    // On the overview, a click there: still lora-of with its own last input; lora-vip-of it merely lists stays out.
    expect(beatTabsOf([{ tabSessionId: 't1', routeAccount: null, lastInputAt: NOW }], pageOf, last))
      .toEqual([{ pageLabel: 'lora-of', lastInputAt: NOW - 60_000 }]);
    // On to the other account: its page; a tab that opened on the overview has none; an unbound account forgets.
    expect(beatTabsOf([
      { tabSessionId: 't1', routeAccount: 'chatspace:2', lastInputAt: NOW },
      { tabSessionId: 't2', routeAccount: null, lastInputAt: NOW },
    ], pageOf, last)).toEqual([{ pageLabel: 'lora-vip-of', lastInputAt: NOW }, { pageLabel: null, lastInputAt: NOW }]);
    beatTabsOf([{ tabSessionId: 't1', routeAccount: 'chatspace:9', lastInputAt: NOW }], pageOf, last);
    expect(beatTabsOf([{ tabSessionId: 't1', routeAccount: null, lastInputAt: NOW }], pageOf, last))
      .toEqual([{ pageLabel: null, lastInputAt: NOW }]);
    // A closed tab leaves the memory.
    beatTabsOf([{ tabSessionId: 't1', routeAccount: 'chatspace:1', lastInputAt: NOW }], pageOf, last);
    beatTabsOf([], pageOf, last);
    expect(last.size).toBe(0);
  });
});

const answer = (fans: InConversationResult['fans']): InConversationResult => ({ pageLabel: 'ari-1', fans, serverNow: new Date(NOW).toISOString() });
const chatter = (name: string, minutesAgo: number, isMe = false) => ({
  userId: name.length,
  name,
  isMe,
  lastSentAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  until: new Date(NOW - minutesAgo * 60_000 + 15 * 60_000).toISOString(),
});

describe('«в разговоре»', () => {
  it('others only, newest first; a fan only the person writes to has no mark; a mark that ran out is gone; every bound account of the page', () => {
    const accounts = [
      { host: 'fansly-web', hostAccountId: '700000000000000001' },
      { host: 'fansly-web', hostAccountId: '700000000000000009' },
    ];
    const marks = talkingMarksOf(
      answer([
        { fanRef: '900000000000000001', conversationRef: '810000000000000001', chatters: [chatter('Ivan', 9), chatter('Me', 1, true), chatter('Nikita', 2)] },
        { fanRef: '900000000000000002', conversationRef: null, chatters: [chatter('Me', 1, true)] },
        { fanRef: '900000000000000003', conversationRef: null, chatters: [chatter('Nikita', 16)] },
      ]),
      { pageId: 10, accounts },
      NOW,
    );
    expect(marks).toEqual([
      {
        pageId: 10,
        fanRef: '900000000000000001',
        chatKeys: ['fansly-web:700000000000000001:900000000000000001', 'fansly-web:700000000000000009:900000000000000001'],
        names: ['Nikita', 'Ivan'],
        lastSentAt: new Date(NOW - 2 * 60_000).toISOString(),
      },
    ]);
  });

  it('asks the hub at once for a page that appears, again every 30 s, keeps the last answer over a failure, and drops every mark on stop', async () => {
    const clock = new FakeClock(NOW);
    const emitted: number[] = [];
    const answers: (InConversationResult | Error)[] = [
      answer([{ fanRef: '900000000000000001', conversationRef: null, chatters: [chatter('Nikita', 1)] }]),
      new Error('offline'),
      answer([]),
    ];
    let asked = 0;
    const service = new TalkingMarksService({
      clock,
      hub: () => ({
        inConversation: () => {
          asked += 1;
          const next = answers.shift() ?? answer([]);
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        },
      }),
      enabled: () => true,
      pages: () => [{ pageLabel: 'ari-1', pageId: 10, accounts: [{ host: 'chatspace', hostAccountId: '74001001' }] }],
      emit: (marks) => emitted.push(marks.marks.length),
    });
    service.tabsChanged();
    await settle();
    expect(asked).toBe(1);
    expect(service.current().marks.map((mark) => mark.chatKeys)).toEqual([['chatspace:74001001:900000000000000001']]);
    // A keepalive of the same tab asks nothing more.
    service.tabsChanged();
    await settle();
    expect(asked).toBe(1);
    // Not heard: the mark stays.
    await clock.advance(30_000);
    await settle();
    expect(asked).toBe(2);
    expect(service.current().marks).toHaveLength(1);
    // Nobody talking any more.
    await clock.advance(30_000);
    await settle();
    expect(asked).toBe(3);
    expect(service.current().marks).toEqual([]);
    expect(emitted).toEqual([1, 0]);
    service.stop();
    expect(emitted).toEqual([1, 0]);
  });

  it('a hub not heard keeps no mark past its own 15 minutes, and a page never heard is asked again on the 30 s beat, not on every tab change', async () => {
    const clock = new FakeClock(NOW);
    const answers: InConversationResult[] = [
      answer([
        { fanRef: '900000000000000001', conversationRef: null, chatters: [chatter('Nikita', 14)] },
        { fanRef: '900000000000000002', conversationRef: null, chatters: [chatter('Vanya', 0)] },
      ]),
    ];
    let asked = 0;
    let failing = false;
    const service = new TalkingMarksService({
      clock,
      hub: () => ({
        inConversation: () => {
          asked += 1;
          if (failing) return Promise.reject(new Error('offline'));
          return Promise.resolve(answers.shift() ?? answer([]));
        },
      }),
      enabled: () => true,
      pages: () => [{ pageLabel: 'ari-1', pageId: 10, accounts: [{ host: 'fansly', hostAccountId: '74001001' }] }],
      emit: () => undefined,
    });
    service.tabsChanged();
    await settle();
    expect(service.current().marks.map((mark) => mark.fanRef)).toEqual(['900000000000000001', '900000000000000002']);
    failing = true;
    await clock.advance(2 * 60_000);
    await settle();
    // Nikita's message is 16 minutes old now: his mark is gone though the hub is not heard; Vanya's stays.
    expect(service.current().marks.map((mark) => mark.fanRef)).toEqual(['900000000000000002']);

    // A page the hub never answered: the tabs' presence every few seconds asks nothing more than the 30 s beat.
    const quiet = new TalkingMarksService({
      clock,
      hub: () => ({ inConversation: () => ((asked += 1), Promise.reject(new Error('offline'))) }),
      enabled: () => true,
      pages: () => [{ pageLabel: 'lora-1', pageId: 11, accounts: [] }],
      emit: () => undefined,
    });
    asked = 0;
    quiet.tabsChanged();
    await settle();
    for (let i = 0; i < 5; i += 1) quiet.tabsChanged();
    await settle();
    expect(asked).toBe(1);
    service.stop();
    quiet.stop();
  });

  it('⌘K and the quick jump find a mark by their chat handle, which names no host', async () => {
    expect(talkingKeyOfHandle('nav.chat.74001001.900000000000000001')).toBe('acc:74001001:900000000000000001');
    expect(talkingKeyOfHandle('nav.chat.74001001.900000000000000001.810000000000000001')).toBe('acc:74001001:900000000000000001');
    const controller = createTalkingController({
      rpc: {
        request: () => Promise.resolve({ ok: true, payload: { marks: [{ pageId: 10, fanRef: '900000000000000001', chatKeys: ['fansly-web:74001001:900000000000000001' as const], names: ['Nikita'], lastSentAt: new Date(NOW).toISOString() }] } }),
        onEvent: () => () => undefined,
      },
    });
    await settle();
    expect(controller.mark(talkingKeyOfHandle('nav.chat.74001001.900000000000000001') ?? '')?.names).toEqual(['Nikita']);
    controller.dispose();
  });
});
