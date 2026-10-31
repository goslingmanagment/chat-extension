// «Рассылка» (2026-10-25, the owner's pick of the redesign: the twin of «Новые»): a personal mailing to the page's big
// spenders as a window of its own, one on both sites. On the left — who gets it, each fan with their own version of the
// common text (Fix writes it from the fan's name and conversation) and its blue «Отправить»; on the right — the offer
// (the common text and, if wanted, media behind a price), the chosen fan's card (their conversation, then their version
// where the next message would stand) or, once nothing is left to send, what the outreach did. Media are optional:
// text alone is a whole outreach. Nothing goes by itself: one click on one fan's «Отправить» — one message (X8), every
// «Отправить» rests half a second after a click, «Неизвестно, ушло ли» is never sent again by our button.
//
// The window reads what the hub knows (the Spenders board: tiers, sums, who wrote last) and never a chat the person did
// not open; the card is the fan's preview (`preview` from `outreach`).

import { type FanBadges } from '../fan-badges';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type BatchVM } from './batch';
import { type MediaType } from '../send-media';
import { type Msg } from './i18n';
import { type MediaPickerVM } from './media';
import { type TargetHandle } from './selectors';
import { type DataStamp, type VmView } from './view';
import { type OutreachCondition, type OutreachPane, type OutreachTab } from './outreach-ids';

export { OUTREACH_CONDITIONS, OUTREACH_PANES, OUTREACH_TABS, type OutreachCondition, type OutreachPane, type OutreachTab } from './outreach-ids';

/** A tier of «Кому»: a shelf of the board, by its bounds («Whale» $600+), with its fans. */
export interface OutreachTierVM {
  readonly id: string;
  readonly range: { readonly fromMills: MoneyMills | null; readonly toMills: MoneyMills | null };
  readonly fans: number;
  readonly on: boolean;
}

/** Up to three names of fans and how many more: «Mike R и Daniel», «Gordon, Mike R, Steve и ещё 4». */
export interface OutreachNamesVM {
  readonly names: readonly string[];
  readonly more: number;
}

/** What a condition says under its words: who it leaves out, or why it cannot tell yet. */
export type OutreachConditionNoteVM =
  /** `notBought`: these fans bought the paid media already — they will not get the outreach. */
  | { readonly kind: 'bought'; readonly fans: OutreachNamesVM }
  | { readonly kind: 'none-bought' }
  /** `notBought`: the site is asked who bought it. */
  | { readonly kind: 'checking' }
  /** `notBought`: the site did not say (a failed read): nobody is left out by it. */
  | { readonly kind: 'unknown' }
  /** `noWaiting`: these fans wait for an answer — their versions answer them. */
  | { readonly kind: 'waiting'; readonly fans: OutreachNamesVM }
  | { readonly kind: 'none-waiting' }
  /** `noGone` (1.70.0): these fans' accounts are not found — deleted, or the page blocked. */
  | { readonly kind: 'gone'; readonly fans: OutreachNamesVM };

export interface OutreachConditionVM {
  readonly id: OutreachCondition;
  readonly on: boolean;
  /** `spent`: the amount in dollars as typed («1,000»). */
  readonly amount?: string;
  readonly note: OutreachConditionNoteVM | null;
}

/** «Кому»: the tiers and the conditions, and what they make of the board's fans. */
export interface OutreachAudienceVM {
  /** `picked` — the fans ticked in Spenders when the window opened (the tiers wait off); `tiers` — the tiers below. */
  readonly source: 'tiers' | 'picked';
  /** `picked`: how many fans were ticked. */
  readonly picked: number;
  readonly tiers: readonly OutreachTierVM[];
  readonly conditions: readonly OutreachConditionVM[];
  /** Fans who get a version: the ticked fans before the versions are written, then the fans of the outreach. */
  readonly count: number;
  /** What they spent together (lifetime); null — unknown for one of them. */
  readonly spent: MoneyMills | null;
  /** The versions are written: who is in no longer changes (a fan may still be written for one by one). */
  readonly locked: boolean;
}

/** Why a fan of the chosen tiers is not in the outreach («Не войдут»). */
export type OutreachAsideVM =
  /** Bought the paid media of the offer already; `at` — when, if the site said. */
  | { readonly kind: 'bought'; readonly at: IsoTimestamp | null }
  /** Waits for an answer, and «Без тех, кто ждёт ответа» is on. */
  | { readonly kind: 'waiting'; readonly since: IsoTimestamp | null }
  /** Spent not more than the amount of «Потратил больше». */
  | { readonly kind: 'spent'; readonly lifetime: MoneyMills | null; readonly min: MoneyMills }
  /** Neither wrote nor bought in 7 days, and «Писал или покупал за 7 дней» is on. */
  | { readonly kind: 'inactive' }
  /** Taken out by the person after the versions were written. */
  | { readonly kind: 'manual' }
  /** 1.70.0: the site no longer finds the fan's account (deleted, or the page blocked), and «Без удалённых аккаунтов» is on. */
  | { readonly kind: 'gone' };

