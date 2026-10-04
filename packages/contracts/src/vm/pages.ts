// Extension pages (architecture.md §9.3, §9.9; ui-design §4.23, §4.24, §7):
// the popup, the options page by section, the prompt echo and the journals.
// «Сохранено ✓» exists only with a revision the background confirmed; the
// sign-in screen replaces the settings while no one is signed in (ST-011).

import { type CgCode, type CgErrorView, type SettingsSection } from '../errors';
import { type Role } from '../ids';
import { type LogLevel } from '../logs';
import { type IsoTimestamp } from '../primitives';
import { type CoachAutoRecap, type ToneId, type UiLocale, type UiResultStyle, type UiTheme } from '../settings';
import { type UiAction } from './actions';
import { type CatalogActionId, type HotkeyLabel, type HotkeyPlatform } from './catalog';
import { type Msg } from './i18n';
import { type AccountHandle, type ArtifactHandle, type JournalKind, type PageHandle } from './selectors';
import { type ColorScheme } from './theme';
import { type ActionButtonVM, type RunningOpVM, type VmView } from './view';

export interface PopupVM {
  /** `error` — CG-RUNTIME-UNREACHABLE (a card, never an endless spinner); `forbidden` — CG-AUTH-REQUIRED → «Аккаунт». */
  readonly view: VmView;
  readonly version: string;
  /** «✓ ChatSpace: подключён», «○ ChatSpace: только копия», «✓ Хаб: на связи», «● Хаб: нет связи». */
  readonly pills: {
    readonly host: 'connected' | 'partial' | 'copy-only' | 'closed' | 'unknown';
    readonly hub: 'ok' | 'down' | 'unknown';
  };
  readonly problems: readonly CgErrorView[];
  readonly persona:
    | { readonly s: 'set'; readonly label: string; readonly pageName: string }
    | { readonly s: 'no-persona'; readonly pageName: string }
    | { readonly s: 'not-connected' };
  readonly account: { readonly login: string; readonly signOut: ActionButtonVM } | null;
  /** «Открыт диалог»; a click copies the OnlyMonster account and OnlyFans creator ids (PU-007). */
  readonly chat: {
    readonly fanName: string;
    readonly fanUsername: string | null;
    readonly hostAccountLabel: string;
    readonly copyIds: { readonly hostAccountId: string; readonly creatorId: string | null };
  } | null;
  /** «осталось 12 — обновится в 03:00»; monochrome, no amber (ui-design §9.2 п. 12). */
  readonly quota: { readonly remaining: number | null; readonly resetsAt: IsoTimestamp | null; readonly low: boolean } | null;
  /** «AI сегодня $» — debug only, «только этот браузер» until H-15 (§9.3). */
  readonly aiTodayLine: string | null;
  readonly newcomersCount: number | null;
  /** Spenders, «Новые», «Клавиши ?», «Настройки». */
  readonly buttons: readonly ActionButtonVM[];
  readonly links: { readonly whatsNew: UiAction; readonly changelog: UiAction };
  /** «Обновить статус»: allowed hub reads and a local check, nothing to ChatSpace. */
  readonly refresh: ActionButtonVM;
  readonly refreshing: boolean;
}

export type SaveStateVM =
  | { readonly s: 'idle' }
  | { readonly s: 'saving' }
  | { readonly s: 'saved'; readonly revision: number }
  | { readonly s: 'failed'; readonly error: CgErrorView; readonly retry: UiAction };

