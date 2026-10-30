// Extension pages (architecture.md §9.3, §9.9; ui-design §4.23, §4.24, §7):
// the popup, the options page by section, the prompt echo and the journals.
// «Сохранено ✓» exists only with a revision the background confirmed; the
// sign-in screen replaces the settings while no one is signed in (ST-011).

import { type CgCode, type CgErrorTone, type CgErrorView, type SettingsSection } from '../errors';
import { type RecapReader } from '../features';
import { type HostKind } from '../hosts';
import { type UiTextKey } from '../i18n/keys';
import { type Role } from '../ids';
import { type LogLevel } from '../logs';
import { type IsoTimestamp } from '../primitives';
import { type CoachAutoRecap, type ToneId, type UiLocale, type UiResultStyle, type UiTextSize, type UiTheme } from '../settings';
import { type UiAction } from './actions';
import { type CatalogActionId, type HotkeyLabel, type HotkeyPlatform } from './catalog';
import { type AiLimitVM } from './dock';
import { type Msg } from './i18n';
import { type AccountHandle, type ArtifactHandle, type JournalKind, type PageHandle } from './selectors';
import { type ColorScheme } from './theme';
import { type ActionButtonVM, type RunningOpVM, type VmView } from './view';

/**
 * 1.3.0. What tells two hub pages of one title apart wherever pages are listed
 * or chosen: an owner may have «Lora Vie» on OnlyFans twice and on Fansly once.
 * `platform` is the hub's open token (`onlyfans`, `fansly`, or a newer one —
 * printed as it is); `pageLabel` is the hub's own key of the page. Display
 * only: nothing is bound or looked up by either (AU-023).
 */
export interface PageTagVM {
  readonly platform: string;
  readonly pageLabel: string;
  /**
   * 1.15.0 (R20 F9b): the platform as people name it — the phrase of the site that serves it (`HostPhrases`
   * `sitePlatform`), «OnlyFans». Absent — no site of the pages serves it: the token is printed as it is.
   */
  readonly platformName?: string;
}

/**
 * 1.35.0 (X61). One thing the popup asks the person to fix, in words, with its one remedy: «Перезагрузите вкладку
 * ChatSpace» — «Перезагрузить вкладку». `fix` null — nothing to press here (a contract change of the site, a page the
 * team lead has to bind); `busy` — the remedy is running (the tab is being reloaded), its button says so.
 */
export interface PopupAlertVM {
  readonly code: CgCode;
  readonly tone: CgErrorTone;
  readonly title: string;
  readonly body: string | null;
  readonly fix: ActionButtonVM | null;
  readonly busy?: boolean;
}

/**
 * 1.35.0 (X61). The popup's verdict, the stage under the persona — the same three as «Статус»: `ready` (the pond:
 * a site connected and the hub answers; `line` names them), `attention` (the gosling's yellow: `alerts`, the first
 * the one to fix first), `checking` (the shade: a tab's report or the hub's health is not in yet).
 */
export interface PopupVerdictVM {
  readonly s: 'ready' | 'attention' | 'checking';
  readonly line: string | null;
  readonly alerts: readonly PopupAlertVM[];
}

