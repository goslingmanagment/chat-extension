// Ports of the AI controllers (architecture.md §4 «контроллеры зависят
// только от портов», §10.2). The composition root of the tab hands them in:
// the tab ↔ background client, the host port, the I18n port, a clock with
// timers, an id source, the action catalog, the site's slice of the feature
// manifest and its AI policy, the clipboard, and — optional — a toast sink, a
// journal sink and the overlay switch. Nothing here touches browser.*, the
// DOM, the network or storage.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type Tone } from '@cg/contracts/features';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { type HostPort } from '@cg/contracts/host';
import { type LogRecord } from '@cg/contracts/logs';
import { type AiHostPolicy, type ResultMarkVM } from '@cg/contracts/ops';
import { type TabEventPayload, type TabEventType, type TabRequestPayload, type TabRequestType, type TabResponsePayload } from '@cg/contracts/tab-messages';
import {
  type ActionCatalog,
  type ActionReceipt,
  type ClipboardPort,
  type I18n,
  type OverlaySurface,
  type ToastRequest,
  type UiAction,
  type ViewSelector,
} from '@cg/contracts/vm';

/** An answer of the background: the payload, or a CG error as code and facts. */
export type RpcAnswer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

export type TabRequestName = Exclude<TabRequestType, 'tab.register'>;

export type RpcConnection = 'connecting' | 'ready' | 'reconnecting' | 'lost' | 'reloaded' | 'closed';

/** The tab ↔ background client as the controllers use it (@cg/platform's TabRpcClient has exactly this shape). */
export interface TabRpcPort {
  request<T extends TabRequestName>(type: T, payload: TabRequestPayload<T>): Promise<RpcAnswer<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
  onState(listener: (state: RpcConnection, tabSessionId: string | null) => void): () => void;
  state(): RpcConnection;
  tabSessionId(): string | null;
  /** After `lost`: asks the background once more (the person's «Повторить»). The state stays `lost` until it answers. Absent — the client reconnects only by itself. */
  reconnect?(): void;
}

/** A clock whose timers the composition root owns (tests advance it by hand). */
export interface TimerClock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export interface IdPort {
  uuid(): string;
}

/** Where a controller raises a toast of its own (a swallowed key's reason, HK-026; «Help пока убран»). */
export interface ToastSink {
  show(toast: ToastRequest): unknown;
}

/** Route and insert journal lines (LG-017): ids, lengths and fingerprints, never text. */
export interface JournalSink {
  write(entry: Omit<LogRecord, 'ts' | 'seq'>): void;
}

/** 1.47.0: a file saved by the person's click («Скачать MP3»), through a Blob inside our own closed root. */
export interface FileSaver {
  /** false — the browser did not take it. */
  save(file: { readonly name: string; readonly mime: string; readonly bytes: ArrayBuffer }): boolean;
}

/** Opening and closing our overlay surfaces (the Coach panel); the mount side owns the windows. */
export interface OverlaySwitch {
  open(surface: OverlaySurface): void;
  close(surface: OverlaySurface): void;
  isOpen?(surface: OverlaySurface): boolean;
}

/** Local policy state for an analysis read without its generation's proof; no wire contract changes. */
export type AiPolicy<P = unknown, F = unknown> = AiHostPolicy<P, F> & {
  readonly unverifiedAnalysisMark?: ResultMarkVM;
};

export interface AiPorts {
  readonly rpc: TabRpcPort;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: TimerClock;
  readonly ids: IdPort;
  readonly catalog: ActionCatalog;
  /** The site's slice of the feature manifest (the application's half of the site's adapter): what exists here and what each thing needs. */
  readonly features: FeatureSlice;
  /** The site's Reply tones in the menu's order (Telegram spec §6.6: no selling tone there). Absent — every tone. */
  readonly tones?: readonly Tone[];
  /**
   * The dock shows only on an account bound to a page granted to the person (Telegram spec §2: on any other account —
   * a chatter's own, a second one in the same browser — nothing of ours shows). Absent — the dock says why it is off.
   */
  readonly dockOnlyWhenBound?: true;
  /**
   * The site's AI policy (the application's half of the site's adapter, R20 F10): the proof a start gathers, the
   * site's pre-check, its fields of the start, the fingerprint kept with the operation and the verdict on its result.
   */
  readonly policy: AiPolicy;
  readonly clipboard: ClipboardPort;
  readonly toasts?: ToastSink;
  readonly journal?: JournalSink;
  readonly overlays?: OverlaySwitch;
  /** 1.47.0: «Скачать MP3» of a voice take. Absent — no download here. */
  readonly files?: FileSaver;
  /** This build's version (the manifest's): below the bootstrap's `minVersion` the dock says so before a click. Absent — only the hub's own word (`client_outdated`) is read. */
  readonly extensionVersion?: string;
  /** 1.65.0: «Онлайн N» — the fans of the open chat's page worth a message now (the hub's, read every minute). Absent — no number. */
  readonly online?: { count(): number | null; subscribe(listener: () => void): () => void; touch?(): void };
  /** 2026-10-29: «Очереди N» on the dock's chip — the queues with work today, or who answered a message from one. */
  readonly queues?: { count(): { readonly work: number; readonly answered: number; readonly queues: number } | null; subscribe(listener: () => void): () => void; touch?(): void };
}

/**
 * One controller of the tab's AppClient router (core/application/router.ts):
 * the views it serves and the actions it takes. `dispatch` answers null for
 * an action that is not its own, so the router asks the next controller.
 */
export interface SurfaceController {
  readonly kinds: readonly string[];
  getSnapshot(selector: ViewSelector): unknown;
  subscribe(selector: ViewSelector, listener: (view: unknown) => void): () => void;
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
}
