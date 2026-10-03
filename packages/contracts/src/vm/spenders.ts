// The Spenders board and its statistics (architecture.md §8.5, §8.7, §10.2;
// ui-design §3.5, §4.14, §4.15). Money is MoneyMills, formatted only by I18n;
// a known zero is blank, unknown is «—». The client never rebuilds page
// totals from visible rows: every number is the hub's, with coverage and asOf.

import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type SpendersFilter, type SpendersPeriod, type SpendersSort } from './actions';
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
  /** Spent in the selected period, shown as «+$N» in green; zero is blank. */
  readonly period: MoneyMills | null;
  /** The `новый` tag (SP-014). */
  readonly isNew: boolean;
  /** «удалён», muted, no strike-through (SP-015). */
  readonly deleted: boolean;
  readonly weWroteAt: IsoTimestamp | null;
  readonly fanWroteAt: IsoTimestamp | null;
  /** The fan wrote last: «Фан писал» in strong ink. */
  readonly waiting: boolean;
  /** «Последнее сообщение» column (≥ 860 px); «Мы: » before ours. */
  readonly lastMessage: { readonly fromUs: boolean; readonly text: string } | null;
  readonly selected: boolean;
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
}

export interface SpendersBoardVM {
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

export interface SpendersStatsVM {
  /** `error` — the stats failed; the board keeps working (the stats-error scenario). */
  readonly view: VmView;
  readonly expanded: boolean;
  /** «30 дней»; the window is calendar dates in `timeZone` up to `asOf` (§8.7). */
  readonly windowDays: number;
  readonly timeZone: string | null;
  readonly days: readonly { readonly date: string; readonly gross: MoneyMills | null; readonly today: boolean }[];
  readonly today: MoneyStat;
  readonly d7: MoneyStat & {
    /** Change to the previous seven days; null when they were zero or unknown. */
    readonly changePct: number | null;
    readonly prev7: MoneyMills | null;
  };
  readonly d30: MoneyStat & { readonly purchases: number | null };
  readonly payers: CountStat;
  readonly avgCheck: MoneyStat;
  readonly shelves: readonly {
    readonly id: string;
    readonly range: { readonly fromMills: MoneyMills | null; readonly toMills: MoneyMills | null };
    readonly fans: number | null;
    readonly lifetime: MoneyMills | null;
    readonly period: MoneyMills | null;
    /** Bar length 0–1 by sum (min 4 % when not zero). */
    readonly share: number;
  }[];
  readonly attention: {
    readonly awaiting: CountStat;
    readonly newPayers: CountStat & { readonly firstObserved: boolean };
    readonly silent8to21: CountStat;
    readonly silentOver21: CountStat;
    readonly noData: CountStat;
  };
  readonly stamp: DataStamp;
}