/**
 * How a fan of the outreach stands: `idle` — no version (not ticked yet, or the versions are not written); `queued`,
 * `writing` — Fix writes it; `stopped` — the writing was stopped before it; `unwritten` — Fix failed (`code`); `ready` —
 * the version waits for the click; `sending`, `accepted` — on its way («Принято ChatSpace»); `sent`; `failed` — not sent
 * (`code`; a new click may try again when `send` says so); `uncertain` — it left and its fate is unknown: never sent
 * again by our button, the person looks in the chat.
 */
export const OUTREACH_FAN_STATES = ['idle', 'queued', 'writing', 'stopped', 'unwritten', 'ready', 'sending', 'accepted', 'sent', 'failed', 'uncertain'] as const;
export type OutreachFanState = (typeof OUTREACH_FAN_STATES)[number];

/** What the version's «Отправить» warns of — a warning the click passes («Отправить всё равно»), never a block. */
export type OutreachWarningVM =
  /** The version was made by the archive with the chat closed: a newer message of the fan cannot be checked. */
  | { readonly kind: 'archive' }
  /** The fan wrote after the version was written: it may not fit any more («Ещё раз» writes a new one). */
  | { readonly kind: 'stale'; readonly at: IsoTimestamp | null }
  /** Another chatter wrote to the fan in the last 15 minutes («в разговоре»). */
  | { readonly kind: 'talking'; readonly names: readonly string[]; readonly at: IsoTimestamp };

/** The row's and the card's «Отправить» of a version. */
export interface OutreachSendVM {
  /** The click goes now. */
  readonly can: boolean;
  /**
   * The words: `send` — «Отправить»; `anyway` — «Отправить всё равно» (a warning the click passes: `warning` of the row
   * says which); `retry` — «Отправить ещё раз» (proven not sent).
   */
  readonly kind: 'send' | 'anyway' | 'retry';
  /** Off only for the half second after a send of the tab. */
  readonly paused: boolean;
  /** Why it is off otherwise (the media's price, the version emptied); null — it is not. */
  readonly reason: Msg | null;
}

/** A medium of an offer or of a fan's own pick, as its square shows it. */
export interface OutreachMediumVM {
  readonly id: string;
  readonly type: MediaType;
  /** Seconds; 0 — a photo. */
  readonly duration: number;
  readonly thumb: string | null;
  /** A free preview (it leads the message); else behind the price. */
  readonly free: boolean;
}

/** The media of the offer, or of one fan: what goes with the version, in the message's order. */
export interface OutreachMediaVM {
  /** Media of the vault, the free previews first. */
  readonly items: readonly OutreachMediumVM[];
  /** Bundles and media copied in the model's posts («Из постов»): each goes as it is, with its post's price and preview. */
  readonly posts: number;
  /** The price of the paid media, cents; 0 — free. */
  readonly priceCents: number;
  /** Why the media cannot go yet (the price); null — they can. */
  readonly problem: Msg | null;
}

/** A fan of the outreach in the list. */
export interface OutreachRowVM {
  /** `outreach:<page>:<fan>`: its card is the preview from `outreach`. */
  readonly handle: TargetHandle;
  /** Fansly: the fan's blue card and FBuddy's gem (contracts fan-badges.ts); absent — none known. */
  readonly badges?: FanBadges;
  readonly name: string;
  readonly username: string | null;
  /** 1.70.0: the site no longer finds the fan's account (deleted, or the page blocked): «удалён» in place of the @handle. */
  readonly gone?: true;
  /** The fan's tier by the board's bounds; null — none takes the fan. */
  readonly tier: OutreachTierVM['range'] | null;
  readonly lifetime: MoneyMills | null;
  /** The site's picture of the fan (Fansly); absent or null — the initial. */
  readonly avatarUrl?: string | null;
  readonly selected: boolean;
  /** Before the versions: ticked to get one; after: the fan is in the outreach. */
  readonly ticked: boolean;
  /** The fan wrote last: since when they wait; null — they do not. */
  readonly waitingSince: IsoTimestamp | null;
  readonly weWroteAt: IsoTimestamp | null;
  /** The archive holds a conversation with the fan. */
  readonly history: boolean;
  readonly state: OutreachFanState;
  /** The version as it goes — the person's edit, else Fix's —; null — none yet. */
  readonly version: string | null;
  /** The person changed the version. */
  readonly edited: boolean;
  /** Written from an older common text: «Текст изменился · Переписать». */
  readonly stale: boolean;
  /** The fan's own media instead of the offer's (picked in their card). */
  readonly ownMedia: boolean;
  /** The row's «Отправить»; null — nothing to send now. */
  readonly send: OutreachSendVM | null;
  /** What its «Отправить» warns of; null — nothing. */
  readonly warning: OutreachWarningVM | null;
  readonly sentAt: IsoTimestamp | null;
  /** `uncertain`: when «Отправить» was clicked. */
  readonly clickedAt: IsoTimestamp | null;
  /** `failed`, `unwritten`: the code (a shared CG code or the site's own). */
  readonly code: string | null;
  /** After the send, with paid media: the fan bought them. */
  readonly bought: { readonly mills: MoneyMills | null; readonly at: IsoTimestamp | null } | null;
  /** After the send: the fan wrote back; `text` — the first message, if the archive has it. */
  readonly replied: { readonly at: IsoTimestamp; readonly text: string | null } | null;
  /** «Не войдут»: why the fan is not in the outreach (the first reason leads). Absent — the fan is in. */
  readonly aside?: readonly OutreachAsideVM[];
}

