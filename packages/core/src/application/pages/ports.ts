// Ports of the extension-page controllers (architecture.md §4, §9.9, §10.2):
// the page RPC to the background, the clock and timers, the browser's
// permissions and consent, the page's own window (hash route, focus,
// pagehide), files and links. The composition root passes @cg/platform's
// adapters, which have exactly these shapes; nothing here names `browser.*`.

import { type CgErrorWire, type SettingsRoute } from '@cg/contracts/errors';
import { type Locale } from '@cg/contracts/i18n/keys';
import { type TabEventPayload, type TabEventType, type TabRequestPayload, type TabRequestType, type TabResponsePayload } from '@cg/contracts/tab-messages';
import { type ExtensionPage } from '@cg/contracts/tab-protocol';
import { type ActionCatalog, type ColorScheme, type HotkeyPlatform, type ValueSignal } from '@cg/contracts/vm';

/** An answer of the background: the payload, or a CG error as code and facts (platform `RpcResult`). */
export type PageAnswer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

/** Every request a page may send (`tab.register` belongs to tabs). */
export type PageRequestType = Exclude<TabRequestType, 'tab.register'>;

/** The page side of the §5.4 protocol (platform `createPageRpcClient`). Nothing is resent by itself. */
export interface PageRpc {
  request<T extends PageRequestType>(type: T, payload: TabRequestPayload<T>, options?: { readonly timeoutMs?: number }): Promise<PageAnswer<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
}

export interface PageClock {
  now(): number;
}

export interface PageTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Host access (platform `createHostPermissions`). `request` works only inside a user gesture. */
export interface PagePermissions {
  has(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
  onChange(listener: (change: { readonly added: readonly string[]; readonly removed: readonly string[] }) => void): () => void;
}

/** Firefox's `technicalAndInteraction` consent (platform `createConsent`, §9.6). */
export interface PageConsent {
  /** null — the browser could not tell. */
  check(): Promise<boolean | null>;
  /** On a user gesture only. */
  request(): Promise<boolean>;
  onChange(listener: (granted: boolean) => void): () => void;
}

/** A file handed to the browser through a Blob (platform `downloadFile`); false — the save did not start. */
export type PageDownload = (file: { readonly fileName: string; readonly mime: string; readonly body: string }) => boolean;

export type PageClipboardResult = { readonly ok: true } | { readonly ok: false; readonly code: 'CG-CLIPBOARD' };

/** The page's own window: the hash route, focus and pagehide. */
export interface PageWindow {
  /** `location.hash` (with or without the leading `#`). */
  hash(): string;
  setHash(hash: string): void;
  onHashChange(listener: () => void): () => void;
  /** The page became visible or focused again (ST-038). */
  onFocus(listener: () => void): () => void;
  /** `pagehide`: the last chance for a best-effort write (§9.4). */
  onPageHide(listener: () => void): () => void;
  /** The popup closes itself after it handed a click to a tab. */
  close?(): void;
}

/** Our own pages in a tab (platform `createExtensionPages`): the open one is reused (ST-006). */
export interface PageOpener {
  open(page: Exclude<ExtensionPage, 'popup'>, hash?: string): Promise<{ readonly ok: boolean }>;
}

/** Where the site pages of the release live (R19); https only. A missing link hides its entry. */
export interface PageLinks {
  readonly whatsNew: string | null;
  readonly changelog: string | null;
}

export interface PageEnv {
  /** Which page this controller serves: decides what is loaded and where «Настройки» goes. */
  readonly page: ExtensionPage;
  /** The extension version of the manifest. */
  readonly version: string;
  readonly hotkeyPlatform: HotkeyPlatform;
  /** The ChatSpace origin of the manifest (apps/extension/src/hosts.ts): the onboarding checks the host access. */
  readonly hostOrigin: string;
  readonly links: PageLinks;
  /** `navigator.languages`: what `ui.locale: 'system'` resolves against. */
  readonly systemLanguages: () => readonly string[];
  /** IANA zone for the times the controller prints itself (the report); default — the runtime's. */
  readonly timeZone?: string;
}

/** The I18n the page renders with: the controller switches its language with `ui.locale` (I18-001). */
export interface PageLanguageSwitch {
  setLanguage(language: Locale): void;
}

export interface PagePorts {
  readonly rpc: PageRpc;
  readonly clock: PageClock;
  readonly timers: PageTimers;
  readonly permissions: PagePermissions;
  readonly consent: PageConsent;
  readonly window: PageWindow;
  readonly pages: PageOpener;
  /** Opens an https link in a new tab; false — refused. */
  readonly openLink: (url: string) => boolean;
  readonly download: PageDownload;
  readonly clipboard: { writeText(text: string): Promise<PageClipboardResult> };
  /** `prefers-color-scheme` of the OS, live («Система сейчас — …», ST-123). */
  readonly systemScheme: ValueSignal<ColorScheme>;
  readonly language: PageLanguageSwitch;
  /** R17's catalog when the composition root has one: its key labels and delivery marks win over the scheme's. */
  readonly catalog?: ActionCatalog;
  /** Failures of the controller itself: class and code only, never a text (ER-021…ER-023). */
  readonly report?: (failure: { readonly scope: string; readonly code: string; readonly name: string }) => void;
}

/** Where the options page is: `#<section>:<CODE>`; `seq` grows on every hash change, the same one included (ST-009). */
export interface OptionsLocation extends SettingsRoute {
  readonly seq: number;
}
