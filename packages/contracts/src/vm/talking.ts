// Chat Memory week 1: «в разговоре» as the UI reads it — who else wrote to a fan in the last 15 minutes, by the fan's
// chat. One view for every surface that names a fan (Spenders, «Ожидают ответа», «Новые», ⌘K, quick jump, the dock's
// head, a preview's «Отправить»): each looks its own fan up by the chat of its handle. A warning, never a block.

import { type IsoTimestamp } from '../primitives';
import { type TargetHandle } from './selectors';
import { type VmView } from './view';

export interface TalkingMarkVM {
  /** The other chatters talking to the fan, newest first; never the person themself. */
  readonly names: readonly string[];
  /** The newest of their messages to the fan. */
  readonly lastSentAt: IsoTimestamp;
}

export interface TalkingVM {
  /** `ready` — the marks as the background last heard them (none is `ready` too: nobody is talking). */
  readonly view: VmView;
  /**
   * By the chat's key, `host:hostAccountId:fanId`, by the same without its host, `acc:hostAccountId:fanId` (the
   * navigation's chat handles carry no host), and by the page's fan, `page:<pageId>:<fanRef>` (talkingKeyOfHandle).
   */
  readonly marks: Readonly<Record<string, TalkingMarkVM>>;
}

/** The navigation's chat handle (core `chatHandle`): `nav.chat.<hostAccountId>.<fanId>[.<conversationRef>]`. */
const NAV_CHAT = /^nav\.chat\.(\d{1,30})\.(\d{1,30})(?:\.\d{1,30})?$/;

/**
 * Where a handle's mark is (TalkingVM.marks): a chat's target (`<surface>:<host>:<hostAccountId>:<fanId>`, core
 * `targetHandle`) by its chat; the navigation's chat (⌘K, the quick jump) by its account and fan; a board's fan
 * (`<source>:<pageId>:<fanRef>`, core `fanHandle`) by its page's fan. null — none of them.
 */
export function talkingKeyOfHandle(handle: TargetHandle): string | null {
  const nav = NAV_CHAT.exec(handle);
  if (nav !== null) return `acc:${nav[1] ?? ''}:${nav[2] ?? ''}`;
  const parts = handle.split(':');
  if (parts.some((part) => part === '')) return null;
  if (parts.length === 4) return parts.slice(1).join(':');
  return parts.length === 3 ? `page:${parts.slice(1).join(':')}` : null;
}
