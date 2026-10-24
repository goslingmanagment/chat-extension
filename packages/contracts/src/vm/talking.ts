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
  /** By the chat's key, `host:hostAccountId:fanId`, and by the page's fan, `page:<pageId>:<fanRef>` (talkingKeyOfHandle). */
  readonly marks: Readonly<Record<string, TalkingMarkVM>>;
}

/**
 * Where a handle's mark is (TalkingVM.marks): a chat's target (`<surface>:<host>:<hostAccountId>:<fanId>`, core
 * `targetHandle`) by its chat; a board's fan (`<source>:<pageId>:<fanRef>`, core `fanHandle`) by its page's fan. null —
 * neither.
 */
export function talkingKeyOfHandle(handle: TargetHandle): string | null {
  const parts = handle.split(':');
  if (parts.some((part) => part === '')) return null;
  if (parts.length === 4) return parts.slice(1).join(':');
  return parts.length === 3 ? `page:${parts.slice(1).join(':')}` : null;
}
