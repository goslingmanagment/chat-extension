// The Spenders board and its statistics (architecture.md §8.5, §8.7, §10.2;
// ui-design §3.5, §4.14, §4.15). Money is MoneyMills, formatted only by I18n;
// a known zero is blank, unknown is «—». The client never rebuilds page
// totals from visible rows: every number is the hub's, with coverage and asOf.

import { type CgErrorView } from '../errors';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type BatchRowVM, type BatchVM } from './batch';
import { type SpendersFilter, type SpendersPeriod, type SpendersSort, type UiAction } from './actions';
import { type HotkeyLabel } from './catalog';
import { type Msg } from './i18n';
import { type TargetHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

export interface SpenderRowVM {
  readonly handle: TargetHandle;
  readonly name: string;
  /** @handle without the «@»; null — unknown. */
  readonly username: string | null;
  readonly lifetime: MoneyMills | null;
  /**
   * The lifetime prints with cents (MoneyFormat.cents): whole dollars would
   * show it across its shelf's bound, e.g. «$600» on the $350–600 shelf
   * (SP-013). 1.2.0; absent — whole dollars.
   */
  readonly lifetimeCents?: boolean;
  /** Spent in the selected period: the period's column, plain muted ink; zero or unknown — a faint «—». */
  readonly period: MoneyMills | null;
  /** «удалён» after the name, the whole row muted (SP-015). */
  readonly deleted: boolean;
  readonly weWroteAt: IsoTimestamp | null;
  readonly fanWroteAt: IsoTimestamp | null;
  /** The fan wrote last: «Ждёт ответа» shows the age of their message, the board's one colour. */
  readonly waiting: boolean;
  /** «Последнее сообщение» column; «Мы: » before ours; null — «нет переписки». */
  readonly lastMessage: { readonly fromUs: boolean; readonly text: string } | null;
  /**
   * 1.44.0: the fan's tier where the list is not grouped by the tiers (a sort other than `sum`): the narrow «Тир»
   * column. Both bounds null — no tier takes the fan. Absent — the rows stand under their tier's header.
   */
  readonly tier?: ShelfVM['range'];
  readonly selected: boolean;
  /**
   * The fan's chat where a chat has an id of its own and the board does not know it yet (the old Fansly board's chip):
   * `find` — «найти чат», opening it searches the site's inbox; `finding` — «ищу чат…»; `missing` — «чат не найден».
   * Absent — the chat is known, or it is the fan (OnlyFans).
   */
  readonly chat?: 'find' | 'finding' | 'missing';
  /** 1.32.0: the row in a batch (`SetBatchPick`, `GenerateBatch`); absent — the board has no batch. */
  readonly batch?: BatchRowVM;
  /** «Рассылка» is open and the row's batch line is ready: its own «Отправить» and how it went; absent — nothing to send here. */
  readonly outreach?: OutreachRowVM;
}

/** An item of the page's own «Copied …» list (Fansly's attach menu): 2 — «Copied Bundle», 1 — «Copied Media». */
export interface OutreachItemVM {
  readonly contentType: 1 | 2;
  readonly contentId: string;
  /** Goes with every message of the outreach. */
  readonly picked: boolean;
}

/**
 * «Рассылка» of the board (Spenders on Fansly): each fan of the batch gets their personal line (the batch's Reply or
 * Ping), then the common text, with the picked copied items — by the person's click on the fan's row, one at a time.
 */
export interface OutreachVM {
  /** The bar over the list is shown; the rows offer «Отправить» only then. */
  readonly open: boolean;
  /** The common text: after each fan's personal line, or (`adapt`) the text each fan's own version is rewritten from. */
  readonly text: string;
  /**
   * «Подстроить под фана»: the batch's Fix rewrites the common text for each fan, and that version goes alone; false —
   * the batch's Reply / Ping line, then the common text. null — the hub cannot (no `outreach-fix-v1`).
   */
  readonly adapt: boolean | null;
  /** The page's «Copied …» list as it was last read (opening the bar or «Обновить»), in its own order. */
  readonly items: readonly OutreachItemVM[];
  /** Fans the outreach reached in this tab. */
  readonly sent: number;
}

/** A row's «Отправить» of the outreach. */
export interface OutreachRowVM {
  /** `ready` — may go; `sending` — on its way; `sent` — Fansly made the message; `uncertain` — it left, its fate unknown; `failed` — not sent. */
  readonly state: 'ready' | 'sending' | 'sent' | 'uncertain' | 'failed';
  /** The click goes now (false while another send of the board is on its way or rests its second). */
  readonly can: boolean;
  /** `failed` and `uncertain`: the code. */
  readonly code: string | null;
}

export interface ShelfVM {
  readonly id: string;
  /** The hub's tier bounds; the label is formatted from them («$600+», «$350–600»); both null — «вне полок». */
  readonly range: { readonly fromMills: MoneyMills | null; readonly toMills: MoneyMills | null };
  readonly fans: number | null;
  readonly lifetime: MoneyMills | null;
  readonly period: MoneyMills | null;
  readonly rows: readonly SpenderRowVM[];
  /** «ещё N · показать». */
  readonly collapsed: { readonly hidden: number; readonly reveal: ActionButtonVM } | null;
  /**
   * 1.44.0: a group of a sort other than `sum`, not a tier: `waiting` — «Ждут ответа · дольше ждущие — первыми · N»,
   * `rest` — «Остальные · по «Потратил» · N», `flat` — one list without a header row. Absent — a tier by `range`.
   */
  readonly group?: 'waiting' | 'rest' | 'flat';
}

export interface SpendersBoardVM {
  /** False for a host whose statistics are outside the pilot (R20 P9e); absent keeps the existing panel. */
  readonly statistics?: boolean;
  /** `empty` — «Не настроено» or nothing after a filter («Никого не нашли…»); `partial` — coverage or the 1000-row cut. */
  readonly view: VmView;
  /** The page's display name («LoraVie VIP»), not the hub's pageLabel key. */
  readonly pageName: string | null;
  readonly period: SpendersPeriod;
  readonly periods: readonly SpendersPeriod[];
  readonly query: string;
  readonly filters: readonly { readonly id: SpendersFilter; readonly label: Msg; readonly count: number | null; readonly pressed: boolean }[];
  readonly sort: SpendersSort;
  readonly shelves: readonly ShelfVM[];
  /**
   * 1.38.0 (X67): the tier chips of the old extension — every shelf of the board that has fans, with its count of
   * loaded fans; `pressed` — the list shows that shelf alone (`SetSpendersShelf`). Absent — no chips.
   */
  readonly tiers?: readonly { readonly id: string; readonly range: ShelfVM['range']; readonly fans: number; readonly pressed: boolean }[];
  /** «40 из 40 фанов, охват полный. Показано: 7», «данные на 09:18». */
  readonly footer: {
    readonly loaded: number;
    readonly total: number | null;
    readonly shown: number | null;
    readonly stamp: DataStamp;
  };
  readonly canLoadMore: boolean;
  /** «Сбросить фильтры» when a filter or search hides rows. */
  readonly reset: ActionButtonVM | null;
  /** An open preview on the right (`preview` view, from `spenders`). */
  readonly previewOpen: boolean;
  /** The board's keys footer (SP-034). */
  readonly keys: readonly { readonly label: Msg; readonly hotkey: HotkeyLabel }[];
  /**
   * 1.5.0. «Ждут ответа» is pressed and the hub's queue could not be read: the rows shown are the tab's own
   * filter over the rows the board has loaded — a fallback, not the hub's queue over the whole page. The
   * board says so above the list: the read's error with its CG code, «Повторить», and a line that the list
   * is local (`spenders.waitingLocal`). Absent or null — the list is what its filter says it is.
   */
  readonly waitingFallback?: { readonly error: CgErrorView; readonly retry: UiAction } | null;
  /** 1.32.0: the batch of the board — ticked fans, how their generations go; absent — no batch here. */
  readonly batch?: BatchVM;
  /** «Рассылка» (Spenders on Fansly); absent — the site has none. */
  readonly outreach?: OutreachVM;
}

/** One number of the statistics with its own stamp. */
export interface MoneyStat {
  readonly mills: MoneyMills | null;
  readonly stamp: DataStamp;
}

export interface CountStat {
  readonly count: number | null;
  readonly stamp: DataStamp;
}

/** The remainder rows of the Spenders statistics' tier table (1.4.0), by the hub's own tier keys. */
export const STATS_REMAINDERS = ['untiered', 'unattributed'] as const;
export type StatsRemainder = (typeof STATS_REMAINDERS)[number];

export interface SpendersStatsVM {
  /** `error` — the stats failed; the board keeps working (the stats-error scenario). */
  readonly view: VmView;
  readonly expanded: boolean;
  /**
   * 1.44.0: the column beside the list is open (`SetStatsOpen`); false — a 40 px rail at the window's right edge,
   * as every opening of the board starts.
   */
  readonly open: boolean;
  /** «30 дней»; the window is calendar dates in `timeZone` up to `asOf` (§8.7). */
  readonly windowDays: number;
  readonly timeZone: string | null;
  /**
   * 1.44.0: every sum of the statistics is what the model keeps — the hub's `creatorNetMills` («на руки модели»), the
   * unit of the platform's own earnings page; what the fans paid is `d30.gross` alone.
   */
  readonly days: readonly { readonly date: string; readonly net: MoneyMills | null; readonly today: boolean }[];
  readonly today: MoneyStat;
  readonly d7: MoneyStat & {
    /** Change to the previous seven days; null when they were zero or unknown. */
    readonly changePct: number | null;
    readonly prev7: MoneyMills | null;
  };
  readonly d30: MoneyStat & {
    readonly purchases: number | null;
    /** 1.44.0: what the fans paid in the window (gross), the muted line under the model's net. */
    readonly gross: MoneyMills | null;
    /** 1.44.0: the platform's share, `round(100 − net / gross · 100)`; null — either is unknown or gross is zero. */
    readonly feePct: number | null;
  };
  readonly payers: CountStat;
  /** The hub's average check scaled to the net by the window's net / gross. */
  readonly avgCheck: MoneyStat;
  readonly shelves: readonly {
    readonly id: string;
    readonly range: { readonly fromMills: MoneyMills | null; readonly toMills: MoneyMills | null };
    /**
     * 1.4.0. A remainder row of the hub's tier table — a tier without bounds, told by its key, never by the
     * missing bounds (the hub sends two of them): `untiered` — fans no tier takes, «Удалённые аккаунты»
     * (`stats.shelf.untiered`), `unattributed` — money of the window no fan is counted for, «Без фана»
     * (`stats.shelf.unattributed`; only when it is not zero). Absent — a tier with its bounds, labelled by `range`.
     */
    readonly remainder?: StatsRemainder;
    readonly fans: number | null;
    /** 1.44.0: what the model keeps of the tier's window; null — the hub gave none. */
    readonly net: MoneyMills | null;
  }[];
  readonly attention: {
    readonly awaiting: CountStat;
    /**
     * Of `awaiting`: fans whose read state the hub does not know — «ждёт
     * ответа; прочтение неизвестно», a category of its own (§8.7). 1.2.0;
     * absent — the two are not told apart.
     */
    readonly awaitingUnknown?: CountStat;
    readonly silent8to21: CountStat;
    /**
     * `lifetime` (1.2.0): what these fans spent in all — «сумма трат молчащих
     * >21 д» (SP-046); not lost revenue and not a forecast (§8.7). null —
     * unknown; absent — not given.
     */
    readonly silentOver21: CountStat & { readonly lifetime?: MoneyMills | null };
    readonly noData: CountStat;
  };
  readonly stamp: DataStamp;
}
