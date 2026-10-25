// «В разговоре» (Chat Memory week 1; hub `clientInConversation`, capability `in-conversation-v1`): who else wrote to a
// fan of the page in the last 15 minutes. A warning a chatter can pass, never a block: nobody owns a fan.
//
// - The background asks the hub every IN_CONVERSATION_POLL_MS for each page an open tab shows (a tab's accounts bound
//   to a page), and right away when such a page appears. One request per page; nothing is repeated on a failure — the
//   page keeps what it last heard until its marks run out (`until`).
// - The person themself never shows (`isMe`): only the others, newest first.
// - A mark names its page and fan (the boards' rows look it up so) and the chats of this browser's accounts bound to the
//   page (`host:hostAccountId:fanId`: the dock, the quick jump); the tabs hear every change (`talk.changed`) and read
//   the whole on start.

import { IN_CONVERSATION_POLL_MS, type HubFacade, type InConversationResult } from '@cg/contracts/hub';
import { type TalkingMark, type TalkingMarks } from '@cg/contracts/tab-messages';

import { NO_LOG, type Clock, type LogSink, type TimerHandle } from './ports';

/** A page an open tab shows and the host accounts of this browser bound to it (the chats its marks are said by). */
export interface TalkingPage {
  readonly pageLabel: string;
  readonly pageId: number;
  readonly accounts: readonly { readonly host: string; readonly hostAccountId: string }[];
}

/** The marks of one page's answer, others only, those still running at `now`: one per fan. Pure. */
export function talkingMarksOf(answer: InConversationResult, page: Pick<TalkingPage, 'pageId' | 'accounts'>, now: number): TalkingMark[] {
  const marks: TalkingMark[] = [];
  for (const fan of answer.fans) {
    const others = fan.chatters.filter((chatter) => !chatter.isMe && Date.parse(chatter.until) > now).sort((a, b) => Date.parse(b.lastSentAt) - Date.parse(a.lastSentAt));
    const newest = others[0];
    if (newest === undefined) continue;
    marks.push({
      pageId: page.pageId,
      fanRef: fan.fanRef,
      chatKeys: page.accounts.slice(0, 20).map((account) => `${account.host}:${account.hostAccountId}:${fan.fanRef}` as TalkingMark['chatKeys'][number]),
      names: [...new Set(others.map((chatter) => chatter.name))].slice(0, 10),
      lastSentAt: newest.lastSentAt,
    });
  }
  return marks;
}

/** A mark lasts this long after the other chatter's message (the hub's own window). */
const TALK_MS = 15 * 60_000;

export interface TalkingDeps {
  readonly clock: Pick<Clock, 'now' | 'setTimer' | 'clearTimer'>;
  readonly hub: () => Pick<HubFacade, 'inConversation'> | null;
  /** Signed in and the hub lists `in-conversation-v1`. */
  readonly enabled: () => boolean;
  readonly pages: () => readonly TalkingPage[];
  /** Every change goes to the tabs (`talk.changed`). */
  readonly emit: (marks: TalkingMarks) => void;
  readonly log?: LogSink;
}

export class TalkingMarksService {
  /** By page: its last answer's marks and when they run out. */
  private readonly byPage = new Map<string, { readonly marks: readonly TalkingMark[]; readonly until: number }>();
  private timer: TimerHandle | null = null;
  private running: Promise<void> | null = null;
  private said = '';
  private readonly log: LogSink;

  constructor(private readonly deps: TalkingDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** What the tabs are told now: every mark still running by its own message — a hub not heard keeps none longer. */
  current(): TalkingMarks {
    const now = this.deps.clock.now();
    const marks: TalkingMark[] = [];
    for (const page of this.byPage.values()) if (page.until > now) marks.push(...page.marks.filter((mark) => Date.parse(mark.lastSentAt) + TALK_MS > now));
    return { marks };
  }

  /** The tabs changed: a page that appears is asked at once; none left — the polling stops and the marks go. */
  tabsChanged(): void {
    const pages = this.deps.pages();
    if (pages.length === 0 || !this.deps.enabled()) return this.stop();
    if (pages.some((page) => !this.byPage.has(page.pageLabel))) void this.poll();
    else this.schedule();
  }

  /** Signed out, another person, the capability gone: nothing of the old marks stays. */
  stop(): void {
    if (this.timer !== null) this.deps.clock.clearTimer(this.timer);
    this.timer = null;
    this.byPage.clear();
    this.publish();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.clock.setTimer(IN_CONVERSATION_POLL_MS, () => {
      this.timer = null;
      void this.poll();
    });
  }

  private poll(): Promise<void> {
    this.running ??= this.ask().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async ask(): Promise<void> {
    const hub = this.deps.hub();
    const pages = this.deps.pages();
    if (hub === null || !this.deps.enabled() || pages.length === 0) return this.stop();
    for (const label of [...this.byPage.keys()]) if (!pages.some((page) => page.pageLabel === label)) this.byPage.delete(label);
    for (const page of pages) {
      try {
        const answer = await hub.inConversation({ pageLabel: page.pageLabel });
        const now = this.deps.clock.now();
        const marks = talkingMarksOf(answer, page, now);
        // Kept until the newest mark would run out by itself (15 minutes after its message), then dropped.
        const until = Math.max(now + IN_CONVERSATION_POLL_MS * 2, ...marks.map((mark) => Date.parse(mark.lastSentAt) + TALK_MS));
        this.byPage.set(page.pageLabel, { marks, until });
      } catch {
        // Not heard: the page keeps what it last heard until that runs out; the next poll asks again — the regular
        // one: a page never heard is known as asked, so the tabs' next change does not ask it again at once.
        if (!this.byPage.has(page.pageLabel)) this.byPage.set(page.pageLabel, { marks: [], until: this.deps.clock.now() });
        this.log.write({ level: 'info', scope: 'bg.talking', msg: 'in-conversation not heard', fields: { page: page.pageLabel } });
      }
    }
    this.publish();
    this.schedule();
  }

  private publish(): void {
    const marks = this.current();
    const text = JSON.stringify(marks);
    if (text === this.said) return;
    this.said = text;
    this.deps.emit(marks);
  }
}
