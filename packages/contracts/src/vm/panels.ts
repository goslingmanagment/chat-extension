// Side panel, palette, quick jump, cheatsheet and toasts (architecture.md
// §9.1, §9.5, §10.2; ui-design §4.18, §4.20–§4.22). Every row that does
// something carries the UiAction the controller prepared; the UI dispatches
// it unchanged.

import { type CgCode, type CgErrorView } from '../errors';
import { type SPENDER_RETENTION_STATUSES } from '../hub/spenders';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type UiAction } from './actions';
import { type HotkeyLabel, type HotkeyPlatform, type ReasonVM } from './catalog';
import { type Msg } from './i18n';
import { type ToastId } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

/**
 * The hub's retention status of the fan's board row (`spenders` v2) → the
 * panel's «Риск ухода»; null when the board has no row for the fan.
 */
export const CHURN_RISK_BY_RETENTION = {
  active: 'low',
  cooling: 'medium',
  inactive: 'high',
  needs_reactivation: 'high',
} as const satisfies Record<(typeof SPENDER_RETENTION_STATUSES)[number], 'low' | 'medium' | 'high'>;

/**
 * The fan panel (CS-031…CS-038): who this is, money by kind, subscription,
 * ChatSpace's own scores if in memory, bio, Recap tab. Sources (D-29): money
 * and subscription — `fan.card` (spenderDetail of the target page, 30 days
 * and lifetime); `lastSeenAt`, `online`, `host`, `lists` — HostFan, only
 * what ChatSpace already holds; `churnRisk` — CHURN_RISK_BY_RETENTION; `bio`
 * — the hub's profile of the fan (`fan.dossier`, CS-035), with ChatSpace's
 * own «О себе» standing in only when the hub has none (`bioSource` says
 * which); the footer's archive coverage — the hub archive of the thread. A
 * missing source is null, never a guess.
 */
/** Chat Memory week 2, «Память»: one page of the person, as the card tells it. */
export interface FanMemoryPageVM {
  readonly pageLabel: string;
  readonly model: string | null;
  /** The person works this page; false — «не ваша»: only the alias, the money and the subscription. */
  readonly mine: boolean;
  /** The team's name for the fan on the page, with its marks (💵, ❌), as it is. */
  readonly alias: string | null;
  readonly spent: MoneyMills;
  readonly last30: MoneyMills;
  readonly subscribed: boolean;
}

/** An account of the person; `linkedBy` — who said «Да» to it (null for the open chat's own). */
export interface FanMemoryAccountVM {
  readonly key: string;
  readonly platform: string;
  readonly name: string | null;
  readonly username: string | null;
  readonly gone: boolean;
  readonly linkedBy: string | null;
}

/** «Похоже, это тот же человек»: an account Hub suggests, why, its pages, and the person's «Да» / «Нет». */
export interface FanMemorySuggestionVM extends FanMemoryAccountVM {
  readonly why: Msg;
  readonly pages: readonly FanMemoryPageVM[];
  readonly same: UiAction;
  readonly different: UiAction;
  /** The decision is on its way: both buttons rest. */
  readonly busy: boolean;
}

/** A fact from the chat. `remove` and `correct` only on a page the person works; `open` — its chat's archive. */
export interface FanMemoryFactVM {
  readonly id: number;
  readonly text: string;
  readonly pageLabel: string;
  readonly at: IsoTimestamp | null;
  /** The chatter who corrected it; null — the AI's. */
  readonly author: string | null;
  readonly mine: boolean;
  readonly open: UiAction | null;
  readonly remove: UiAction | null;
  /** «Исправить» is offered (the UI sends `ChangeFanFact` with the text written). */
  readonly correctable: boolean;
  readonly busy: boolean;
}

export interface FanMemoryVM {
  readonly view: VmView;
  readonly accounts: readonly FanMemoryAccountVM[];
  /** Every page of the person, most paid first. */
  readonly pages: readonly FanMemoryPageVM[];
  readonly suggestions: readonly FanMemorySuggestionVM[];
  /** «О себе», «Обещали», «Договорились» in this order; an empty kind is «не знаю». */
  readonly facts: readonly { readonly kind: 'about' | 'promise' | 'agreement'; readonly items: readonly FanMemoryFactVM[] }[];
  /** The last «Да / Нет» or fact change failed: said once, the card stays as it was. */
  readonly error: CgErrorView | null;
}

