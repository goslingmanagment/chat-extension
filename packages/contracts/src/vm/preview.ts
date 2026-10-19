// A fan's preview without opening the chat (architecture.md §6.7, §7
// «Превью и «Новые»», §10.2 PreviewVM; ui-design §4.16, §4.17): the hub
// archive only (opening a chat marks it read on OnlyFans), a local draft, the
// mini strip, the result with «Отправить» (X8) and «Открыть и вставить». The
// fan's live text never enters the feed: a newer message shows as one line.

import { type CgErrorView } from '../errors';
import { SENDABLE_FEATURES, type Tone } from '../features';
import { type FeedSender, type PingSegment } from '../hub/feed';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type UiAction } from './actions';
import { type ReasonVM } from './catalog';
import { type DockActionVM } from './dock';
import { type Msg } from './i18n';
import { type MediaPickerVM } from './media';
import { type ClaimVM, type GreetingStatusVM, type NewcomerKind } from './newcomers';
import { type ResultVM } from './result';
import { type PreviewSource, type TargetHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

export interface FeedItemVM {
  readonly id: string;
  /** null — the archive has no time for it (the hub's `at`): no time under the bubble. */
  readonly at: IsoTimestamp | null;
  readonly sender: FeedSender;
  readonly text: string;
  readonly deleted: boolean;
  /** null — unknown: the OF archive has no automation signal (hub `automatic`). */
  readonly automatic: boolean | null;
  /** «, чаевые +$50». */
  readonly tip: MoneyMills | null;
  /** «, $30, куплено» / not bought; null — not a priced message. */
  readonly price: { readonly mills: MoneyMills | null; readonly purchased: boolean | null } | null;
  /** Captions only; media are never loaded. */
  readonly attachments: readonly string[];
  /** A day separator («30 сен») goes before this item. */
  readonly dayBreak: boolean;
}

/** The Ping segment chip (AI-038): computed by the hub with the generation's own window rules. */
export interface PingSegmentVM {
  readonly segment: PingSegment;
  readonly fanSilenceDays: number | null;
}

/** Reply, Fix, Hi, Ping: the features whose result a preview may send (D-14). */
export const PREVIEW_ACTION_IDS = SENDABLE_FEATURES;
export type PreviewActionId = (typeof PREVIEW_ACTION_IDS)[number];

export interface PreviewVM {
  /** `loading` — the feed; `empty` — «Сообщений пока нет.»; `partial` — coverage or the archive lags the chat. */
  readonly view: VmView;
  readonly from: PreviewSource;
  readonly handle: TargetHandle | null;
  readonly header: {
    readonly name: string;
    readonly username: string | null;
    readonly lifetime: MoneyMills | null;
    /** «+$320 за 30 дней», only when above zero. */
    readonly period30: MoneyMills | null;
    readonly weWroteAt: IsoTimestamp | null;
    readonly fanWroteAt: IsoTimestamp | null;
    /** The «Новые» card: «новый, подписка 14 мин назад». */
    readonly newcomer: { readonly kind: NewcomerKind; readonly subscribedAt: IsoTimestamp } | null;
  } | null;
  readonly openChat: ActionButtonVM;
  readonly close: UiAction;
  /** «Чат не открыт, останется непрочитанным»; after the first started send — «…ChatSpace показывает его прочитанным» (§6.7.12). */
  readonly unread: 'kept' | 'read-after-send';
  readonly archive: {
    readonly stamp: DataStamp;
    /** «отстаёт от чата на 2 мин». */
    readonly lagMinutes: number | null;
    readonly refreshing: boolean;
    readonly refresh: ActionButtonVM;
  };
  /** A fan message newer than the result: the blue dot line «Фан написал новое после ответа», no text. */
  readonly fanWroteNew: boolean;
  readonly feed: {
    readonly items: readonly FeedItemVM[];
    readonly hasOlder: boolean;
    readonly loadingOlder: boolean;
    readonly olderError: CgErrorView | null;
  };
  readonly ping: PingSegmentVM | null;
  /** The local draft (Fix source, a greeting draft), up to 5000 characters; never sent by itself. */
  readonly draft: { readonly text: string; readonly maxChars: number; readonly placeholder: Msg };
  /** The mini strip: Reply · Fix · Hi · Ping (only Hi in «Новые»), Tone and Split; no key labels, no persona. */
  readonly bar: {
    readonly actions: Readonly<Partial<Record<PreviewActionId, DockActionVM>>>;
    readonly tone: Tone | null;
    readonly tones: readonly Tone[];
    readonly split: boolean;
    readonly locked: boolean;
    readonly toneReason: ReasonVM | null;
    readonly splitReason: ReasonVM | null;
  };
  readonly result: ResultVM | null;
  /**
   * 1.30.0 (X53): the media picker — the vault's media that go with the next part sent; null — no preview send here, or
   * the host has no vault to read.
   */
  readonly media: MediaPickerVM | null;
  /** Before the first generation: «Reply, Hi или Ping — черновик появится здесь…». */
  readonly idleHint: Msg | null;
  readonly neighbors: { readonly previous: UiAction | null; readonly next: UiAction | null };
  /** «Новые» only. */
  readonly claim: ClaimVM | null;
  readonly greeting: GreetingStatusVM | null;
  /** «Дальше не отправляем, пока неясно, ушла ли часть 2…» under the parts. */
  readonly stoppedNote: Msg | null;
}
