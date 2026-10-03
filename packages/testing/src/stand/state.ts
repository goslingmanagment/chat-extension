// Mutable server-side state of the stand: the synthetic dataset, issued
// session tokens, permissions, Mimic, and the scripted answers of the native
// send endpoint. Tests reset it between scenarios.

import type { FanPatch, MimicState, SendOutcome } from '../../fixture-chatspace/src/protocol';
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
  /** While true, the socket never answers `auth` with `authenticated`. */
  withholdAuth = false;
  private readonly tokens = new Set<string>();
  private tokenSeq = 0;
  private messageSeq = 5_900_000_000;
  private readonly scripts = new Map<string, SendOutcome[]>();

  reset(): void {
    this.dataset = createDataset();
    this.permissions = [...DEFAULT_PERMISSIONS];
    this.mimic = { isActive: false, chats: {} };
    this.withholdAuth = false;
    this.scripts.clear();
    // Issued tokens stay valid: an open page keeps its session across a reset.
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