export interface FanPanelVM {
  /** 1.15.0 P11a: locally known account registration; absent when this host/owner does not offer it. */
  readonly registration?: { readonly label: string; readonly at: IsoTimestamp };
  /** `empty` — «Выберите чат»; `partial` — some blocks unknown (no dossier, host scores not loaded). */
  readonly view: VmView;
  readonly tab: 'fan' | 'recap' | 'memory';
  /** Chat Memory week 2: «Память» — the person across pages; absent — the hub does not serve the card (no tab). */
  readonly memory?: FanMemoryVM;
  /** Header when no chat is open: «ChatGoose» and the persona label. */
  readonly personaLabel: string | null;
  readonly fan: {
    readonly name: string;
    readonly username: string | null;
    /** Avatars are initials only: no remote images. */
    readonly initials: string;
    readonly lastSeenAt: IsoTimestamp | null;
    readonly online: boolean | null;
  } | null;
  readonly spent: {
    readonly total: MoneyMills | null;
    readonly period30: MoneyMills | null;
    readonly byKind: readonly { readonly kind: 'messages' | 'tips' | 'subscription' | 'posts' | 'other'; readonly mills: MoneyMills | null }[];
  } | null;
  readonly subscription: {
    readonly months: number | null;
    readonly since: IsoTimestamp | null;
    readonly autoRenew: boolean | null;
    readonly churnRisk: 'low' | 'medium' | 'high' | null;
  } | null;
  /** Buying power and ChatSpace's scores, only if ChatSpace already holds them. */
  readonly host: { readonly buyingPower: string | null; readonly scores: readonly { readonly label: string; readonly value: string }[] } | null;
  readonly bio: string | null;
  /**
   * Where `bio` came from (1.2.0): `hub` — the body of the hub's profile of
   * the fan (the saved dossier: a Markdown document, it may be long); `host`
   * — ChatSpace's own «О себе», plain text, shown only while the hub has no
   * profile. Absent — no bio, or a controller that does not say.
   */
  readonly bioSource?: 'hub' | 'host';
  /**
   * 1.20.0 (decision X47): the hub's profile of the fan cut into its headed blocks, as a full Recap is (its sections
   * — «Досье», «Психологический портрет»…, a heading the hub wrote in English capitals named in the reader's
   * language). Only with `bioSource: 'hub'`; absent — the profile is shown as one text.
   */
  readonly bioBlocks?: readonly { readonly heading: string; readonly markdown: string }[];
  /**
   * 1.20.0 (decision X47): the site shows a fan panel of its own next to the chat — the spending summary, the
   * subscription, its own scores, the lists, the profile (ChatSpace 0.195) — and ours shows only what that one
   * lacks: the hub's money by kind, the churn risk, the hub's profile of the fan and Recap. Then `host`, `lists`
   * and ChatSpace's own «О себе» are empty, and of `subscription` only `churnRisk` is drawn. Absent — the whole panel
   * (a site without such a panel: Fansly).
   */
  readonly besideHostPanel?: true;
  readonly lists: readonly string[];
  /** «Данные на 09:18», «архив полный, 412 сообщений». */
  readonly footer: { readonly stamp: DataStamp; readonly archiveMessages: number | null };
  readonly close: UiAction;
}

export type PaletteGroupId = 'actions' | 'running' | 'waiting' | 'chats' | 'accounts' | 'navigation' | 'online';

export interface PaletteItemVM {
  readonly id: string;
  readonly label: string | Msg;
  readonly sublabel: string | null;
  /** Matched ranges of `label` (underlined, strong), as [start, end) pairs. */
  readonly match: readonly (readonly [number, number])[];
  readonly hotkey: HotkeyLabel | null;
  /** «$12,480, ждёт 7 мин» on the right. */
  readonly money: MoneyMills | null;
  readonly waitingSince: IsoTimestamp | null;
  /** A running generation: spinner and «14 с» from here. */
  readonly runningSince: number | null;
  readonly enabled: boolean;
  readonly reason: ReasonVM | null;
  readonly action: UiAction;
}

export interface PaletteVM {
  /** `empty` — nothing matches; `partial` — a source (Spenders, «Новые», the host list) is missing. */
  readonly view: VmView;
  readonly query: string;
  readonly groups: readonly { readonly id: PaletteGroupId; readonly title: Msg; readonly items: readonly PaletteItemVM[] }[];
  /** «Чаты: Spenders и Новые, 43 фана». */
  readonly footer: Msg | null;
}

/** Holding the modifier 400 ms over ⌘1–9 (§9.1). */
export interface QuickJumpVM {
  readonly view: VmView;
  readonly items: readonly {
    readonly slot: number;
    readonly name: string | null;
    readonly username: string | null;
    readonly unread: number | null;
    readonly action: UiAction;
  }[];
}

export interface CheatsheetVM {
  /** `partial` — some combinations are reserved or not yet measured on this browser. */
  readonly view: VmView;
  readonly platform: HotkeyPlatform;
  readonly groups: readonly {
    readonly id: string;
    readonly title: Msg;
    readonly rows: readonly {
      readonly label: Msg;
      readonly hotkey: HotkeyLabel | null;
      /** «пока убран» (⌘⇧H), «нет клавиши» («Отправить»), «браузер не отдаёт». */
      readonly note: Msg | null;
    }[];
  }[];
  readonly note: Msg;
}

export const TOAST_KINDS = ['info', 'success', 'warning', 'error'] as const;
export type ToastKind = (typeof TOAST_KINDS)[number];

export interface ToastVM {
  readonly id: ToastId;
  readonly kind: ToastKind;
  /** First line «ChatGoose · CG-…» of our errors. */
  readonly code: CgCode | null;
  readonly title: string;
  readonly body: string | null;
  /** «Открыть чат», «Настройки» (deep link by code), etc. */
  readonly actions: readonly ActionButtonVM[];
  /** «Скопировать код» through ClipboardPort. */
  readonly copyCode: boolean;
  /** 4.5 s, errors 6.5 s; null while held by hover or focus. */
  readonly expiresAt: number | null;
  /**
   * The error's technical line «HTTP 429 • …» (CgErrorView.detail, at most
   * CG_DETAIL_MAX_CHARS), monospace under the explanation (ER-010). 1.1.0.
   */
  readonly detail?: string;
  /** The error's retry deadline, fixed once (CgErrorView.retryAt, epoch ms): «Повторить можно через 24 с» (ER-010). 1.1.0. */
  readonly retryAt?: number;
}

export interface ToastsVM {
  /** `empty` — none on screen. */
  readonly view: VmView;
  /** Newest first, at most three; same code and scope replace each other (ER-009…ER-015). */
  readonly toasts: readonly ToastVM[];
}
