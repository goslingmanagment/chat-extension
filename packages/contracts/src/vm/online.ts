// «Онлайн» (2026-10-26, the owner's demo became the window): the page's fans who came online, why to write to each now,
// and a fast pass through them, one click per fan. On the left — the fans by why (who waits for an answer, the new
// nobody greeted, an ending subscription, the payer who went quiet, the free fan who went quiet, the fan who never
// wrote), the freshest and the richest first; on the right — the chosen fan's card: why now, their conversation from
// the hub's archive (the chat is not opened and stays unread), and the text that would go — Reply, Hi or Ping written
// by the AI, or a text of the team's reactivation guide word for word — written only when the person picks one on the
// card (2026-10-26, the owner: nothing is written by itself; the hub's advice is marked). «Отправить →» sends it and
// opens the next fan. Nothing goes by itself: one click — one message (X8 on ChatSpace, the
// background's send on Fansly), every «Отправить» rests half a second after a click, «Неизвестно, ушло ли» is never
// sent again by our button. A fan another chatter talks to, one the page wrote to lately, one written to from here in
// the last three weeks, one marked «Не предлагать» is set aside, never hidden: «Все онлайн» shows them and a click may
// still write.
//
// Who is online and why is the hub's (`clientOnline`): OnlyFansAPI's presence on OnlyFans, the creator's followers
// list read from the tab on Fansly. The card is the fan's preview (`preview` from `online`).

import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type TargetHandle } from './selectors';
import { type DataStamp, type VmView } from './view';
import { type OutreachMediaVM, type OutreachSendVM, type OutreachWarningVM } from './outreach';

import { type OnlineChoice, type OnlinePeriod, type OnlineTab } from './online-ids';

export * from './online-ids';
/** The list's groups, in its order; `aside` — «Не предлагаем», `none` — «Без повода» (both under «Все онлайн» only). */
export const ONLINE_GROUPS = ['waiting', 'new', 'expiring', 'silent', 'quiet', 'never', 'none', 'aside'] as const;
export type OnlineGroupId = (typeof ONLINE_GROUPS)[number];

/**
 * How a fan of the window stands: `idle` — no text yet; `writing` — the AI writes it; `unwritten` — the AI failed
 * (`code`); `ready` — the text waits for the click; `sending`, `accepted` — on its way («Принято ChatSpace»); `sent`;
 * `failed` — not sent (`code`; a new click may try again when `send` says so); `uncertain` — it left and its fate is
 * unknown: never sent again by our button, the person looks in the chat.
 */
export const ONLINE_FAN_STATES = ['idle', 'writing', 'unwritten', 'ready', 'sending', 'accepted', 'sent', 'failed', 'uncertain'] as const;
export type OnlineFanState = (typeof ONLINE_FAN_STATES)[number];

/** What writes the fan's text: the AI's Reply, Hi or Ping, or a text of the team's guide; `none` — nothing to write about. */
export const ONLINE_ACTS = ['reply', 'hi', 'ping', 'template', 'none'] as const;
export type OnlineAct = (typeof ONLINE_ACTS)[number];

/** One of the card's «Reply», «Hi», «Ping», «Шаблон»: a click writes that text (again, when it is the card's already). */
export interface OnlineChoiceVM {
  readonly act: OnlineChoice;
  /** The hub's advice for the fan now («советуем»). */
  readonly suggested: boolean;
  /** The card's text is this one's. */
  readonly current: boolean;
}

/**
 * How fresh the fan's presence is: `now` — the site itself shows the fan online, or active within 10 minutes; `fading` —
 * 10 to 30 minutes ago, or online by OnlyFansAPI's state (its «offline» comes ~30 minutes late); `gone` — longer.
 */
export type OnlinePresence = 'now' | 'fading' | 'gone';