/** The fan's version on the card: what goes, with what, and the way it goes. */
export interface OutreachCardVM {
  readonly handle: TargetHandle;
  readonly name: string;
  readonly state: OutreachFanState;
  readonly version: string | null;
  readonly edited: boolean;
  /** The person may change the version now (it has not started to go). */
  readonly editable: boolean;
  /** «Ещё раз»: another version for this fan now. */
  readonly rewrite: boolean;
  /** What goes with the version: the offer's or the fan's own; null — text only. */
  readonly media: OutreachMediaVM | null;
  readonly ownMedia: boolean;
  /** The site can pick media for one fan («Другие медиа для …»). */
  readonly canPickMedia: boolean;
  readonly send: OutreachSendVM | null;
  readonly warning: OutreachWarningVM | null;
  /** The archive's time the version was made by (`warning` `archive`): «версия по архиву на 19:12». */
  readonly archiveAt: IsoTimestamp | null;
  readonly sentAt: IsoTimestamp | null;
  readonly clickedAt: IsoTimestamp | null;
  readonly failedAt: IsoTimestamp | null;
  readonly code: string | null;
  readonly bought: OutreachRowVM['bought'];
  readonly replied: OutreachRowVM['replied'];
  /** «Дальше: Daniel →» after a send: the next version that can go by a click (or is being written); null — none. */
  readonly next: { readonly handle: TargetHandle; readonly name: string } | null;
  readonly aside?: readonly OutreachAsideVM[];
}

/** One line of the end's lists. */
export interface OutreachSummaryFanVM {
  readonly handle: TargetHandle;
  readonly name: string;
  readonly avatarUrl?: string | null;
  /** When the version went (or «Отправить» was clicked, for an unknown outcome). */
  readonly at: IsoTimestamp | null;
}

/** A fan of the outreach whose version did not go: why — the send's reason, or the version's state. */
export interface OutreachSummaryLeftVM extends OutreachSummaryFanVM {
  readonly state: OutreachFanState;
  /** Why «Отправить» cannot go from here (the open chat, a fan who takes no messages); null — the state says it. */
  readonly reason: Msg | null;
}

/** «Итог рассылки»: what went, what came of it, what to check — once nothing more can go by a click (or asked for). */
export interface OutreachSummaryVM {
  /** The first and the last send. */
  readonly from: IsoTimestamp | null;
  readonly to: IsoTimestamp | null;
  readonly sent: number;
  /** Fans the outreach was for. */
  readonly total: number;
  /** «Проверьте в чате»: unknown outcomes. */
  readonly check: readonly OutreachSummaryFanVM[];
  /** With paid media: who bought, with the sum; null — the offer had no paid media. */
  readonly bought: { readonly mills: MoneyMills; readonly fans: readonly (OutreachSummaryFanVM & { readonly mills: MoneyMills | null; readonly boughtAt: IsoTimestamp | null })[] } | null;
  /** Text only: who wrote back; null — the offer had paid media (purchases say it). */
  readonly replied: readonly (OutreachSummaryFanVM & { readonly text: string | null; readonly repliedAt: IsoTimestamp })[] | null;
  /** Sent and nothing came yet: «Отправлено, пока не купили» / «…не ответили». */
  readonly quiet: readonly OutreachSummaryFanVM[];
  /** Fans of the outreach whose version did not go, with why: «Не ушло». */
  readonly left: readonly OutreachSummaryLeftVM[];
  /** Fans of the chosen tiers who were not written to, with why. */
  readonly skipped: readonly { readonly name: string; readonly reason: OutreachAsideVM }[];
}

