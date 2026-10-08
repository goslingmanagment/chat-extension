// Mutable server-side state of the stand: the synthetic dataset, issued
// session tokens, permissions, Mimic, and the scripted answers of the native
// send endpoint. Tests reset it between scenarios.

import { DEFAULT_SOCKET_TRAFFIC, type FanPatch, type MimicState, type SendOutcome, type SocketTraffic } from '../../fixture-chatspace/src/protocol';
import { chatKey, createDataset, type StandAccount, type StandChat, type StandDataset, type StandMessage } from './dataset';

/** What the synthetic chatter may do (names as ChatSpace's permission strings). */
export const DEFAULT_PERMISSIONS: readonly string[] = [
  'om_use_chatspace',
  'of_messages',
  'of_view_message_sender',
  'om_message_translator',
  'om_buying_power',
  'om_view_copilot',
];

const ANY_CHAT = '*';

export class StandState {
  dataset: StandDataset = createDataset();
  permissions: string[] = [...DEFAULT_PERMISSIONS];
  mimic: MimicState = { isActive: false, chats: {} };
  /** The signed-in user owns the organisation (owners send even with of_block_message_sending). */
  owner = false;
  /** Accounts left out of the accounts list (the organisation lost them). */
  readonly hiddenAccounts = new Set<string>();
  /** While held, the Mimic endpoints answer only when released (the page's «Mimic data loading» state). */
  private mimicGate: { readonly opened: Promise<void>; readonly open: () => void } | null = null;
  /** While held, the fans endpoint answers only when released (a chat shown before ChatSpace knows its fan). */
  private fansGate: { readonly opened: Promise<void>; readonly open: () => void } | null = null;
  /** While true, the socket never answers `auth` with `authenticated`. */
  withholdAuth = false;
  /** What the socket sends on its own (summaries, typing). */
  traffic: SocketTraffic = DEFAULT_SOCKET_TRAFFIC;
  private readonly tokens = new Set<string>();
  private tokenSeq = 0;
  private messageSeq = 5_900_000_000;
  private readonly scripts = new Map<string, SendOutcome[]>();

  reset(): void {
    this.dataset = createDataset();
    this.permissions = [...DEFAULT_PERMISSIONS];
    this.mimic = { isActive: false, chats: {} };
    this.owner = false;
    this.hiddenAccounts.clear();
    this.holdMimic(false);
    this.holdFans(false);
    this.withholdAuth = false;
    this.traffic = DEFAULT_SOCKET_TRAFFIC;
    this.scripts.clear();
    // Issued tokens stay valid: an open page keeps its session across a reset.
  }

  holdMimic(hold: boolean): void {
    if (hold && this.mimicGate === null) {
      let open: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => (open = resolve));
      this.mimicGate = { opened, open };
    } else if (!hold && this.mimicGate !== null) {
      this.mimicGate.open();
      this.mimicGate = null;
    }
  }

  get mimicHeld(): boolean {
    return this.mimicGate !== null;
  }

  /** Holds the fans endpoint (`platforms/onlyfans/fans`): a page loaded meanwhile has a chat whose fan it does not know yet. */
  holdFans(hold: boolean): void {
    if (hold && this.fansGate === null) {
      let open: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => (open = resolve));
      this.fansGate = { opened, open };
    } else if (!hold && this.fansGate !== null) {
      this.fansGate.open();
      this.fansGate = null;
    }
  }

  get fansHeld(): boolean {
    return this.fansGate !== null;
  }

  /** Resolves at once, or when a hold of the fans is released. */
  fansReleased(): Promise<void> {
    return this.fansGate?.opened ?? Promise.resolve();
  }

  /** Resolves at once, or when a hold is released. */
  mimicReleased(): Promise<void> {
    return this.mimicGate?.opened ?? Promise.resolve();
  }

  issueToken(): string {
    this.tokenSeq += 1;
    const token = `stand-session-${this.tokenSeq}`;
    this.tokens.add(token);
    return token;
  }

  isValidToken(token: string | null | undefined): boolean {
    return typeof token === 'string' && this.tokens.has(token);
  }

  nextMessageId(): string {
    this.messageSeq += 1;
    return String(this.messageSeq);
  }

  account(accountId: string): StandAccount | undefined {
    return this.dataset.accounts.find((account) => account.id === accountId);
  }

  chat(accountId: string, fanId: string): StandChat | undefined {
    return this.dataset.chats.get(chatKey(accountId, fanId));
  }

  chatsOf(accountId: string): StandChat[] {
    return [...this.dataset.chats.values()].filter((chat) => chat.accountId === accountId);
  }

  patchFan(accountId: string, fanId: string, patch: FanPatch): boolean {
    const chat = this.chat(accountId, fanId);
    if (!chat) return false;
    Object.assign(chat.fan, patch);
    return true;
  }

  appendMessage(accountId: string, fanId: string, message: StandMessage): void {
    const chat = this.chat(accountId, fanId);
    if (!chat) return;
    chat.messages.push(message);
    chat.unread = message.isFromFan ? chat.unread + 1 : 0;
  }

  /** Queue answers for the next native sends of a chat (`chatId` '*' = any chat of the account, '*:*' = any). */
  script(accountId: string, chatId: string, outcomes: readonly SendOutcome[]): void {
    const key = chatKey(accountId, chatId);
    this.scripts.set(key, [...(this.scripts.get(key) ?? []), ...outcomes]);
  }

  takeOutcome(accountId: string, chatId: string): SendOutcome {
    for (const key of [chatKey(accountId, chatId), chatKey(accountId, ANY_CHAT), chatKey(ANY_CHAT, ANY_CHAT)]) {
      const queue = this.scripts.get(key);
      const next = queue?.shift();
      if (next !== undefined) return next;
    }
    return { kind: 'ok' };
  }

  pendingScripts(): Record<string, number> {
    return Object.fromEntries([...this.scripts].map(([key, queue]) => [key, queue.length]));
  }
}
