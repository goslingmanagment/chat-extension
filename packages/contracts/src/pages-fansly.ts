// Fansly on the settings page (R20 P14b1; docs/project-unite/architecture.md §4, §12; FS-SET-1, FS-PERM-1): what
// Fansly's part of the extension pages shows and asks — «Включить Fansly» and the tabs waiting for a reload (the
// shared `site.access`), Fansly's part of `settings.ext` («Fansly через вкладку», the tones on Fansly, the Recap depth
// above 3000) and what the background knows of its sessions and tabs (`fansly.settings.*`, `fansly.accounts.*`,
// tab-messages-fansly.ts). Types and the list of its texts only, as vault-fansly.ts: the controller is core's
// (application/hosts/fansly/pages.ts), the surface ui's (ui/hosts/fansly/pages), the wiring the pages' composition
// root's. Only a subpath: no ChatSpace bundle carries it.

import type { CgErrorWire } from './errors';
import type { ToneId } from './settings';
import type { SettingsExtState } from './settings-ext';
import type { SiteAccessView } from './site-access';
import type { FanslyAccountsView } from './tab-messages-fansly';

/** Which tone of Fansly's part a picker sets (`hosts['fansly-web'].sound`). */
export type FanslyToneKey = 'messagesTone' | 'subscribersTone';

/** The last write of Fansly's part: «Сохранено ✓» only with the revision the background answered (ST-013, ST-014). */
export type FanslySaveState =
  | { readonly s: 'idle' }
  | { readonly s: 'saving' }
  | { readonly s: 'saved'; readonly revision: number }
  | { readonly s: 'failed'; readonly error: CgErrorWire };

export interface FanslyPagesView {
  /** «Включить Fansly» as the core's `site.access` says it. */
  readonly access: SiteAccessView;
  /** Switched on and granted: Fansly's module answers the page only then. */
  readonly on: boolean;
  /** Fansly's part of `settings.ext` as last read or written; null — not read (off, or the read failed). */
  readonly settings: SettingsExtState | null;
  /** Why the last read failed; null — it did not (or nothing was asked: off). */
  readonly settingsError: CgErrorWire | null;
  readonly save: FanslySaveState;
  /** The sessions and the tabs as «Аккаунты» last read them (ST-067, ST-077); null — not read. */
  readonly accounts: FanslyAccountsView | null;
  /** «Алмазики FBuddy» (2026-10-28): the person allowed FBuddy's address; null — not known yet. */
  readonly fbuddy: boolean | null;
}

/** One of Fansly's steps of the first run (ST-012): what it is, whether it is done, the control's action for it. */
export interface FanslyStep {
  readonly id: 'fansly-enable' | 'fansly-open' | 'fansly-reload';
  readonly done: boolean;
  /** `enable` — «Включить Fansly» (the prompt in the click); `reload` — the tabs that wait; null — nothing to press. */
  readonly action: 'enable' | 'reload' | null;
}

/** What the shared settings page knows that Fansly's part asks about: the sign-in's pages and the accounts it saw. */
export interface FanslyPageFacts {
  /** A page of the sign-in is on Fansly. */
  readonly fanslyPage: boolean;
  /** This browser has seen a Fansly account (a tab named its creator, or a session of it was captured). */
  readonly seenAccount: boolean;
}

/** The controller the surface draws from; every write answers whether the background confirmed it. */
export interface FanslyPagesControl {
  /** Whether Fansly concerns the person at all: its card, rows and steps are shown only then. */
  concerns(facts: FanslyPageFacts): boolean;
  /** Fansly's three steps of the first run, as they stand. */
  steps(facts: FanslyPageFacts): readonly FanslyStep[];
  readonly value: FanslyPagesView;
  subscribe(listener: () => void): () => void;
  /** Access, then — while on — Fansly's part of the settings. */
  refresh(): Promise<void>;
  /** «Включить Fansly»: the browser's prompt inside this click — call it from the click handler, nothing awaited before (§4). */
  enable(): Promise<void>;
  disable(): Promise<void>;
  /** «Перезагрузить вкладки»: the tabs waiting for a reload. */
  reload(): Promise<void>;
  setViaTab(on: boolean): Promise<boolean>;
  setTone(which: FanslyToneKey, tone: ToneId): Promise<boolean>;
  /** The Recap depth on Fansly above v1's 3000; null — none (v1's depth holds). */
  setDeep(deep: number | null): Promise<boolean>;
  /** «Повторить» the write that failed; false — nothing to repeat, or it failed again. */
  retry(): Promise<boolean>;
  /** «Проверить» a tone at the volume of the settings; the code when it did not play. */
  preview(tone: ToneId, volume: number): Promise<CgErrorWire | null>;
  /** «Разрешить FBuddy»: the browser's prompt inside this click — call it from the click handler, nothing awaited before. */
  allowFbuddy(): Promise<void>;
  /** «Выключить» the gems: FBuddy's address given back. */
  forgetFbuddy(): Promise<void>;
}

/** Fansly's texts on the extension pages (its text pack, core domain/hosts/fansly/i18n/pages.ts). */
export const FANSLY_PAGE_TEXT_KEYS = [
  'fansly.pages.card',
  'fansly.pages.leadOff',
  'fansly.pages.leadOn',
  'fansly.pages.state',
  'fansly.pages.stateHint',
  'fansly.pages.stateOn',
  'fansly.pages.stateOff',
  'fansly.pages.stateNoAccess',
  'fansly.pages.stateUnknown',
  'fansly.pages.tabs',
  'fansly.pages.tabsHint',
  'fansly.pages.tabsOpen',
  'fansly.pages.tabsUnknown',
  'fansly.pages.tabsUnattributed',
  'fansly.pages.viaTab',
  'fansly.pages.viaTabHint',
  'fansly.pages.readFailed',
  'fansly.pages.tones',
  'fansly.pages.tonesHint',
  'fansly.pages.toneMessages',
  'fansly.pages.toneSubscribers',
  'fansly.pages.deep',
  'fansly.pages.deepHint',
  'fansly.pages.steps',
  'fansly.pages.stepEnable',
  'fansly.pages.stepOpen',
  'fansly.pages.stepReload',
  // 2026-10-21 (audit №9): «Персоны» — the old Fansly extension's personas, carried over from its export.
  'fansly.pages.importTitle',
  'fansly.pages.importLead',
  'fansly.pages.importPlaceholder',
  'fansly.pages.importFile',
  'fansly.pages.importRun',
  'fansly.pages.importDone',
  'fansly.pages.importNone',
  'fansly.pages.importBad',
  // 2026-10-28: «Алмазики FBuddy» in «Онлайн» — FBuddy's address, allowed by the person.
  'fansly.pages.fbuddy',
  'fansly.pages.fbuddyHint',
  'fansly.pages.fbuddyOn',
  'fansly.pages.fbuddyOff',
  'fansly.pages.fbuddyEnable',
  'fansly.pages.fbuddyDisable',
] as const;
export type FanslyPageTextKey = (typeof FANSLY_PAGE_TEXT_KEYS)[number];
