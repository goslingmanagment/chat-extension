// A chat's opaque name, shared by the dock and navigation without loading the controller.
import { type ChatRef } from '@cg/contracts/ids';

export const CHAT_HANDLE = 'nav.chat.';

/** A conversation different from its fan (a group's id) is carried as the third id. */
export function chatHandle(chat: Pick<ChatRef, 'hostAccountId' | 'platformFanId'>, conversationRef?: string): string {
  const conversation = conversationRef === undefined || conversationRef === chat.platformFanId ? '' : `.${conversationRef}`;
  return `${CHAT_HANDLE}${chat.hostAccountId}.${chat.platformFanId}${conversation}`;
}
