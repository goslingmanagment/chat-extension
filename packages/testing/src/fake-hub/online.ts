// «Онлайн» as the fake hub serves it (hub #879: services/client-online.ts, client-online-rules.ts): the page's fans
// seen online within `minutes`, each with why to write now and with what (the hub's own rules, ported below), the team
// guide's texts, a Fansly tab's presence reports and what the chatters did in the window. Nothing here sends anything.
//
// Where the fans come from:
// - a scenario's list of the page (`online`: items with the facts they name, the rest filled in; `seenAgoMs` keeps an
//   item that long after the hub's «now» at every read), else the stand's fans — the first rows of the page's board
//   (`spenderFans`, else the synthetic board), seen a few minutes apart, the stories of a working day on top of what
//   the board says of them (a subscriber since yesterday, one whose subscription ends without renewal, a short chat);
// - a Fansly page: whom the tabs reported (`clientOnlinePresence`) — the fake takes every reported follower as the
//   page's (the stand's followers are its creator's), refreshes a listed fan's moment and, without a scenario's list,
//   adds a follower the board does not have (the hub knows no chat of his: «никогда не писал»).
//
// What the chatters did is reflected as the hub reflects it, in its order: «Не предлагать» sets the fan aside with who
// marked him and its undo clears it (the latest of the two wins); another chatter «в разговоре» with him (the fake's
// in-conversation) sets him aside; a message the window sent sets him aside as «писали из окна» until he writes (the
// fake keeps it that simple: whatever his reason). Set aside is never hidden. Times are the hub clock's.

import {
  CHAT_IS_FAN,
  ONLINE_REASONS,
  type OnlineAttemptRequest,
  type OnlineAttemptResult,
  type OnlineItem,
  type OnlineList,
  type OnlinePresenceRequest,
  type OnlinePresenceResult,
  type OnlineTemplate,
} from '@cg/contracts';

import { iso } from './clock';
import { type FakePage } from './config';
import { type FakeOnlineAttempt, type FakeOnlinePresenceReport } from './types';

/** An answer of the model or the hub's refusal (data.ts `Read`, structurally). */
type Read<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly refusal: { readonly error: string; readonly reason?: string } };

/**
 * The team's reactivation guide as the hub serves it (hub client-online-rules.ts `ONLINE_TEMPLATES`), word for word:
 * A — the fan talked before and went quiet, B — he never wrote. «love» is the place of the fan's name.
 */
export const ONLINE_TEMPLATES: readonly OnlineTemplate[] = [
  { id: "A1", group: "a", text: "hey love 👋 not gonna pretend this is some spontaneous \"was just thinking of you\" moment lol. I'm going through my messages and realized we haven't talked in a while. I have a very important question for you but I need to know you're alive first lol" },
  { id: "A2", group: "a", text: "hey love 👋 I was scrolling back through my messages and saw our old convos - lowkey made me wonder where you disappeared to. everything good?" },
  { id: "A3", group: "a", text: "ok random but I just shot something that reminded me of a conversation we had a while back. you still around?" },
  { id: "A4", group: "a", text: "okay genuine question love - are you the type who disappears and then randomly comes back, or did I do something wrong? 😂" },
  { id: "A5", group: "a", text: "okay real talk love - I know you probably get a ton of messages. but I actually want to know what's going on with you. boring life update accepted" },
  { id: "A6", group: "a", text: "hey love 👋 okay so I have this idea for something new but I need a second opinion before I commit to it. you around?" },
  { id: "A7", group: "a", text: "hey love - was organizing my DMs (yes I do that sometimes lol) and realized you went quiet on me. what happened?" },
  { id: "A8", group: "a", text: "okay real talk love - I'm trying something different soon and lowkey want to know if it's something you'd even be into. thoughts?" },
  { id: "A9", group: "a", text: "hey love 👋 quick question - I'm planning content for next week and I'm torn between two ideas. wanna help me pick?" },
  { id: "A10", group: "a", text: "be honest love - did you forget about me or are you just watching from the shadows? 👀" },
  { id: "A11", group: "a", text: "okay wait you're still here but we haven't talked in forever. are you mad at me or just busy? lol" },
  { id: "B1", group: "b", text: "hey love - I noticed you've been here for a bit but we never actually talked? that's kinda unusual for me lol. what brought you here originally?" },
  { id: "B2", group: "b", text: "hey! I feel like we somehow never ended up talking which is weird lol - I'm curious, what kind of content do you usually like? trying to figure out what to shoot next 😄" },
  { id: "B3", group: "b", text: "ok be honest are you the quiet type or did my page just get lost in the scroll? either way, hi 👋" },
  { id: "B4", group: "b", text: "hey love 👋 I keep seeing you here but we've never actually talked? that's giving mystery vibes lol. shy or just picky?" },
  { id: "B5", group: "b", text: "ok I'm genuinely curious - you've been following for a while but never said hi. are you shy or just picky about who you talk to? 😄" },
];

