// «В разговоре» in a tab (Chat Memory week 1): the background's marks — who else wrote to a fan in the last 15 minutes,
// by the fan's chat — as the `talking` view every surface looks its own fan up in (TalkingVM). Read once at the start
// and again whenever the port comes back; every change after that comes as `talk.changed`. Nothing is decided here: a
// mark is a warning, never a block.

import { type TabEventPayload, type TalkingMarks } from '@cg/contracts/tab-messages';
import { type TalkingMarkVM, type TalkingVM, type ViewSelector } from '@cg/contracts/vm';

import { createEmitter, type RpcAnswer, type SurfaceController } from './ports';

export interface TalkingRpc {
  request(type: 'talk.read', payload: Record<string, never>): Promise<RpcAnswer<TalkingMarks>>;
  onEvent(type: 'talk.changed', listener: (payload: TabEventPayload<'talk.changed'>) => void): () => void;
  /** The port came back (a new event page): read again. */
  onState?(listener: (state: string) => void): () => void;
}

export interface TalkingController extends SurfaceController {
  /** The mark of a chat (`host:hostAccountId:fanId`) or a page's fan (`page:<pageId>:<fanRef>`); null — nobody else is talking to the fan. */
  mark(chatKey: string): TalkingMarkVM | null;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export function createTalkingController(deps: { readonly rpc: TalkingRpc }): TalkingController {
  const changes = createEmitter();
  let loaded = false;
  let marks: Readonly<Record<string, TalkingMarkVM>> = {};
  let view: TalkingVM = { view: { s: 'loading', since: null, stage: null }, marks };

  const take = (next: TalkingMarks): void => {
    // Each mark under its page's row (`page:<pageId>:<fanRef>`) and under every chat of it, with and without its host
    // (TalkingVM.marks).
    const byChat: Record<string, TalkingMarkVM> = {};
    for (const mark of next.marks) {
      const vm = { names: mark.names, lastSentAt: mark.lastSentAt };
      byChat[`page:${String(mark.pageId)}:${mark.fanRef}`] = vm;
      for (const chatKey of mark.chatKeys) {
        byChat[chatKey] = vm;
        byChat[`acc:${chatKey.split(':').slice(1).join(':')}`] = vm;
      }
    }
    if (loaded && JSON.stringify(byChat) === JSON.stringify(marks)) return;
    loaded = true;
    marks = byChat;
    view = { view: { s: 'ready' }, marks };
    changes.emit();
  };
  const read = (): void => {
    void deps.rpc.request('talk.read', {}).then((answer) => {
      if (answer.ok) take(answer.payload);
    });
  };
  const offs = [deps.rpc.onEvent('talk.changed', take), ...(deps.rpc.onState === undefined ? [] : [deps.rpc.onState((state) => (state === 'ready' ? read() : undefined))])];
  read();

  return {
    kinds: ['talking'],
    getSnapshot: (_selector: ViewSelector) => view,
    subscribe(_selector, listener) {
      return changes.on(() => listener(view));
    },
    dispatch: () => null,
    mark: (chatKey) => marks[chatKey] ?? null,
    onChange: (listener) => changes.on(listener),
    dispose() {
      for (const off of offs) off();
    },
  };
}
