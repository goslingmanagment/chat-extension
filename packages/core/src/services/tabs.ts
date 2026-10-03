// Tab sessions of the background (architecture.md §5.1, §5.4, §7 «Жизнь в
// фоне»; BG-002, BG-003, BG-006, RB-019, UP-009). The background mints a
// `tabSessionId` when a ChatSpace document registers and checks every later
// request against the sender it was minted for: the same tab, the top frame,
// the same document — a tab cannot take another's session. The tab's
// presence (chat, visibility, focus) drives «AI готово» toasts and sound; a
// chat change resets the fan of the tab's context. A tab that predates this
// extension instance or speaks another contracts version must be reloaded.
// Closing a tab only detaches it: its generations go on (BG-006).

import { chatKeyOf, type ChatRef } from '@cg/contracts/ids';
import { type TabRegisterRequest, type TabRegisterResponse } from '@cg/contracts/tab-protocol';

import { type Clock, type IdSource } from './ports';

/** What the runtime says about a message's sender (`runtime.MessageSender`, reduced). */
export interface TabSender {
  readonly tabId: number;
  readonly frameId: number;
  /** Firefox `documentId` when known; null when the runtime does not give one. */
  readonly documentId: string | null;
}

export interface TabPresence {
  readonly chat: ChatRef | null;
  readonly routeEpoch: number;
  readonly visible: boolean;
  readonly focused: boolean;
}

export interface TabSession {
  readonly tabSessionId: string;
  readonly tabId: number;
  readonly documentId: string | null;
  readonly registeredAt: number;
  /** UP-009: the script came after document_start, or the tab speaks another contracts version. */
  readonly needsReload: boolean;
  readonly presence: TabPresence | null;
}

export type RegisterOutcome =
  | { readonly ok: true; readonly response: TabRegisterResponse; readonly session: TabSession; readonly replaced: string | null }
  | { readonly ok: false; readonly reason: 'not-top-frame' };

export interface TabSessionsOptions {
  readonly contractsVersion: string;
  readonly testBuild: boolean;
}

export class TabSessions {
  private readonly byId = new Map<string, TabSession>();
  private readonly byTab = new Map<number, string>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: Pick<IdSource, 'uuid'>,
    private readonly options: TabSessionsOptions,
  ) {}

  /** `tab.register`: a new session for this document; a re-registered tab replaces its old session. */
  register(sender: TabSender, request: TabRegisterRequest): RegisterOutcome {
    if (sender.frameId !== 0) return { ok: false, reason: 'not-top-frame' };
    const replaced = this.byTab.get(sender.tabId) ?? null;
    if (replaced !== null) this.byId.delete(replaced);
    const session: TabSession = {
      tabSessionId: this.ids.uuid(),
      tabId: sender.tabId,
      documentId: sender.documentId,
      registeredAt: this.clock.now(),
      needsReload: request.lateInjection || request.contractsVersion !== this.options.contractsVersion,
      presence: null,
    };
    this.byId.set(session.tabSessionId, session);
    this.byTab.set(sender.tabId, session.tabSessionId);
    return {
      ok: true,
      session,
      replaced,
      response: { tabSessionId: session.tabSessionId, contractsVersion: this.options.contractsVersion, testBuild: this.options.testBuild },
    };
  }

  /** A request claims `tabSessionId`: true only from the tab, top frame and document it was minted for. */
  verify(tabSessionId: string, sender: TabSender): boolean {
    const session = this.byId.get(tabSessionId);
    if (session === undefined || sender.frameId !== 0 || sender.tabId !== session.tabId) return false;
    return session.documentId === null || sender.documentId === null || session.documentId === sender.documentId;
  }

  get(tabSessionId: string): TabSession | null {
    return this.byId.get(tabSessionId) ?? null;
  }

  /** `tab.presence`; `chatChanged` — the tab's fan context resets (RB-019). */
  setPresence(tabSessionId: string, presence: TabPresence): { readonly known: boolean; readonly chatChanged: boolean } {
    const session = this.byId.get(tabSessionId);
    if (session === undefined) return { known: false, chatChanged: false };
    const before = session.presence?.chat ?? null;
    const chatChanged = (before === null ? null : chatKeyOf(before)) !== (presence.chat === null ? null : chatKeyOf(presence.chat));
    this.byId.set(tabSessionId, { ...session, presence });
    return { known: true, chatChanged };
  }

  /** The chat the tab shows now (null — none, or unknown tab). */
  chatOf(tabSessionId: string): ChatRef | null {
    return this.byId.get(tabSessionId)?.presence?.chat ?? null;
  }

  /** The port of a tab disconnected or the tab closed: returns the session that ended. */
  closeTab(tabId: number): string | null {
    const id = this.byTab.get(tabId);
    if (id === undefined) return null;
    this.byTab.delete(tabId);
    this.byId.delete(id);
    return id;
  }

  close(tabSessionId: string): boolean {
    const session = this.byId.get(tabSessionId);
    if (session === undefined) return false;
    this.byId.delete(tabSessionId);
    if (this.byTab.get(session.tabId) === tabSessionId) this.byTab.delete(session.tabId);
    return true;
  }

  /** Open sessions; BG-003: while any is open, a tab port keeps the event page alive. */
  sessions(): readonly TabSession[] {
    return [...this.byId.values()];
  }

  get keepAlive(): boolean {
    return this.byId.size > 0;
  }
}