/** The hub's rules of «Онлайн» (client-online-rules.ts `ONLINE_RULES`). */
export const ONLINE_RULES = {
  waitingDays: 30,
  newDays: 7,
  expiringDays: 3,
  silentDays: 5,
  welcomeMinutes: 2,
  wroteRecentlyHours: 48,
  attemptCooldownDays: 21,
  payerMinGrossMills: 10,
  pingMinMessages: 10,
  freshMinutes: 10,
  /** The hub's `CLIENT_ONLINE_MAX_ITEMS`. */
  maxItems: 200,
  /** A presence moment this far ahead of the hub's clock is a skew; beyond it, a wrong one (not kept). */
  presenceSkewMs: 60_000,
} as const;

/** Where a fan's moment came from (hub shared/fans.ts). */
export const ONLINE_SEEN_SOURCES = { ofapi: 'ofapi_last_seen', fanslyFollowers: 'fansly_followers_last_seen', fanslyExtension: 'fansly_extension_last_seen' } as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What the fake knows of a fan of the page: the facts the hub's rules read (times in epoch ms; null — none). */
export interface OnlineFacts {
  readonly fanRef: string;
  readonly conversationRef: string | null;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly alias: string | null;
  readonly lifetimeGrossMills: number;
  readonly last30dGrossMills: number;
  readonly seenAt: number | null;
  readonly onlineSince: number | null;
  readonly seenSource: string | null;
  /** The fan's last message of the primary chat. */
  readonly lastFanMessageAt: number | null;
  /** The page's last personal message to the fan (never a mass message). */
  readonly answeredAt: number | null;
  readonly isSubscriber: boolean;
  readonly startedAt: number | null;
  readonly endsAt: number | null;
  readonly autoRenew: boolean | null;
  /** Messages of the primary chat, counted up to 10. */
  readonly messageCount: number;
}

/** What a scenario says of one item: the decision as given (reason, act, aside), or none — the rules decide. */
export interface OnlineFixed {
  readonly reason?: string;
  readonly reasonAt?: number | null;
  readonly act?: string;
  readonly aside?: string | null;
  readonly asideAt?: number | null;
  readonly asideBy?: string | null;
}

/** One row before the decision: its facts and what a scenario fixed. */
export interface OnlineRow {
  readonly facts: OnlineFacts;
  readonly fixed: OnlineFixed | null;
}

/** A scenario's item (`online` control op): a fan id and any field of the hub's item; `seenAgoMs` / `onlineAgoMs` follow the hub's clock. */
export type OnlineSeed = { readonly fanRef: string; readonly seenAgoMs?: number; readonly onlineAgoMs?: number } & Partial<Omit<OnlineItem, 'fanRef' | 'subscription'>> & {
    readonly subscription?: Partial<OnlineItem['subscription']>;
  };

/** The keys a scenario's item may carry (the control op refuses any other). */
export const ONLINE_SEED_KEYS: ReadonlySet<string> = new Set([
  'fanRef', 'seenAgoMs', 'onlineAgoMs', 'conversationRef', 'username', 'displayName', 'alias', 'greetingName', 'lifetimeGrossMills', 'last30dGrossMills', 'seenAt', 'onlineSince', 'seenSource',
  'reason', 'reasonAt', 'act', 'aside', 'asideAt', 'asideBy', 'messageCount', 'lastFanMessageAt', 'lastPageMessageAt', 'subscription',
]);

/** Another chatter «в разговоре» with a fan: their names, the newest send (the fake's in-conversation). */
export interface OthersTalking {
  readonly names: readonly string[];
  readonly lastSentAt: number;
}