/** Why to write now. */
export type OnlineReasonVM =
  /** The fan wrote last and nobody answered personally: since when. */
  | { readonly kind: 'waiting'; readonly since: IsoTimestamp | null }
  /** The fan answered a message sent from this window: he waits again. */
  | { readonly kind: 'answered'; readonly at: IsoTimestamp | null }
  /** Subscribed lately, nobody greeted. */
  | { readonly kind: 'new'; readonly subscribedAt: IsoTimestamp | null }
  /** The subscription ends soon without renewal. */
  | { readonly kind: 'expiring'; readonly endsAt: IsoTimestamp | null }
  /** Paid and went quiet; `since` — the fan's last message. */
  | { readonly kind: 'silent'; readonly since: IsoTimestamp | null; readonly lifetime: MoneyMills | null }
  /** Never paid, talked before and went quiet. */
  | { readonly kind: 'quiet'; readonly since: IsoTimestamp | null }
  /** Never wrote; `subscribedAt` — since when they are here, if known. */
  | { readonly kind: 'never'; readonly subscribedAt: IsoTimestamp | null }
  /** Nothing to write about now: the conversation goes on, or the page wrote lately. */
  | { readonly kind: 'none'; readonly lastAt: IsoTimestamp | null };

/** Why a fan is set aside — a warning the click may pass, never a block. */
export type OnlineAsideVM =
  /** Another chatter is «в разговоре» with the fan. */
  | { readonly kind: 'talking'; readonly names: string; readonly at: IsoTimestamp | null }
  /** The page wrote to the fan within 48 hours and he did not answer. */
  | { readonly kind: 'wrote'; readonly at: IsoTimestamp | null }
  /** A message went to him from «Онлайн» within three weeks and he did not answer. */
  | { readonly kind: 'tried'; readonly at: IsoTimestamp | null }
  /** «Не предлагать» of someone of the team. */
  | { readonly kind: 'dismissed'; readonly by: string | null; readonly at: IsoTimestamp | null }
  /** The platform says the page cannot write to the fan. */
  | { readonly kind: 'unreachable' };

/** What came back after a send: the fan wrote. */
export interface OnlineRepliedVM {
  readonly at: IsoTimestamp;
  readonly text: string | null;
}

/** A fan of the list. */
export interface OnlineRowVM {
  /** `online:<page>:<fan>`: its card is the preview from `online`. */
  readonly handle: TargetHandle;
  readonly name: string;
  readonly username: string | null;
  /** The site's picture of the fan (Fansly); absent or null — the initial. */
  readonly avatarUrl?: string | null;
  readonly lifetime: MoneyMills | null;
  /** The fan's last activity. */
  readonly seenAt: IsoTimestamp | null;
  /** Online now by OnlyFansAPI's state, since this moment (OnlyFans): «зашёл N мин назад». */
  readonly onlineSince: IsoTimestamp | null;
  /** The site itself shows the fan online right now (ChatSpace's own dot): «в сети». */
  readonly live: boolean;
  readonly presence: OnlinePresence;
  readonly reason: OnlineReasonVM;
  readonly aside: OnlineAsideVM | null;
  readonly act: OnlineAct;
  readonly state: OnlineFanState;
  /** The text as it goes (the person's edit, the AI's or the guide's); null — none yet. */
  readonly version: string | null;
  /** What wrote the text that went; null — nothing went. */
  readonly sentAct: OnlineAct | null;
  readonly sentAt: IsoTimestamp | null;
  /** «Пропущен» in this pass (S): back with «Вернуть». */
  readonly skipped: boolean;
  readonly selected: boolean;
  /** Came online while the window was open: the row lights up a moment. */
  readonly arrived: boolean;
  readonly replied: OnlineRepliedVM | null;
  readonly code: string | null;
}