export const ONBOARDING_STEPS = ['install', 'host-permission', 'sign-in', 'persona', 'open-chatspace', 'binding', 'consent', 'sound-hotkeys'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface SignInVM {
  readonly hubOrigin: string;
  readonly login: string;
  readonly busy: boolean;
  /** CG-LOGIN-* with its countdown when rate-limited. */
  readonly error: CgErrorView | null;
}

export const STATUS_ROW_IDS = [
  'extension',
  'chatspace',
  'hub',
  'account',
  'binding',
  'persona',
  'quota',
  'running',
  'last-error',
  'spenders',
  'sound',
  'contract',
  'preview-send',
  'consent',
  'support',
] as const;
export type StatusRowId = (typeof STATUS_ROW_IDS)[number];

export interface StatusRowVM {
  readonly id: StatusRowId;
  /** Dot: ink — fine, ring — warning, red — error. */
  readonly level: 'ok' | 'warn' | 'error' | 'unknown';
  readonly title: Msg;
  readonly value: string | Msg;
  readonly note: string | Msg | null;
  readonly action: ActionButtonVM | null;
}

export interface StatusBodyVM {
  readonly section: 'status';
  /** «Готово к смене» / «Нужно N действий» / «Готовность неизвестна» (ST-020). */
  readonly readiness:
    | { readonly s: 'ready'; readonly warnings: readonly Msg[] }
    | { readonly s: 'actions-needed'; readonly count: number; readonly warnings: readonly Msg[] }
    | { readonly s: 'unknown' };
  readonly lastCheckedAt: number | null;
  /** «↻ Проверить всё», not more often than every 10 s. */
  readonly recheck: ActionButtonVM;
  readonly copyReport: ActionButtonVM;
  readonly rows: readonly StatusRowVM[];
  readonly running: readonly RunningOpVM[];
  readonly note: Msg;
}

export interface AccountBodyVM {
  readonly section: 'account';
  /**
   * `hostPermission: 'unknown'` (1.2.0) — the browser has not said yet, or not
   * for this address: «неизвестно», never «разрешён» by default (ST-043).
   */
  readonly hub: { readonly origin: string; readonly hostPermission: 'granted' | 'missing' | 'unknown'; readonly requestPermission: ActionButtonVM | null };
  readonly connection: { readonly s: 'ok' | 'down' | 'unknown'; readonly latencyMs: number | null; readonly checkedAt: number | null };
  readonly user: { readonly login: string; readonly role: Role; readonly deviceSince: IsoTimestamp | null } | null;
  readonly pages: readonly { readonly pageName: string; readonly platform: string; readonly persona: string | null }[];
  readonly sdk: { readonly contractHash: string | null; readonly compatible: boolean | null };
  readonly hubErrorsToday: readonly { readonly code: CgCode; readonly count: number }[];
  readonly lastDossierSave: IsoTimestamp | null;
  readonly signOut: ActionButtonVM | null;
  readonly signInAgain: ActionButtonVM | null;
}

export interface PersonasBodyVM {
  readonly section: 'personas';
  /** Read-only catalog; an archived persona asks for a replacement. */
  readonly catalog: readonly { readonly key: string; readonly label: string; readonly archived: boolean }[];
  readonly pages: readonly {
    readonly pageHandle: PageHandle;
    readonly pageName: string;
    readonly persona: string | null;
    readonly replacementNeeded: boolean;
    readonly choices: readonly { readonly key: string; readonly label: string; readonly choose: UiAction }[];
  }[];
  readonly syncedAt: IsoTimestamp | null;
}

export interface AccountsBodyVM {
  readonly section: 'accounts';
  readonly rows: readonly {
    readonly accountHandle: AccountHandle;
    readonly title: string;
    readonly username: string | null;
    /** Local label up to 60 characters. */
    readonly localLabel: string | null;
    readonly status: 'working' | 'seen' | 'no-sessions';
    readonly pageName: string | null;
    readonly persona: string | null;
    readonly muted: boolean;
    /** «к вкладке» (Б13). */
    readonly goTo: ActionButtonVM;
  }[];
}

export interface GenerationBodyVM {
  readonly section: 'generation';
  /** Steppers (ST-090…ST-094); `savedAs` is the «сохранено как N» chip; `deepMax` from bootstrap. */
  readonly windows: {
    readonly quick: number;
    readonly ping: number;
    readonly improve: number;
    readonly deep: number;
    readonly deepMax: number | null;
    readonly savedAs: number | null;
  };
  readonly split: boolean;
  readonly coach: { readonly historyLimit: number; readonly autoRecap: CoachAutoRecap };
  readonly debug: { readonly enabled: boolean; readonly renderTrace: boolean };
}

export interface HotkeysBodyVM {
  readonly section: 'hotkeys';
  readonly platform: HotkeyPlatform;
  readonly rows: readonly {
    readonly id: CatalogActionId;
    readonly label: Msg;
    readonly hotkey: HotkeyLabel | null;
    /** Keys outside the vendored scheme (J/K, ⌘1–9…). */
    readonly outsideScheme: boolean;
  }[];
}

export interface AppearanceBodyVM {
  readonly section: 'appearance';
  readonly theme: UiTheme;
  /** «Система сейчас — светлая». */
  readonly systemScheme: ColorScheme;
  readonly locale: UiLocale;
  readonly hints: boolean;
  readonly resultStyle: UiResultStyle;
  readonly sound: {
    readonly messages: { readonly on: boolean; readonly tone: ToneId };
    readonly subscribers: { readonly on: boolean; readonly tone: ToneId };
    readonly volume: number;
    readonly tones: readonly ToneId[];
    readonly test: { readonly messages: ActionButtonVM; readonly subscribers: ActionButtonVM };
    /** How many tabs listen, the last incoming, outcome counters (SN-015, ST-031, ST-133). */
    readonly status: {
      readonly listeningTabs: number | null;
      readonly lastIncomingAt: number | null;
      readonly outcomes: Readonly<Record<string, number>>;
      readonly error: CgErrorView | null;
    };
  };
}

export interface DiagnosticsBodyVM {
  readonly section: 'diagnostics';
  readonly cachesKB: number | null;
  readonly logsKB: number | null;
  readonly export: ActionButtonVM;
  /** Asks DialogPort, then dispatches ClearLocalData. */
  readonly clear: ActionButtonVM;
  readonly counters: readonly { readonly code: CgCode; readonly count: number }[];
  /** Debug mode only. */
  readonly journals: readonly { readonly journal: JournalKind; readonly open: UiAction }[] | null;
}

export interface OptionsBodyMap {
  readonly status: StatusBodyVM;
  readonly account: AccountBodyVM;
  readonly personas: PersonasBodyVM;
  readonly accounts: AccountsBodyVM;
  readonly generation: GenerationBodyVM;
  readonly hotkeys: HotkeysBodyVM;
  readonly appearance: AppearanceBodyVM;
  readonly diagnostics: DiagnosticsBodyVM;
}

interface OptionsVMOf<S extends SettingsSection> {
  /** `forbidden` — signed out: `signIn` replaces the section. */
  readonly view: VmView;
  readonly section: S;
  readonly version: string;
  /** Section links; a dot next to one with a problem. */
  readonly nav: readonly { readonly section: SettingsSection; readonly label: Msg; readonly problem: boolean }[];
  /** `options.html#<section>:<CODE>`: the plate and the highlight (ST-007…ST-010). */
  readonly highlight: CgErrorView | null;
  readonly save: SaveStateVM;
  /** The store is newer than this build (CG-STORAGE-VERSION): read-only with a banner. */
  readonly readOnly: boolean;
  readonly signIn: SignInVM | null;
  /** The first-run checklist until dismissed for good (ST-012). */
  readonly checklist: {
    readonly steps: readonly { readonly id: OnboardingStep; readonly label: Msg; readonly done: boolean; readonly action: ActionButtonVM | null }[];
    readonly dismiss: UiAction;
  } | null;
  readonly body: OptionsBodyMap[S] | null;
  /**
   * The footer under the section list (ST-005; 1.2.0): «Что нового» and
   * «История версий» — null where the build knows no such page — and whether
   * the notes of this version are still unread (the «нов.» mark).
   */
  readonly footer?: { readonly whatsNew: UiAction | null; readonly changelog: UiAction | null; readonly unseenNotes: boolean };
}

/** One view per section, correlated: `section: 'status'` comes with a StatusBodyVM. */
export type OptionsVM<S extends SettingsSection = SettingsSection> = S extends SettingsSection ? OptionsVMOf<S> : never;

/** debug-prompt.html (DB-004…DB-008): the prompt lives only in the background, 12 min, ≤ 10 snapshots. */
export interface DebugPromptVM {
  /** `error` — «истёк»; `empty` — «эхо выключено»; `partial` — a block was cut; `forbidden` — debug is off. */
  readonly view: VmView;
  readonly source: 'echo' | 'cache' | null;
  readonly createdAt: number | null;
  readonly expiresAt: number | null;
  readonly blocks: readonly { readonly name: string; readonly text: string; readonly truncated: boolean }[];
  readonly manifest: { readonly text: string; readonly truncated: boolean } | null;
  /** «Копировать промпт» — an explicit action inside the page. */
  readonly copyHandle: ArtifactHandle | null;
}

/** Journals of the debug mode, without any message or prompt text (§9.2, NF-029). */
export interface JournalVM {
  readonly view: VmView;
  readonly journal: JournalKind;
  readonly entries: readonly {
    readonly at: number;
    readonly level: LogLevel;
    readonly scope: string;
    readonly text: string;
    readonly code: CgCode | null;
  }[];
  /** «обрезано»: the journal hit its cap. */
  readonly truncated: boolean;
  /** «Новые» check runs (up to 8). */
  readonly runs: readonly { readonly id: string; readonly startedAt: number; readonly events: number }[] | null;
  readonly copyHandle: ArtifactHandle | null;
  readonly save: ActionButtonVM;
}
