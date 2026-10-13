// core/domain/navigation — pure rules of chat navigation and of the palette's
// search (architecture.md §6.9): which chat J/K, ⌘U and ⌘1–9 mean over the
// cached list, and which rows a query finds.

export { conversationOf } from './conversation';
export { QUICK_JUMP_SLOTS, chatAtSlot, nextUnreadChat, onlineChats, quickJumpRows, stepChat } from './chats';
export { matchRow, normalizeQuery, searchRows, type SearchHit, type SearchRow } from './search';
