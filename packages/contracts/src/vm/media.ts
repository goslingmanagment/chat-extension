// 1.30.0 (decision X53): the media picker of a preview — the model's vault
// read from the host's own API, the person's picks in order, the free
// previews among them, the price. What it holds goes with the part whose
// «Отправить» the person clicks next: one message, the part's text as its
// caption. The picker reads no chat and sends nothing by itself.

import { type CgErrorView } from '../errors';
import { type MediaFanState } from '../media';
import { type MediaFolderId, type MediaType } from '../send-media';
import { type Msg } from './i18n';

export interface MediaFolderVM {
  readonly id: MediaFolderId;
  /** null — «Все медиа». */
  readonly name: string | null;
  /** Photos and videos and the rest; null — not said («Все медиа»). */
  readonly count: number | null;
  readonly selected: boolean;
}

export interface MediaCellVM {
  readonly id: string;
  readonly type: MediaType;
  /** Seconds; 0 — a photo. */
  readonly duration: number;
  readonly thumb: string | null;
  /** The platform finished it and the account may send it; a cell that is not is shown, never picked. */
  readonly ready: boolean;
  /** 1-based place in the message (the previews first); null — not picked. */
  readonly order: number | null;
  /** Picked as a free preview (it means one in a priced message). */
  readonly free: boolean;
  /** What this fan already got of it; null — never sent to the fan, or not known yet. */
  readonly fan: MediaFanState['state'] | null;
}

/** A list read from the host's API: what it has, whether more pages exist, the read in flight, its failure. */
export interface MediaListVM<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: CgErrorView | null;
}

export interface MediaPickerVM {
  /** The panel is open; closed, the picks stay and the strip says what goes. */
  readonly open: boolean;
  readonly folders: MediaListVM<MediaFolderVM>;
  readonly grid: MediaListVM<MediaCellVM>;
  readonly picks: number;
  /** The picks made as free previews (the picker's «Превью» step), whether or not a price makes them mean one. */
  readonly previews: number;
  /** The price field as typed and what is wrong with it. */
  readonly price: { readonly text: string; readonly problem: Msg | null };
  /** The typed price is a valid PPV price: the picks' free-preview marks mean something. */
  readonly priced: boolean;
  /** «3 медиа · 1 бесплатное превью · $25» / «2 медиа бесплатно»; null — nothing picked. */
  readonly summary: Msg | null;
  /** What a part's «Отправить» takes along; null — nothing, or not valid yet (`blocked` says why). */
  readonly attached: { readonly count: number; readonly priceCents: number } | null;
  /** Why the picks cannot go yet, as the part's «Отправить» says it (a reason fragment): the price, the release forms. */
  readonly blocked: Msg | null;
  /** A priced message whose every pick is a free preview: one at least must stay behind the price. */
  readonly allFree: boolean;
  /** The release forms of the picks: none picked, being read, read, not read («Повторить»). */
  readonly tags: 'none' | 'loading' | 'ok' | 'failed';
  /**
   * «Рассылка» of Spenders is open on this site: `offer` — «Для всей рассылки» takes these valid picks for every fan of
   * it; `set` — these picks are the outreach's. Absent — no outreach, or nothing valid picked.
   */
  readonly outreach?: 'offer' | 'set';
}