const ok = <T>(body: T): Read<T> => ({ ok: true, body });
const parsed = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};
const isoOrNull = (at: number | null): string | null => (at === null ? null : iso(at));

/** An OnlyFans id the platform gave for a name («u285080777»): no name. */
const AUTO_NAME = /^u\d+$/i;

/**
 * The name a guide's text puts instead of «love» (hub `greetingNameOf`): the first word of letters of the display
 * name, else of the username, 2 to 20 letters, capitalised; null — «love» stays.
 */
export function greetingNameOf(displayName: string | null, username: string | null): string | null {
  for (const value of [displayName, username]) {
    const text = value?.trim() ?? '';
    if (text === '' || AUTO_NAME.test(text)) continue;
    const word = /\p{L}+/u.exec(text)?.[0] ?? null;
    if (word !== null && word.length >= 2 && word.length <= 20) return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}

/** Why to write now (hub `reasonOf`). */
export function onlineReasonOf(facts: OnlineFacts, now: number): { readonly reason: string; readonly reasonAt: number | null } {
  const fan = facts.lastFanMessageAt;
  const answered = facts.answeredAt;
  if (fan !== null && fan > now - ONLINE_RULES.waitingDays * DAY && (answered === null || fan > answered)) return { reason: 'waiting', reasonAt: fan };
  const started = facts.startedAt;
  if (started !== null && started > now - ONLINE_RULES.newDays * DAY && (answered === null || answered <= started + ONLINE_RULES.welcomeMinutes * MINUTE)) return { reason: 'new_unattended', reasonAt: started };
  const ends = facts.endsAt;
  if (ends !== null && facts.autoRenew === false && ends > now && ends <= now + ONLINE_RULES.expiringDays * DAY) return { reason: 'expiring', reasonAt: ends };
  const quietSince = now - ONLINE_RULES.silentDays * DAY;
  if (fan !== null) {
    const lastEither = answered === null ? fan : Math.max(fan, answered);
    return lastEither <= quietSince ? { reason: facts.lifetimeGrossMills >= ONLINE_RULES.payerMinGrossMills ? 'silent' : 'quiet', reasonAt: fan } : { reason: 'none', reasonAt: null };
  }
  if (answered === null || answered <= quietSince) return { reason: 'never_wrote', reasonAt: started };
  return { reason: 'none', reasonAt: null };
}

/** With what (hub `actOf`): Reply, Hi, Ping from 10 messages, below that a text of the guide. */
export function onlineActOf(reason: string, messageCount: number): string {
  switch (reason) {
    case 'waiting':
      return 'reply';
    case 'new_unattended':
      return 'hi';
    case 'expiring':
    case 'silent':
    case 'quiet':
      return messageCount >= ONLINE_RULES.pingMinMessages ? 'ping' : 'template_a';
    case 'never_wrote':
      return 'template_b';
    default:
      return 'none';
  }
}

const reasonOrder = (reason: string): number => {
  const at = (ONLINE_REASONS as readonly string[]).indexOf(reason);
  return at < 0 ? ONLINE_REASONS.length : at;
};

/** The hub's order (`onlineRank`): the most urgent reason, the offered before the set aside, the fresh, the paid, the newest. */
function rank(a: { readonly item: OnlineItem; readonly fresh: boolean }, b: { readonly item: OnlineItem; readonly fresh: boolean }): number {
  const seen = (item: OnlineItem): number => parsed(item.seenAt) ?? 0;
  return (
    reasonOrder(a.item.reason) - reasonOrder(b.item.reason) ||
    Number(a.item.aside !== null) - Number(b.item.aside !== null) ||
    Number(b.fresh) - Number(a.fresh) ||
    b.item.lifetimeGrossMills - a.item.lifetimeGrossMills ||
    seen(b.item) - seen(a.item)
  );
}

/** The facts of a scenario's item at `now` (`seenAgoMs` and `onlineAgoMs` count back from it). */
export function seedRow(page: FakePage, seed: OnlineSeed, now: number): OnlineRow {
  const subscription = seed.subscription ?? {};
  const facts: OnlineFacts = {
    fanRef: seed.fanRef,
    conversationRef: seed.conversationRef === undefined ? (CHAT_IS_FAN[page.platform] ? seed.fanRef : null) : seed.conversationRef,
    username: seed.username ?? null,
    displayName: seed.displayName ?? null,
    alias: seed.alias ?? null,
    lifetimeGrossMills: seed.lifetimeGrossMills ?? 0,
    last30dGrossMills: seed.last30dGrossMills ?? 0,
    seenAt: seed.seenAgoMs === undefined ? (seed.seenAt === undefined ? now - 2 * MINUTE : parsed(seed.seenAt)) : now - seed.seenAgoMs,
    onlineSince: seed.onlineAgoMs === undefined ? parsed(seed.onlineSince) : now - seed.onlineAgoMs,
    seenSource: seed.seenSource === undefined ? (page.platform === 'onlyfans' ? ONLINE_SEEN_SOURCES.ofapi : ONLINE_SEEN_SOURCES.fanslyFollowers) : seed.seenSource,
    lastFanMessageAt: parsed(seed.lastFanMessageAt),
    answeredAt: parsed(seed.lastPageMessageAt),
    isSubscriber: subscription.isSubscriber ?? true,
    startedAt: parsed(subscription.startedAt),
    endsAt: parsed(subscription.endsAt),
    autoRenew: subscription.autoRenew ?? null,
    messageCount: seed.messageCount ?? 0,
  };
  const fixed: OnlineFixed = {
    ...(seed.reason === undefined ? {} : { reason: seed.reason }),
    ...(seed.reasonAt === undefined ? {} : { reasonAt: parsed(seed.reasonAt) }),
    ...(seed.act === undefined ? {} : { act: seed.act }),
    ...(seed.aside === undefined ? {} : { aside: seed.aside }),
    ...(seed.asideAt === undefined ? {} : { asideAt: parsed(seed.asideAt) }),
    ...(seed.asideBy === undefined ? {} : { asideBy: seed.asideBy }),
  };
  return { facts, fixed };
}

/** What `list` reads besides the model's own state. */
export interface OnlineWorld {
  /** The stand's fans of the page, for a page no scenario listed (the board's first rows, with their stories). */
  readonly stand: () => readonly OnlineFacts[];
  /** A fan of the page the fake knows (a Fansly follower the tabs reported but the board does not have): his facts, or null. */
  readonly known: (fanRef: string) => OnlineFacts | null;
  /** Other chatters «в разговоре» with the page's fans, by fan. */
  readonly others: ReadonlyMap<string, OthersTalking>;
}

export class OnlineModel {
  /** A scenario's list of a page: its items and templates (absent — the stand's fans, the guide). */
  private readonly lists = new Map<string, { items?: readonly OnlineSeed[]; templates?: readonly OnlineTemplate[] }>();
  /** When Fansly saw each follower, as the tabs reported it: by page, then fan (moves forward only). */
  private readonly presence = new Map<string, Map<string, number>>();
  private readonly reports: FakeOnlinePresenceReport[] = [];
  private readonly attempts: FakeOnlineAttempt[] = [];

  /** A scenario's list of a page; `null` — back to the stand's fans (items) or the guide (templates); absent — as it was. */
  set(pageLabel: string, set: { readonly items?: readonly OnlineSeed[] | null; readonly templates?: readonly OnlineTemplate[] | null }): void {
    const current = { ...this.lists.get(pageLabel) };
    if (set.items === null) delete current.items;
    else if (set.items !== undefined) current.items = set.items.map((item) => ({ ...item }));
    if (set.templates === null) delete current.templates;
    else if (set.templates !== undefined) current.templates = set.templates.map((template) => ({ ...template }));
    this.lists.set(pageLabel, current);
  }

  /** The rows of a page before the decision: a scenario's items, else the stand's fans and the followers the tabs reported. */
  private rows(page: FakePage, world: OnlineWorld, now: number): OnlineRow[] {
    const items = this.lists.get(page.pageLabel)?.items;
    if (items !== undefined) return items.map((seed) => seedRow(page, seed, now));
    const rows = world.stand().map((facts) => ({ facts, fixed: null }));
    const listed = new Set(rows.map((row) => row.facts.fanRef));
    for (const fanRef of this.presence.get(page.pageLabel)?.keys() ?? []) {
      if (listed.has(fanRef)) continue;
      const facts = world.known(fanRef);
      if (facts !== null) rows.push({ facts, fixed: null });
    }
    return rows;
  }

  /** The fan is one of the page's: on its list now, or reported by its tabs. */
  listed(page: FakePage, world: OnlineWorld, fanRef: string, now: number): boolean {
    return this.rows(page, world, now).some((row) => row.facts.fanRef === fanRef) || (this.presence.get(page.pageLabel)?.has(fanRef) ?? false);
  }

  /** As the hub's `clientOnline`. */
  list(page: FakePage, minutes: number, world: OnlineWorld, now: number): OnlineList {
    const reported = this.presence.get(page.pageLabel);
    const since = now - minutes * MINUTE;
    const fresh = now - ONLINE_RULES.freshMinutes * MINUTE;
    const items = this.rows(page, world, now)
      .map(({ facts, fixed }) => {
        // A tab's report moves the fan's moment forward (never back).
        const at = reported?.get(facts.fanRef);
        const seen: OnlineFacts = at !== undefined && (facts.seenAt === null || at > facts.seenAt) ? { ...facts, seenAt: at, seenSource: ONLINE_SEEN_SOURCES.fanslyExtension } : facts;
        return { item: this.decide(page, seen, fixed, world.others.get(facts.fanRef) ?? null, now), facts: seen };
      })
      .filter(({ facts }) => facts.onlineSince !== null || (facts.seenAt !== null && facts.seenAt >= since))
      .map(({ item, facts }) => ({ item, fresh: facts.onlineSince !== null || (facts.seenAt !== null && facts.seenAt > fresh) }))
      .sort(rank)
      .slice(0, ONLINE_RULES.maxItems)
      .map(({ item }) => item);
    const templates = this.lists.get(page.pageLabel)?.templates ?? ONLINE_TEMPLATES;
    return { pageLabel: page.pageLabel, minutes, items, templates: templates.map((template) => ({ ...template })), serverNow: iso(now) };
  }

  /** One row as the hub answers it: its reason and act (as fixed, else by the rules), and why it is set aside now. */
  private decide(page: FakePage, facts: OnlineFacts, fixed: OnlineFixed | null, others: OthersTalking | null, now: number): OnlineItem {
    const decided = onlineReasonOf(facts, now);
    const reason = fixed?.reason ?? decided.reason;
    const reasonAt = fixed?.reason === undefined ? decided.reasonAt : (fixed.reasonAt ?? null);
    const act = fixed?.act ?? onlineActOf(reason, facts.messageCount);
    const aside = this.asideOf(page, facts, fixed, reason, others, now);
    return {
      fanRef: facts.fanRef,
      conversationRef: facts.conversationRef,
      username: facts.username,
      displayName: facts.displayName,
      alias: facts.alias,
      greetingName: greetingNameOf(facts.displayName, facts.username),
      lifetimeGrossMills: facts.lifetimeGrossMills,
      last30dGrossMills: facts.last30dGrossMills,
      seenAt: isoOrNull(facts.seenAt),
      onlineSince: isoOrNull(facts.onlineSince),
      seenSource: facts.seenSource,
      reason,
      reasonAt: isoOrNull(reasonAt),
      act,
      aside: aside.aside,
      asideAt: isoOrNull(aside.asideAt),
      asideBy: aside.asideBy,
      messageCount: Math.min(10, facts.messageCount),
      lastFanMessageAt: isoOrNull(facts.lastFanMessageAt),
      lastPageMessageAt: isoOrNull(facts.answeredAt),
      subscription: { isSubscriber: facts.isSubscriber, startedAt: isoOrNull(facts.startedAt), endsAt: isoOrNull(facts.endsAt), autoRenew: facts.autoRenew },
    };
  }

  /**
   * Why the fan is set aside now, in the hub's order: «Не предлагать» (its latest mark; an undo clears a scenario's
   * too), the platform's «cannot be written to», another chatter «в разговоре», what a scenario fixed, the page wrote
   * within 48 hours (the rules' rows), the window wrote and he did not answer since (21 days).
   */
  private asideOf(page: FakePage, facts: OnlineFacts, fixed: OnlineFixed | null, reason: string, others: OthersTalking | null, now: number): { readonly aside: string | null; readonly asideAt: number | null; readonly asideBy: string | null } {
    const none = { aside: null, asideAt: null, asideBy: null };
    const mine = this.attempts.filter((attempt) => attempt.pageLabel === page.pageLabel && attempt.fanRef === facts.fanRef);
    const mark = mine.filter((attempt) => attempt.action === 'dismissed' || attempt.action === 'restored').at(-1);
    if (mark?.action === 'dismissed') return { aside: 'dismissed', asideAt: mark.at, asideBy: mark.by };
    const given = fixed?.aside === undefined || (fixed.aside === 'dismissed' && mark?.action === 'restored') ? null : { aside: fixed.aside, asideAt: fixed.asideAt ?? null, asideBy: fixed.asideBy ?? null };
    if (given !== null && (given.aside === 'dismissed' || given.aside === 'unreachable')) return given;
    if (others !== null) return { aside: 'in_conversation', asideAt: others.lastSentAt, asideBy: others.names.join(', ') };
    if (given !== null && given.aside !== null) return given;
    const sent = mine.filter((attempt) => attempt.action === 'sent').at(-1);
    if (fixed?.reason === undefined && reason !== 'waiting' && reason !== 'none' && facts.answeredAt !== null && facts.answeredAt > now - ONLINE_RULES.wroteRecentlyHours * HOUR && (sent === undefined || sent.at < facts.answeredAt)) {
      return { aside: 'wrote_recently', asideAt: facts.answeredAt, asideBy: null };
    }
    if (sent !== undefined && sent.at > now - ONLINE_RULES.attemptCooldownDays * DAY && (facts.lastFanMessageAt === null || facts.lastFanMessageAt < sent.at)) return { aside: 'attempted_recently', asideAt: sent.at, asideBy: null };
    return none;
  }

  /**
   * As the hub's `clientOnlinePresence`: a Fansly page's alone (an OnlyFans page's is OnlyFansAPI's: 409
   * `platform_unsupported`). Each fan once, his newest moment; a moment more than a minute ahead is not kept, one
   * within it is now. Every reported follower is the page's here (module comment).
   */
  report(page: FakePage, userId: number, request: OnlinePresenceRequest, now: number): Read<OnlinePresenceResult> {
    if (page.platform !== 'fansly') return { ok: false, refusal: { error: 'client_feature_disabled', reason: 'platform_unsupported' } };
    const latest = new Map<string, number>();
    for (const entry of request.seen) {
      const at = Date.parse(entry.lastSeenAt);
      if (Number.isNaN(at) || at > now + ONLINE_RULES.presenceSkewMs) continue;
      latest.set(entry.fanRef, Math.max(latest.get(entry.fanRef) ?? -Infinity, Math.min(at, now)));
    }
    const kept = this.presence.get(page.pageLabel) ?? new Map<string, number>();
    for (const [fanRef, at] of latest) kept.set(fanRef, Math.max(kept.get(fanRef) ?? -Infinity, at));
    this.presence.set(page.pageLabel, kept);
    this.reports.push({ pageLabel: page.pageLabel, userId, seen: [...latest].map(([fanRef, at]) => ({ fanRef, lastSeenAt: iso(at) })), at: now });
    return ok({ recorded: latest.size, skipped: request.seen.length - latest.size, serverNow: iso(now) });
  }

  /** As the hub's `clientOnlineAttempt`: a fan of the page (else 409 `not_listed`), journaled under the caller. */
  attempt(page: FakePage, userId: number, by: string, request: OnlineAttemptRequest, linked: boolean, now: number): Read<OnlineAttemptResult> {
    if (!linked) return { ok: false, refusal: { error: 'conflict', reason: 'not_listed' } };
    const sent = request.action === 'sent';
    const attempt: FakeOnlineAttempt = {
      attemptId: this.attempts.length + 1,
      pageLabel: page.pageLabel,
      fanRef: request.fanRef,
      userId,
      by,
      action: request.action,
      act: sent ? (request.act ?? null) : null,
      templateId: sent && request.act === 'template' ? (request.templateId ?? null) : null,
      reason: request.reason ?? null,
      at: now,
    };
    this.attempts.push(attempt);
    return ok({ attemptId: attempt.attemptId });
  }

  /** Every action of the window, in order (tests and the status read them). */
  attemptRows(): readonly FakeOnlineAttempt[] {
    return [...this.attempts];
  }

  /** Every presence report kept, in order. */
  presenceReports(): readonly FakeOnlinePresenceReport[] {
    return [...this.reports];
  }
}
