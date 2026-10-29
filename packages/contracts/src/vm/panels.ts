// Side panel, palette, quick jump, cheatsheet and toasts (architecture.md
// §9.1, §9.5, §10.2; ui-design §4.18, §4.20–§4.22). Every row that does
// something carries the UiAction the controller prepared; the UI dispatches
// it unchanged.

import { type CgCode, type CgErrorView } from '../errors';
import { type SPENDER_RETENTION_STATUSES } from '../hub/spenders';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type QueueTab, type UiAction } from './actions';
import { type HotkeyLabel, type HotkeyPlatform, type ReasonVM } from './catalog';
import { type Msg } from './i18n';
import { type TargetHandle, type ToastId } from './selectors';
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
  /** The message the fact comes from, as Hub archived it — folded under the fact; null — Hub sent none. */
  readonly quote: { readonly text: string; readonly fromFan: boolean; readonly at: IsoTimestamp; readonly media: boolean } | null;
}

/** Chat Memory week 4: a tip of the fan Hub suggests as a custom's payment — «$120 · 2 дня назад · «for my video»». */
export interface FanCustomPaymentVM {
  readonly ref: string;
  readonly amount: MoneyMills;
  readonly at: IsoTimestamp;
  readonly note: string | null;
}

/** Chat Memory week 4: a custom of the person. Buttons only on a page the person works, while it is open. */
export interface FanCustomVM {
  readonly id: number;
  readonly description: string;
  readonly pageLabel: string;
  /** null — a state this build does not know. */
  readonly state: 'ordered' | 'paid' | 'delivered' | 'cancelled' | null;
  readonly price: MoneyMills | null;
  /** What the payment the chatter took for it was. */
  readonly paid: MoneyMills | null;
  readonly paidAt: IsoTimestamp | null;
  readonly deliveredAt: IsoTimestamp | null;
  readonly createdBy: string;
  readonly createdAt: IsoTimestamp;
  /** «Оплачен»: a suggested tip each. */
  readonly payWith: readonly (FanCustomPaymentVM & { readonly action: UiAction })[];
  /** «Отдали»: «это он? 1 видео · вчера» — a suggested message each. */
  readonly deliveredBy: readonly { readonly ref: string; readonly at: IsoTimestamp; readonly mediaCount: number; readonly price: MoneyMills | null; readonly action: UiAction }[];
  readonly cancel: UiAction | null;
  readonly busy: boolean;
}

export interface FanMemoryCustomsVM {
  /** The open first (ordered, then paid, the oldest payment first), then the ended ones of 30 days. */
  readonly items: readonly FanCustomVM[];
  /** Tips of the fan on this page no custom took: what «Записать кастом» may name as the payment. */
  readonly payments: readonly FanCustomPaymentVM[];
  /** «Записать кастом» is offered: a page the person works; a record is on its way — it rests. */
  readonly record: { readonly busy: boolean } | null;
}

export interface FanMemoryVM {
  readonly view: VmView;
  /** The fan of the card shown; absent — none yet. Whatever is being written in the tab is that fan's. */
  readonly fanRef?: string;
  readonly accounts: readonly FanMemoryAccountVM[];
  /** Every page of the person, most paid first. */
  readonly pages: readonly FanMemoryPageVM[];
  readonly suggestions: readonly FanMemorySuggestionVM[];
  /** «О себе», «Обещали», «Договорились» in this order; an empty kind is «не знаю». */
  readonly facts: readonly { readonly kind: 'about' | 'promise' | 'agreement'; readonly items: readonly FanMemoryFactVM[] }[];
  /** Chat Memory week 4: «Кастомы»; absent — the hub does not serve them (`fan-customs-v1`). */
  readonly customs?: FanMemoryCustomsVM;
  /** The last «Да / Нет» or fact change failed: said once, the card stays as it was. */
  readonly error: CgErrorView | null;
}

/**
 * Chat Memory week 3, «Очередь» of the fan panel: a fan of the page of the open tab. `handle` finds the «в разговоре»
 * mark (TalkingMark); `open` opens the fan's chat and leaves the panel as it is.
 */
export interface QueueFanVM {
  readonly key: string;
  readonly handle: TargetHandle;
  /** The team's alias as it is (with 💵 / ❌), else the name, else @username. */
  readonly name: string;
  /** «@username» beside a name that is not it; null — none to add. */
  readonly username: string | null;
  /** Spent on the page in all; null — not said (a known zero is not drawn either). */
  readonly spent: MoneyMills | null;
  readonly open: UiAction | null;
}

/** «Ждут»: the fan wrote last, at `since`; a mass message is no answer. */
export interface QueueWaitingVM extends QueueFanVM {
  readonly since: IsoTimestamp;
}

/** «Вернуть»: why the fan is listed, and the owner's approaches as chips of one tap. */
export interface QueueWinBackVM extends QueueFanVM {
  /** «подписка кончается через 2 дн», «новый, никто не написал», «молчит 16 дн»; null — a reason this build does not know. */
  readonly reason: Msg | null;
  readonly approaches: readonly { readonly id: number; readonly label: string; readonly pick: UiAction }[];
  /** A pick is on its way: the chips rest. */
  readonly busy: boolean;
}

