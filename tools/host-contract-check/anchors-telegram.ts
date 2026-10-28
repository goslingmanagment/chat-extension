// Telegram's anchor set (docs/specs/2026-10-27-telegram-site.md §6 «Anchors on Web A», §6.9): for every anchor of
// Telegram's contract report (`TELEGRAM_ANCHOR_IDS`), the global classes and ids of Web A (telegram-tt 6002824b) the
// adapter reads (`TELEGRAM_SELECTORS`). A stub of the check: no copy of Web A's bundle is kept in this repository's
// tools; the live check of the PR and the tab's own contract report hold them (a missing anchor turns the dock off and
// the report names it).

import { TELEGRAM_ANCHOR_IDS, type TelegramAnchorId } from '../../packages/contracts/src/telegram-host.ts';

export const TELEGRAM_ANCHORS: Readonly<Record<TelegramAnchorId, readonly string[]>> = {
  layout: ['messages-layout'],
  listSlide: ['Transition', 'Transition_slide-active'],
  headerPeer: ['MiddleHeader', 'ChatInfo', 'Avatar', 'data-peer-id'],
  messageList: ['MessageList', 'messages-container', 'Message', 'message-list-item', 'list-bottom-marker', 'sticky-date'],
  field: ['editable-message-text', 'editable-message-text-modal'],
  composer: ['Composer', 'ComposerEmbeddedMessage'],
  account: ['account'],
};

/** Every anchor id named once (the report's set). */
export const TELEGRAM_ANCHOR_SET: readonly TelegramAnchorId[] = TELEGRAM_ANCHOR_IDS;