/** The window minimized: the chip in the page's corner. */
export interface OutreachChipVM {
  /** «Dragon 6:12» / «только текст». */
  readonly media: OutreachMediaVM | null;
  readonly sent: number;
  readonly total: number;
  readonly ready: number;
  readonly boughtMills: MoneyMills | null;
}

export interface OutreachWindowVM {
  /** The board the audience comes from: `loading`, `error` with «Повторить», `empty` — nobody paid yet. */
  readonly view: VmView;
  readonly pageName: string | null;
  /** The creator's handle where the site has one («@lora» on Fansly); null — none. */
  readonly creator: string | null;
  /** «Fix пишет от имени Lora»; null — no persona known. */
  readonly persona: string | null;
  /** The board's time: «данные на 19:12». */
  readonly stamp: DataStamp;
  /** The window is minimized to the chip; null — it is not. */
  readonly chip: OutreachChipVM | null;
  readonly text: string;
  readonly maxChars: number;
  /** The common text changed after the versions were written: when. */
  readonly textChangedAt: IsoTimestamp | null;
  /** The offer's media; null — text only. */
  readonly media: OutreachMediaVM | null;
  /** The site can pick media for the outreach («+ Добавить медиа»). */
  readonly canPickMedia: boolean;
  readonly audience: OutreachAudienceVM;
  readonly tab: OutreachTab;
  readonly tabs: { readonly todo: number; readonly all: number };
  readonly query: string;
  /** The fans of the list in their order (the search applied). */
  readonly rows: readonly OutreachRowVM[];
  /** «Не войдут»: the chosen tiers' fans left out, with why. */
  readonly aside: readonly OutreachRowVM[];
  /** The versions' queue: «Написать N версий», how far it got. */
  readonly batch: BatchVM;
  /** The foot's totals once a version went. */
  readonly totals: {
    readonly sent: number;
    readonly failed: number;
    readonly uncertain: number;
    readonly ready: number;
    /** Fans whose version is written (whatever happened to it since). */
    readonly written: number;
    /** Fans whose writing «Остановить» stopped before their turn. */
    readonly stopped: number;
    readonly total: number;
    readonly boughtMills: MoneyMills | null;
    readonly replied: number;
  };
  /** «Текст изменился · Переписать N»: versions written from an older text that have not gone. */
  readonly stale: number;
  /** The pane on the right while no fan is chosen. */
  readonly pane: OutreachPane;
  /** The chosen fan's version (the card's lower half); null — no fan chosen. */
  readonly card: OutreachCardVM | null;
  /** Nothing is left to send and something went; null — not yet. */
  readonly summary: OutreachSummaryVM | null;
  /**
   * The outreach's media sheet over the window is open; null — closed (a fan's own sheet is their card's preview media).
   * `vault` — the site's vault picker (`picker`); `posts` — the page's «Copied …» list (`posts`).
   */
  readonly sheet: 'vault' | 'posts' | null;
  /** The vault picker of the outreach's sheet while open; null — closed, or no vault on this site. */
  readonly picker: MediaPickerVM | null;
  /**
   * Fansly: the page's «Copied …» list — bundles and media copied in the model's posts — as «Из постов»: how it was read,
   * and each item picked or not; null — the site has no such list.
   */
  readonly posts: OutreachPostsVM | null;
  /** 1.71.0: the page's outreaches kept on this computer, newest first («Рассылки» in the head); the window's own among them. */
  readonly saved: readonly OutreachSavedVM[];
}

/**
 * 1.71.0 (Dmitriy, 2026-11-01: «локально хранить состояние всех рассылок, чтобы можно было к любой вернуться с того же
 * момента»): an outreach of the page kept on this computer, as the list in the window's head shows it.
 */
export interface OutreachSavedVM {
  readonly id: string;
  /** The window's outreach now. */
  readonly current: boolean;
  /** The common text, as it was; '' — none yet. */
  readonly text: string;
  readonly startedAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Fans the outreach is for (0 — its versions are not written yet). */
  readonly total: number;
  readonly sent: number;
  readonly replied: number;
  readonly boughtMills: MoneyMills | null;
  /** It goes with media. */
  readonly media: boolean;
}

/** An item of the page's «Copied …» list: 2 — «Copied Bundle», 1 — «Copied Media». */
export interface OutreachPostVM {
  readonly contentType: 1 | 2;
  readonly contentId: string;
  readonly picked: boolean;
}

export interface OutreachPostsVM {
  /**
   * `reading` — read, and the site asked which «Copied Media» are bundles (its own reload files copied bundles there);
   * `checked` — the kinds are the site's word; `unchecked` — it did not answer: a «Copied Media» may be a bundle.
   */
  readonly state: 'reading' | 'checked' | 'unchecked';
  readonly items: readonly OutreachPostVM[];
}