/** «Передача»: a fan the team wrote to in the last hours — how many messages, by whom, who is still «в разговоре». */
export interface QueueRecentVM extends QueueFanVM {
  readonly lastSentAt: IsoTimestamp;
  readonly messages: number;
  readonly chatters: readonly string[];
  readonly inConversation: readonly string[];
}

/** «Передача»: an open promise from a chat of the page. */
export interface QueuePromiseVM {
  readonly key: string;
  readonly text: string;
  readonly at: IsoTimestamp | null;
  /** The fan, when a row of the queue names him; null — unknown here. */
  readonly name: string | null;
  readonly open: UiAction | null;
}

/** «Передача»: an open custom of the page — what, ordered or paid since when. */
export interface QueueCustomVM {
  readonly key: string;
  readonly description: string;
  readonly state: 'ordered' | 'paid' | null;
  readonly paidAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  /** The fan, when a row of the handoff names him; null — unknown here. */
  readonly name: string | null;
  readonly open: UiAction | null;
}

export interface QueueVM {
  readonly tab: QueueTab;
  /** The tabs the hub serves, in order: «Ждут» always, «Вернуть» with `win-back-v1`, «Передача» with `handoff-v1`. */
  readonly tabs: readonly QueueTab[];
  /** The shown tab's state; `empty` — nobody there. */
  readonly view: VmView;
  readonly waiting: { readonly total: number; readonly rows: readonly QueueWaitingVM[] } | null;
  readonly winBack: {
    readonly rows: readonly QueueWinBackVM[];
    /** The last pick of this panel: «Подход выбран» with the fan's chat to open. */
    readonly picked: { readonly name: string; readonly approach: string; readonly open: UiAction | null } | null;
  } | null;
  readonly handoff: {
    readonly recent: readonly QueueRecentVM[];
    readonly waitingTotal: number;
    readonly waiting: readonly QueueWaitingVM[];
    /** Empty — «не знаю»: no fact of a promise, which is not «nobody promised anything». */
    readonly promises: readonly QueuePromiseVM[];
    /** Chat Memory week 4: the page's open customs; absent — the hub does not serve them. */
    readonly customs?: readonly QueueCustomVM[];
  } | null;
  /** The last pick failed: said once, the list stays as it was. */
  readonly error: CgErrorView | null;
}

export interface FanPanelVM {
  /** 1.15.0 P11a: locally known account registration; absent when this host/owner does not offer it. */
  readonly registration?: { readonly label: string; readonly at: IsoTimestamp };
  /** `empty` — «Выберите чат»; `partial` — some blocks unknown (no dossier, host scores not loaded). */
  readonly view: VmView;
  readonly tab: 'fan' | 'recap' | 'memory' | 'queue';
  /** Chat Memory week 2: «Память» — the person across pages; absent — the hub does not serve the card (no tab). */
  readonly memory?: FanMemoryVM;
  /**
   * Chat Memory week 3: «Очередь» — the page of the open tab, whatever chat is open: who waits, whom to win back, the
   * shift handoff. Absent — the page has no owner switch for the panel (no tab).
   */
  readonly queue?: QueueVM;
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
  /**
   * 1.61.0: a greeting reminder — the fan as a card: their picture over the initial, the name, «@handle · 11 мин назад»;
   * `actions` are «Hi» and «Позже».
   */
  readonly greet?: {
    readonly name: string;
    readonly handle: string | null;
    readonly avatarUrl: string | null;
    readonly since: string | null;
    /** 1.62.0: the fan's model, when the toast stands in a tab of another model: «Ждёт приветствия · {модель}». */
    readonly page?: string | null;
    /** 1.67.0: the last of the fan's three reminders (fifteen minutes on) — the card is red. */
    readonly urgent?: boolean;
    /** 1.68.0: the greeting «Hi» wrote inside the toast (absent — not pressed yet). */
    readonly card?: GreetCardVM;
  };
}

/**
 * 1.68.0 (the owner, 2026-10-29: «Hi прямо в напоминании»): the reminder's greeting, written while the person stays in
 * their chat. `writing` — Hi writes it; `ready` — the text, for «Отправить»; `sending` — on its way; `sent` — it went;
 * `greeted` — somebody greeted the fan meanwhile, nothing goes; `failed` — refused, nothing went; `uncertain` — whether it
 * went is unknown (never sent again by itself).
 */
export interface GreetCardVM {
  readonly s: 'writing' | 'ready' | 'sending' | 'sent' | 'greeted' | 'failed' | 'uncertain';
  /** The greeting: ready, sending, sent; a refused or uncertain one keeps it. */
  readonly text: string | null;
  /** Why it did not go (failed, uncertain), in the person's words; null — nothing to say. */
  readonly why: string | null;
}

export interface ToastsVM {
  /** `empty` — none on screen. */
  readonly view: VmView;
  /** Newest first, at most three; same code and scope replace each other (ER-009…ER-015). */
  readonly toasts: readonly ToastVM[];
}