/** The chosen fan: why now, their conversation (the preview's feed), the text that would go and its «Отправить →». */
export interface OnlineCardVM {
  readonly handle: TargetHandle;
  readonly name: string;
  readonly username: string | null;
  readonly avatarUrl?: string | null;
  readonly lifetime: MoneyMills | null;
  /** Spent in the last 30 days; null or 0 — nothing. */
  readonly last30: MoneyMills | null;
  readonly seenAt: IsoTimestamp | null;
  readonly onlineSince: IsoTimestamp | null;
  readonly live: boolean;
  readonly presence: OnlinePresence;
  /** The subscription as the hub knows it; null — not a subscriber now. */
  readonly subscription: { readonly startedAt: IsoTimestamp | null; readonly endsAt: IsoTimestamp | null; readonly autoRenew: boolean | null } | null;
  readonly reason: OnlineReasonVM;
  readonly aside: OnlineAsideVM | null;
  /** The act of the card's text: the person's pick, else the hub's advice; `none` — neither. */
  readonly act: OnlineAct;
  /** The hub's advice for the fan now; null — nothing to write about. */
  readonly advice: OnlineChoice | null;
  /** «Reply», «Hi», «Ping» and, where the guide has texts, «Шаблон» (held while a text is written); empty — the text went. */
  readonly choices: readonly OnlineChoiceVM[];
  /**
   * A text of the team's guide: its id, its group (A — talked before, B — never wrote), whether the fan's name stands in
   * it in place of «love» (null — the text has no «love»).
   */
  readonly template: { readonly id: string; readonly group: 'a' | 'b'; readonly named: boolean | null; readonly greeting: string | null } | null;
  readonly state: OnlineFanState;
  readonly version: string | null;
  readonly edited: boolean;
  /** The person may change the text now (it has not started to go). */
  readonly editable: boolean;
  /** «Ещё раз» (the AI writes again) or «Другой шаблон» (the next text of the guide). */
  readonly rewrite: boolean;
  readonly send: OutreachSendVM | null;
  readonly warning: OutreachWarningVM | null;
  /** What goes with the text: media the person picked for the fan on another card of theirs; null — the text alone. */
  readonly media: OutreachMediaVM | null;
  /** The archive's time the text was written by: «по архиву на 19:12». */
  readonly archiveAt: IsoTimestamp | null;
  readonly sentAt: IsoTimestamp | null;
  readonly clickedAt: IsoTimestamp | null;
  readonly failedAt: IsoTimestamp | null;
  readonly code: string | null;
  readonly replied: OnlineRepliedVM | null;
  readonly skipped: boolean;
  /** «Не предлагать», or «Вернуть» while the fan is marked so. */
  readonly dismiss: 'dismiss' | 'restore';
  /** Fansly: no chat with the creator yet; Fansly makes one when the message goes. */
  readonly noChat: boolean;
  /** «Дальше: Daniel →» after a send: the next fan to write to; null — none left. */
  readonly next: { readonly handle: TargetHandle; readonly name: string } | null;
}

export interface OnlineGroupVM {
  readonly id: OnlineGroupId;
  /** Fans of the group not done in this pass. */
  readonly left: number;
  readonly rows: readonly OnlineRowVM[];
}

/** The pass is done: what went, who answered — once nobody is left to write to. */
export interface OnlineEndVM {
  readonly sent: readonly { readonly handle: TargetHandle; readonly name: string }[];
  readonly skipped: number;
  readonly replied: readonly { readonly handle: TargetHandle; readonly name: string }[];
}

export interface OnlineWindowVM {
  /** The hub's list: `loading`, `error` with «Повторить», `empty` — nobody online. */
  readonly view: VmView;
  readonly pageName: string | null;
  /** The creator's handle where the site has one («@lora»); null — none. */
  readonly creator: string | null;
  /** «пишут от имени Lora»; null — no persona known. */
  readonly persona: string | null;
  /** When the list was read: «данные на 19:12». */
  readonly stamp: DataStamp;
    /**
   * Where «who is online» comes from on this page: `hub` — the hub's own presence (OnlyFansAPI), `tab` — the site's page
   * itself, read by the tab once a minute and reported to the hub.
   */
  readonly seenBy: 'hub' | 'tab';
  readonly minutes: OnlinePeriod;
  /** «Зашли за»'s choices with how many fans each holds now. */
  readonly periods: readonly { readonly minutes: OnlinePeriod; readonly count: number }[];
  readonly tab: OnlineTab;
  readonly tabs: { readonly todo: number; readonly all: number };
  readonly query: string;
  /** The groups of the tab in their order, the search applied. */
  readonly groups: readonly OnlineGroupVM[];
  /** Under «К разбору»: how many online fans are elsewhere — done in this pass, or with no reason or set aside. */
  readonly elsewhere: { readonly done: number; readonly other: number } | null;
  readonly totals: {
    /** Online in the window's minutes. */
    readonly online: number;
    /** Worth a message now and not done: the bar's count. */
    readonly worth: number;
    readonly sent: number;
    readonly skipped: number;
    readonly replied: number;
  };
  readonly card: OnlineCardVM | null;
  readonly end: OnlineEndVM | null;
}
