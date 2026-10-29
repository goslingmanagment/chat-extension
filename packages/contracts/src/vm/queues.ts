// «Очереди» (2026-10-29, the owner's prototype became the window): the page's fan queues a person works — made on
// someone's word through Gengar (a rule the hub evaluates or a list) and handed out in portions of up to ten. On top
// the page's queues as chips («Холодные живые · 12/50», «постоянная», «только моя», «пауза»), under them the chosen
// queue's goal and who is in it, then «Онлайн»'s twin: on the left the fans who answered a message from a queue first
// («Ответили»), then the person's portion («Моя порция 6 из 10»); on the right the chosen fan's card — «Онлайн»'s own
// card, with why he is in the queue and «Пропустить ▾» with its reasons. Nothing is written by itself: the queue's
// template stands at once, Ping / Hi / Reply are written by the card's click. One click, one message — except
// «Отправить всем» of a template queue (the owner's «2 да», 2026-10-29), the «Новые» batch's rules. The day's portion
// is a target, never a block: «На сегодня всё» offers «Ещё 10».
//
// Who is in a queue and what came of each fan is the hub's (`clientFanQueues`, `clientFanQueueTake`,
// `clientFanQueueItemDone`); the card is the fan's preview (`preview` from `queue`).

import { type IsoTimestamp } from '../primitives';
import { type Msg } from './i18n';
import { type OnlineCardVM, type OnlineRowVM } from './online';
import { type DataStamp, type VmView } from './view';

export * from './queues-ids';

/** A queue of the page as its chip shows it. */
export interface QueueChipVM {
  readonly queueId: number;
  readonly name: string;
  /** `standing` — refills from its rule every day («постоянная»). */
  readonly standing: boolean;
  /** People: the person's own queue («только моя»). */
  readonly mine: boolean;
  readonly paused: boolean;
  /** Sent today by the person. */
  readonly today: number;
  /** The person's portion for the day; null — none («12»). */
  readonly perPerson: number | null;
  /** The day's portion is done («50/50» in green). */
  readonly done: boolean;
  readonly selected: boolean;
}

/** How a queue writes: the act and whether its portion goes by «Отправить всем». */
export interface QueueHowVM {
  /** `auto`, `hi`, `ping`, `reply`, `template`, `own`; another — `auto`. */
  readonly action: 'auto' | 'hi' | 'ping' | 'reply' | 'template' | 'own';
  /** The guide's group of a template queue; null — none or the asker's own texts. */
  readonly group: 'a' | 'b' | null;
  /** The asker's own texts. */
  readonly own: boolean;
  readonly batch: boolean;
}

/** The chosen queue under the chips: its goal, who is in it (the hub's words), how it writes, who asked. */
export interface QueueLineVM {
  readonly goal: string | null;
  readonly rule: readonly string[] | null;
  readonly how: QueueHowVM;
  /** `pool` — every chatter of the page («общая на всех»), `people` — split («только Макс»). */
  readonly people: boolean;
  readonly requestedBy: string;
}

/** «Отправить всем N» of a template queue's portion. */
export interface QueueBatchVM {
  /** Fans whose text would go now. */
  readonly ready: number;
  /** A run is going: how many of it went. */
  readonly running: { readonly done: number; readonly total: number; readonly held: boolean } | null;
  /** Why it cannot go now; null — it can. */
  readonly reason: Msg | null;
}

/** The right pane when no fan's card is open. */
export type QueueEndVM =
  /** The portion went: what of it, the day so far, what is left; «Взять ещё 10». */
  | { readonly kind: 'portion'; readonly sent: number; readonly skipped: number; readonly today: number; readonly perPerson: number | null; readonly page: number; readonly dailyLimit: number | null; readonly pending: number }
  /** The person's portion for the day is done: «Ещё 10» while the page's limit allows (`room`; null — no limit). */
  | { readonly kind: 'day'; readonly today: number; readonly perPerson: number; readonly room: number | null; readonly dailyLimit: number | null }
  /** The queue is paused: by whom and when; its fans stay with it. */
  | { readonly kind: 'paused'; readonly by: string | null; readonly at: IsoTimestamp | null; readonly pending: number }
  /** The page's limit for the day is reached: the queue goes on tomorrow. */
  | { readonly kind: 'limit'; readonly dailyLimit: number | null }
  /** Nobody is left in the queue for the person. */
  | { readonly kind: 'empty' }
  /** The person picks a fan of the portion. */
  | { readonly kind: 'pick' };

export interface QueuesWindowVM {
  /** The hub's list: `loading`, `error` with «Повторить», `empty` — no queue on the page for the person. */
  readonly view: VmView;
  readonly pageName: string | null;
  readonly creator: string | null;
  /** The person working the queues («вы: Макс»). */
  readonly me: string | null;
  readonly stamp: DataStamp;
  readonly chips: readonly QueueChipVM[];
  /** The chosen queue; null — none yet. */
  readonly line: QueueLineVM | null;
  /** «Ответили»: fans who answered a message from a queue, across the page's queues, the newest first. */
  readonly answered: readonly OnlineRowVM[];
  /** «Моя порция»: the chosen queue's fans handed to the person, in the queue's order. */
  readonly portion: readonly OnlineRowVM[];
  /** Fans of the portion not done yet. */
  readonly left: number;
  /** The portion is being taken. */
  readonly taking: boolean;
  /** The chosen queue's day: sent by the person and by the page, the limits, what is left. */
  readonly day: { readonly mine: number; readonly perPerson: number | null; readonly page: number; readonly dailyLimit: number | null; readonly pending: number } | null;
  /** A template queue's «Отправить всем»; null — the queue sends one by one. */
  readonly batch: QueueBatchVM | null;
  readonly card: OnlineCardVM | null;
  readonly end: QueueEndVM | null;
}
