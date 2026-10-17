// Ports of the board controllers (architecture.md §4: core/application
// depends only on ports). The tab's composition root hands them in: the tab
// RPC client of @cg/platform, the host port of @cg/host-chatspace, the I18n
// port, a clock, ids, the tab side of the R10 send coordinator, a store for
// local drafts, the clipboard and the toast queue. Every shape here is
// structural, so the real implementations fit without an adapter.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type PreviewSendRequest, type SendAttemptView } from '@cg/contracts/send';
import { type SendBegin, type TabEventPayload, type TabEventType, type TabRequestPayload, type TabRequestType, type TabResponsePayload } from '@cg/contracts/tab-messages';

/** An answer of the background: the payload, or a CG error as code and facts (the tab RPC client's own shape). */
export type RpcResult<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

export type BoardsRequestType = Exclude<TabRequestType, 'tab.register'>;

/** The port to the background as the tab's client names it: only `ready` carries requests and events. */
export type RpcConnection = 'connecting' | 'ready' | 'reconnecting' | 'lost' | 'reloaded' | 'closed';

/** The tab ↔ background protocol as the controllers use it (@cg/platform `TabRpcClient`). */
export interface TabRpc {
  request<T extends BoardsRequestType>(type: T, payload: TabRequestPayload<T>): Promise<RpcResult<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
  /**
   * The port's state. While it is down the background's events are lost for this tab — a sign-in, a persona, an
   * owner switch may change unheard — so whoever keeps a copy of that state reads it again when the port is back.
   * Absent — a client whose port is never lost (a test double that has none).
   */
  onState?(listener: (state: RpcConnection) => void): () => void;
  state?(): RpcConnection;
}

/** Time and one-shot timers; `now()` is epoch ms. */
export interface BoardsClock {
  now(): number;
  setTimer(ms: number, fn: () => void): number;
  clearTimer(handle: number): void;
}

export interface IdSource {
  /** RFC 4122 v4. */
  uuid(): string;
}

/** What the preview knows at a click of «Отправить» (the send driver's `SendClick`). */
export type PreviewSendClick = Omit<SendBegin, 'attemptId'> & Pick<PreviewSendRequest, 'plainText' | 'isAiGenerated' | 'media'>;

/**
 * The tab side of the R10 send coordinator (`PreviewSendDriver`): one click —
 * one attempt of one part. `onView` delivers every state the driver learns
 * (MAIN's observations); the background's `send.state` events arrive through
 * the tab RPC as well.
 */
export interface PreviewSender {
  send(click: PreviewSendClick): Promise<SendAttemptView>;
  onView(listener: (view: SendAttemptView) => void): () => void;
}

/**
 * One storage key (`newcomers.drafts` in storage.local) that every ChatSpace
 * tab of the browser shares. The controller never writes it over whole: each
 * write reads the key, merges draft by draft and writes the result, and
 * `onChanged` lets a tab follow what another tab wrote.
 */
export interface DraftStorePort {
  load(): Promise<unknown>;
  /** Rejects when the browser did not take the write (CG-STORAGE-WRITE). */
  save(value: unknown): Promise<void>;
  /** The key's new value after any write, this tab's own included (storage.onChanged); absent — tabs do not follow each other until their next write. */
  onChanged?(listener: (value: unknown) => void): () => void;
}

/** Writes text to the clipboard; false — the write failed (CG-CLIPBOARD). */
export interface ClipboardWriter {
  writeText(text: string): Promise<boolean>;
}

/** The browser's online state, for pausing polls (NF-004). */
export interface Connectivity {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** A message for the person from a surface that has just closed («Вставка отменена», «Чат не готов…»). */
export interface BoardsNotifier {
  notify(code: CgCode, scope: string): void;
}

/** Random numbers in [0, 1) for the poll spread. */
export type RandomSource = () => number;