export interface PopupVM {
  /** 1.35.0 (X61): the stage under the persona; absent on older producers — the popup reads `problems`. */
  readonly verdict?: PopupVerdictVM;
  /** Per-site pills; absent on older producers. */
  readonly sites?: readonly { readonly host: HostKind; readonly label: string; readonly state: PopupVM['pills']['host']; readonly waitingReload: number }[];
  /** `error` — CG-RUNTIME-UNREACHABLE (a card, never an endless spinner); `forbidden` — CG-AUTH-REQUIRED → «Аккаунт». */
  readonly view: VmView;
  readonly version: string;
  /** «✓ ChatSpace: подключён», «○ ChatSpace: только копия», «✓ Хаб: на связи», «● Хаб: нет связи». */
  readonly pills: {
    readonly host: 'connected' | 'partial' | 'copy-only' | 'closed' | 'unknown';
    readonly hub: 'ok' | 'down' | 'unknown';
  };
  readonly problems: readonly CgErrorView[];
  /**
   * `page` (1.3.0) — what tells this page from another of the same title: its
   * platform and the hub's page label («Lora Vie · OnlyFans · lora-vip»).
   */
  readonly persona:
    | { readonly s: 'set'; readonly label: string; readonly pageName: string; readonly page?: PageTagVM }
    | { readonly s: 'no-persona'; readonly pageName: string; readonly page?: PageTagVM }
    | { readonly s: 'not-connected' };
  readonly account: { readonly login: string; readonly signOut: ActionButtonVM } | null;
  /** «Открыт диалог»; a click copies the OnlyMonster account and OnlyFans creator ids (PU-007). */
  readonly chat: {
    readonly fanName: string;
    readonly fanUsername: string | null;
    readonly hostAccountLabel: string;
    readonly copyIds: { readonly hostAccountId: string; readonly creatorId: string | null; readonly fanId?: string; readonly conversationRef?: string };
  } | null;
  /** «осталось 12 — обновится в 03:00»; monochrome, no amber (ui-design §9.2 п. 12). */
  readonly quota: { readonly remaining: number | null; readonly resetsAt: IsoTimestamp | null; readonly low: boolean } | null;
  /** «ИИ сегодня $1.20 из $3.50» with a bar: the person's own daily limit; absent or null — none or not known. */
  readonly aiLimit?: AiLimitVM | null;
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

/**
 * 1.15.0 (R20 F7): `host` replaces `chatspace` — one row per site in use (a tab open, an account bound; none in use —
 * every site of the build), each naming its site in `StatusRowVM.host`.
 */
export const STATUS_ROW_IDS = [
  'extension',
  'host',
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
  /** 1.15.0 (R20 F7): the site of a `host` row; absent on every other row. */
  readonly host?: HostKind;
  /** Dot: ink — fine, ring — warning, red — error. */
  readonly level: 'ok' | 'warn' | 'error' | 'unknown';
  readonly title: Msg;
  readonly value: string | Msg;
  readonly note: string | Msg | null;
  readonly action: ActionButtonVM | null;
  /** Local diagnostic facts, displayed under this site only. */
  readonly details?: readonly { readonly label: string; readonly value: string }[];
}

/**
 * 1.15.0 (R20 F7): the words of a site's `host` row of «Статус» and of the popup's line about it. Since F9b the texts
 * name no site — they say `{site}` and the I18n port puts the site's phrase in — so the set is a site's own only where
 * its row says something else (a step it lacks, a check of its own). The extension pages' composition root hands each
 * site's set to the controller with the site.
 */
export interface HostStatusTexts {
  /** The row's name: the site. */
  readonly title: UiTextKey;
  /** No tab of the site is open; and what to do. */
  readonly closed: UiTextKey;
  readonly closedNote: UiTextKey;
  /** A tab is open, its report is not in yet. */
  readonly checking: UiTextKey;
  /** `{build}` — connected; `{time}` — when its contract was checked. */
  readonly value: UiTextKey;
  readonly checked: UiTextKey;
  /** Connected, but the preview send waits for the page's first chat (an anchor the site creates later). */
  readonly notYetNote: UiTextKey;
  /** `{build}` — partly checked; `{missing}` — what was not found, with the insert working or copy only. */
  readonly partial: UiTextKey;
  readonly partialNote: UiTextKey;
  readonly copyOnlyNote: UiTextKey;
}

/** ChatSpace's words, as «Статус» has said them since 1.0.0. */
export const CHATSPACE_STATUS_TEXTS: HostStatusTexts = {
  title: 'settings.status.row.chatspace',
  closed: 'settings.status.row.chatspaceClosed',
  closedNote: 'settings.status.row.chatspaceClosedNote',
  checking: 'settings.status.row.chatspaceChecking',
  value: 'settings.status.row.chatspaceValue',
  checked: 'settings.status.row.chatspaceChecked',
  notYetNote: 'settings.status.row.chatspaceNotYetNote',
  partial: 'settings.status.row.chatspacePartial',
  partialNote: 'settings.status.row.chatspacePartialNote',
  copyOnlyNote: 'settings.status.row.chatspaceCopyOnlyNote',
};

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
  /** `pageLabel` (1.3.0) — the hub's key of the page, printed next to its title and platform. */
  readonly pages: readonly { readonly pageName: string; readonly platform: string; readonly persona: string | null; readonly pageLabel?: string }[];
  readonly sdk: { readonly contractHash: string | null; readonly compatible: boolean | null };
  readonly hubErrorsToday: readonly { readonly code: CgCode; readonly count: number }[];
  readonly lastDossierSave: IsoTimestamp | null;
  readonly signOut: ActionButtonVM | null;
  readonly signInAgain: ActionButtonVM | null;
  /**
   * 1.20.0 (DB-027, decision X47): «Дополнительно», in debug mode only — the sign-in of this device (the hub's display
   * prefix of its key, when it was issued, when it expires), «Поток» (each site's build and contract) and
   * «Приложение» (version · browser · OS). Absent or null — debug is off, or the background did not answer.
   */
  readonly advanced?: AccountAdvancedVM | null;
}

/** 1.20.0: «Аккаунт → Дополнительно» (DB-027). */
export interface AccountAdvancedVM {
  readonly signIn: { readonly key: string | null; readonly issuedAt: IsoTimestamp | null; readonly expiresAt: IsoTimestamp | null } | null;
  /** «Поток»: one row per site with a tab open now; `label` — the site as people call it. */
  readonly hosts: readonly { readonly label: string; readonly build: string | null; readonly contract: 'ok' | 'broken' | 'unknown' }[];
  /** «Приложение»: «0.3.1 · Firefox 158 · macos». */
  readonly app: string;
}

export interface PersonasBodyVM {
  readonly section: 'personas';
  /** Read-only catalog; an archived persona asks for a replacement. */
  readonly catalog: readonly { readonly key: string; readonly label: string; readonly archived: boolean }[];
  readonly pages: readonly {
    readonly pageHandle: PageHandle;
    readonly pageName: string;
    /** 1.3.0: the platform and the hub's page label, printed next to the title. */
    readonly page?: PageTagVM;
    readonly persona: string | null;
    readonly replacementNeeded: boolean;
    /** The persona the hub says the page is meant for (`defaultPersonaKey`), when another is chosen; absent — none or the same. */
    readonly intended?: string;
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
    /** 1.3.0: the platform and the hub's page label of the bound page; absent or null — no page, or not known. */
    readonly page?: PageTagVM | null;
    readonly persona: string | null;
    readonly muted: boolean;
    /** «к вкладке» (Б13). */
    readonly goTo: ActionButtonVM;
    /**
     * 1.15.0 (R20 P14b1): the account's other ids — a session's legacy id next to the creator's own (ST-079). Its
     * label and its sound follow them; absent or empty — none.
     */
    readonly aliases?: readonly string[];
  }[];
  /**
   * 1.15.0 (R20 P14b1): the sites the list holds accounts of, as the lead and the hint say them — «OnlyMonster и
   * Fansly», «ChatSpace или Fansly»; absent — the page's own site.
   */
  readonly phrases?: { readonly siteAccount: string; readonly site: string };
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
  /** «Помнить тон в чате» (1.18.0, X45); absent — on. */
  readonly rememberTone?: boolean;
  /** 1.52.0: «Учитывать Recap» per feature — where a chat's «с Recap» of each starts; absent — all on. */
  readonly recapBy?: Readonly<Record<RecapReader, boolean>>;
  /** 2026-10-27: `window` — how many of the chat's latest messages Coach reads (absent in a store — 300). */
  readonly coach: { readonly historyLimit: number; readonly autoRecap: CoachAutoRecap; readonly window?: number };
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
  /** 1.26.0 (X55): «Размер текста»; absent — a model of a build before it: the normal size. */
  readonly textSize?: UiTextSize;
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
  /**
   * 1.20.0 (DB-022, decision X47): what this browser spent on AI by feature — today and the 7 days — in debug mode
   * only (Б4). Absent or null — debug is off, or the journal was not read.
   */
  readonly aiSpend?: AiSpendVM | null;
}

/** 1.20.0: one row of «Расходы AI»: a feature (or the total), its runs, inserts, tokens, cache share and cost. */
export interface AiSpendRowVM {
  /** The feature's name; a site's own operation without a shared name — its id as is. */
  readonly feature: Msg | string;
  readonly runs: number;
  readonly inserts: number;
  /** «in 3 412 · out 286». */
  readonly tokens: string;
  /** «47 %»; null — no input. */
  readonly cache: string | null;
  /** «$0.0143», «≈$0.0143» when some cost was approximate. */
  readonly cost: string;
}

/** 1.20.0 (DB-022): the local spend journal of this browser, «только этот браузер». */
export interface AiSpendVM {
  readonly periods: readonly { readonly label: Msg; readonly rows: readonly AiSpendRowVM[]; readonly total: AiSpendRowVM }[];
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
    /**
     * 1.26.0 (X55): `more` — a step of the team lead's (the persona, the binding, the consent, the sound and the keys),
     * drawn folded under «Ещё»; absent — one the chatter does: the site's access, the sign-in, the site open.
     */
    readonly steps: readonly { readonly id: OnboardingStep; readonly label: Msg; readonly done: boolean; readonly action: ActionButtonVM | null; readonly more?: true }[];
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
  readonly generation?: { readonly text: string };
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
