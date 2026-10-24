// The media picker of a preview (decision X53): the model's vault read from
// the host's own API, the person's picks for one fan, the price — and what
// the next part sent to that fan takes along. It reads no chat and sends
// nothing: the preview controller asks `attachment` at the click of a part's
// «Отправить», `take`s the picks with the send and `restore`s them when the
// send proved it never reached the platform.
//
// - What the vault holds is the account's and is kept per account while a
//   panel of the account is open: the folders as paged, one folder's media as
//   paged. A list is read when the picker shows it, a next page on «Ещё»; a
//   failed read stays failed until «Повторить». The last panel of the account
//   closed, it is let go (with what the fans got): an open preview costs the
//   tab no vault, and the next opening reads it again.
// - The picks, the price and the open panel are the fan's (account and fan):
//   another fan's preview shows its own, and nothing picked for one fan ever
//   goes to another. The picks and the price stay the chat's for the tab's
//   life, in memory only, until they are sent or the person clears them
//   (2026-10-23, the owner: closing a window never throws away the chatter's
//   work): the last card of the chat closed, its panel closes, and the next
//   card of the chat shows them again. At most `KEPT_MAX` chats with no card
//   open keep them; past that, the one closed the longest ago is let go.
// - What the fan already got of a medium (bought, sent unbought, sent free)
//   is asked for the media a page shows, once per medium and fan.
// - The release forms of the picks (the creators a message with them is
//   tagged with, as ChatSpace's own composer tags it) are asked after every
//   change of the picks; while that short read runs the picks wait. A read
//   that failed is a warning the person passes (2026-10-22, «правь все»): the
//   picks go without tags, and «Повторить» asks again.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type ChatRef } from '@cg/contracts/ids';
import { MEDIA_LIMITS } from '@cg/contracts/limits';
import { type MediaFanState, type MediaFolder, type MediaItem, type MediaPort, type MediaRead } from '@cg/contracts/media';
import { MEDIA_ALL_FOLDER, type MediaFolderId, type MediaTags, type SendMedia } from '@cg/contracts/send-media';
import { type I18n, type MediaCellVM, type MediaFolderVM, type MediaPickerVM, type Msg } from '@cg/contracts/vm';

import { EMPTY_ATTACHMENT, attachmentProblem, attachmentSummary, sendMediaOf, toggleFree, togglePick, type Attachment, type PriceProblem } from '../../domain/media/attachment';
import { type BoardsClock } from '../boards/ports';
import { errorOf, msg } from '../boards/views';

/** The release forms are asked this long after the last change of the picks. */
export const MEDIA_TAGS_DEBOUNCE_MS = 300;

/** The fan of the outreach's own picker («Выбрать медиа»): no fan, so nothing is asked of what a fan got. */
export const OUTREACH_PICKER_FAN = 'outreach';

/** Chats whose picks are kept with no card of theirs open, at most (a pick is a few short fields and a thumbnail's address). */
const KEPT_MAX = 50;

/** No co-creator tags: what the picks go with when their release forms could not be read. */
const NO_TAGS: MediaTags = { users: [], guests: [] };

interface List<T> {
  items: T[];
  hasMore: boolean;
  loading: boolean;
  error: CgErrorWire | null;
  /** Grows with every read started; an answer of an older one is dropped. */
  run: number;
}

const list = <T>(): List<T> => ({ items: [], hasMore: true, loading: false, error: null, run: 0 });

interface Vault {
  readonly folders: List<MediaFolder>;
  readonly media: Map<MediaFolderId, List<MediaItem>>;
}

interface Picker {
  readonly chat: ChatRef;
  open: boolean;
  folder: MediaFolderId;
  attachment: Attachment;
  /** The release forms of exactly `ids` (the picks in order); null — nothing picked. */
  tags: { readonly ids: string; state: 'loading' | 'ok' | 'failed'; value: MediaTags; timer: number | null } | null;
  /** What the fan got of the media asked so far (absent — never sent to the fan). */
  readonly states: Map<string, MediaFanState>;
  /** Media whose state for this fan was asked (answered or in flight). */
  readonly asked: Set<string>;
}

/** Why a read failed, as a CG code with a detail for «Скопировать отчёт». */
function readError<T>(read: Extract<MediaRead<T>, { ok: false }>): CgErrorWire {
  const code: CgCode = read.reason === 'session' ? 'CG-HOST-SESSION' : read.reason === 'timeout' ? 'CG-TIMEOUT' : read.reason === 'network' ? 'CG-NETWORK' : 'CG-HOST-MEDIA';
  return { code, detail: read.status === null ? read.reason : `${read.reason} ${read.status}` };
}

const PRICE_PROBLEM_KEYS = {
  format: 'preview.media.price.format',
  decimals: 'preview.media.price.decimals',
  min: 'preview.media.price.min',
  max: 'preview.media.price.max',
} as const satisfies Record<PriceProblem, string>;

export interface MediaDeskDeps {
  /** HostPort.media; absent — this host has no vault to read. */
  readonly port: MediaPort | undefined;
  readonly clock: Pick<BoardsClock, 'setTimer' | 'clearTimer'>;
  readonly i18n: I18n;
  /** The picker of this chat changed: the previews of its fan are drawn again. */
  readonly changed: (chat: ChatRef) => void;
  /** Whether a card of this chat is open: its picks are never let go to bound the memory. */
  readonly shown: (chat: ChatRef) => boolean;
}

/** What a part's «Отправить» takes along now: nothing, the media, or why the picks cannot go yet. */
export type MediaAttachment = { readonly kind: 'none' } | { readonly kind: 'media'; readonly media: SendMedia } | { readonly kind: 'blocked'; readonly reason: Msg };

export class MediaDesk {
  private readonly vaults = new Map<string, Vault>();
  private readonly pickers = new Map<string, Picker>();

  constructor(private readonly deps: MediaDeskDeps) {}

  /** Whether this host has a vault to pick from. */
  get available(): boolean {
    return this.deps.port !== undefined;
  }

  // ── what the person does ──

  setOpen(chat: ChatRef, open: boolean): void {
    const picker = this.picker(chat);
    picker.open = open;
    if (open) {
      const vault = this.vault(chat.hostAccountId);
      if (vault.folders.items.length === 0 && vault.folders.error === null) void this.readFolders(chat);
      this.showFolder(picker);
    } else this.release(picker);
    this.deps.changed(chat);
  }

  chooseFolder(chat: ChatRef, folder: MediaFolderId): void {
    const picker = this.picker(chat);
    picker.folder = folder;
    this.showFolder(picker);
    this.deps.changed(chat);
  }

  more(chat: ChatRef, what: 'folders' | 'items'): void {
    const picker = this.picker(chat);
    if (what === 'folders') void this.readFolders(chat);
    else void this.readMedia(picker);
  }

  pick(chat: ChatRef, mediaId: string): boolean {
    const picker = this.picker(chat);
    const item = this.findItem(chat.hostAccountId, mediaId) ?? null;
    const picked = picker.attachment.picks.some((pick) => pick.id === mediaId);
    // A pick is dropped by its id; a new one needs the medium as the vault shows it.
    if (!picked && item === null) return false;
    const next = picked ? togglePick(picker.attachment, { id: mediaId, type: 'photo', duration: 0, ready: true, thumb: null, createdAt: null }) : togglePick(picker.attachment, item as MediaItem);
    if (next === picker.attachment) return false;
    picker.attachment = next;
    this.picksChanged(picker);
    return true;
  }

  toggleFree(chat: ChatRef, mediaId: string): boolean {
    const picker = this.picker(chat);
    if (!picker.attachment.picks.some((pick) => pick.id === mediaId)) return false;
    picker.attachment = toggleFree(picker.attachment, mediaId);
    this.deps.changed(chat);
    return true;
  }

  setPrice(chat: ChatRef, text: string): void {
    const picker = this.picker(chat);
    picker.attachment = { ...picker.attachment, price: text.slice(0, 16) };
    this.deps.changed(chat);
  }

  clear(chat: ChatRef): void {
    const picker = this.pickers.get(keyOf(chat));
    if (picker === undefined) return;
    picker.attachment = EMPTY_ATTACHMENT;
    this.picksChanged(picker);
  }

  /** «Повторить»: every failed read of what this picker shows, and the release forms. */
  retry(chat: ChatRef): void {
    const picker = this.picker(chat);
    const vault = this.vault(chat.hostAccountId);
    if (vault.folders.error !== null) {
      vault.folders.error = null;
      void this.readFolders(chat);
    }
    const media = vault.media.get(picker.folder);
    if (media !== undefined && media.error !== null) {
      media.error = null;
      void this.readMedia(picker);
    }
    if (picker.tags?.state === 'failed') this.picksChanged(picker);
    this.deps.changed(chat);
  }

  // ── the send ──

  /** What a part's «Отправить» to this chat takes along now. */
  attachment(chat: ChatRef): MediaAttachment {
    const picker = this.pickers.get(keyOf(chat));
    if (picker === undefined || picker.attachment.picks.length === 0) return { kind: 'none' };
    const blocked = this.blockedReason(picker);
    if (blocked !== null) return { kind: 'blocked', reason: blocked };
    // A failed tags read leaves `value` empty: the picks go without tags (the panel's note says so).
    const media = picker.tags === null ? null : sendMediaOf(picker.attachment, picker.tags.state === 'ok' ? picker.tags.value : NO_TAGS);
    return media === null ? { kind: 'blocked', reason: msg('preview.media.blocked.price') } : { kind: 'media', media };
  }

  /** A part's «Отправить» takes the picks: they leave the picker with the send, and the panel closes. */
  take(chat: ChatRef): Attachment | null {
    const picker = this.pickers.get(keyOf(chat));
    if (picker === undefined || picker.attachment.picks.length === 0) return null;
    const taken = picker.attachment;
    picker.attachment = EMPTY_ATTACHMENT;
    picker.open = false;
    this.release(picker);
    this.picksChanged(picker);
    return taken;
  }

  /** «Рассылка»: this chat's picks as they stand, when valid — what every fan of the outreach then takes; null — none. */
  copyOf(chat: ChatRef): Attachment | null {
    const picker = this.pickers.get(keyOf(chat));
    if (picker === undefined || picker.attachment.picks.length === 0 || attachmentProblem(picker.attachment) !== null) return null;
    return picker.attachment;
  }

  /**
   * «Рассылка»: the outreach's picks go to this fan, as if picked in their card — unless the person picked something of
   * the fan's own (`previous` — what the outreach gave this fan before: those are replaced). Their release forms and what
   * the fan already got of them are read as for any picks. True — the fan's picks are the outreach's now.
   */
  adopt(chat: ChatRef, attachment: Attachment, previous: Attachment | null = null): boolean {
    const picker = this.picker(chat);
    if (picker.attachment === attachment) return true;
    if (picker.attachment.picks.length > 0 && picker.attachment !== previous) return false;
    picker.attachment = attachment;
    this.picksChanged(picker);
    this.trim();
    return true;
  }

  /**
   * The send never reached the platform: its picks come back to the chat — also when its card was closed meanwhile (the
   * next card of the chat shows them) — unless the person has picked something since (their new picks stand).
   */
  restore(chat: ChatRef, taken: Attachment): void {
    if ((this.pickers.get(keyOf(chat))?.attachment.picks.length ?? 0) > 0) return;
    const picker = this.picker(chat);
    picker.attachment = taken;
    this.picksChanged(picker);
    this.trim();
  }

  /**
   * The last card of this chat closed: its panel closes (the vault goes once no panel of the account is open); the picks
   * and the price stay for the next card of the chat. A picker with nothing in it is let go.
   */
  leave(chat: ChatRef): void {
    const key = keyOf(chat);
    const picker = this.pickers.get(key);
    if (picker === undefined) return;
    picker.open = false;
    this.release(picker);
    if (picker.attachment.picks.length === 0 && picker.attachment.price === '') {
      this.forget(key);
      return;
    }
    // Put last (its release forms' read goes on): the chats kept are let go in that order, the one closed first first.
    this.pickers.delete(key);
    this.pickers.set(key, picker);
    this.trim();
  }

  /** Past `KEPT_MAX` chats kept with no card open, the ones closed the longest ago are let go. */
  private trim(): void {
    const idle = [...this.pickers.entries()].filter(([, picker]) => !this.deps.shown(picker.chat));
    for (const [key] of idle.slice(0, Math.max(0, idle.length - KEPT_MAX))) this.forget(key);
  }

  /** The chat's picker is let go, with the read of its release forms still to go. */
  private forget(key: string): void {
    const timer = this.pickers.get(key)?.tags?.timer ?? null;
    if (timer !== null) this.deps.clock.clearTimer(timer);
    this.pickers.delete(key);
  }

  /** A panel closed: what the fan got is let go, and the vault with it once no panel of the account is open. */
  private release(picker: Picker): void {
    picker.states.clear();
    picker.asked.clear();
    const { hostAccountId } = picker.chat;
    if (![...this.pickers.values()].some((other) => other.open && other.chat.hostAccountId === hostAccountId)) this.vaults.delete(hostAccountId);
  }

  /** Another sign-in or account: nothing of the old one is kept. */
  reset(): void {
    for (const picker of this.pickers.values()) {
      const timer = picker.tags?.timer ?? null;
      if (timer !== null) this.deps.clock.clearTimer(timer);
    }
    this.pickers.clear();
    this.vaults.clear();
  }

  // ── the view ──

  vm(chat: ChatRef): MediaPickerVM | null {
    if (!this.available) return null;
    const { i18n } = this.deps;
    const picker = this.pickers.get(keyOf(chat));
    const vault = this.vaults.get(chat.hostAccountId);
    const attachment = picker?.attachment ?? EMPTY_ATTACHMENT;
    const folder = picker?.folder ?? MEDIA_ALL_FOLDER;
    const folders = vault?.folders;
    const media = vault?.media.get(folder);
    const order = new Map(attachment.picks.map((pick, i) => [pick.id, i + 1]));
    const free = new Set(attachment.picks.filter((pick) => pick.free).map((pick) => pick.id));
    const summary = attachmentSummary(attachment);
    const problem = attachmentProblem(attachment);
    const sendable = this.attachment(chat);
    const folderItems: MediaFolderVM[] = [
      { id: MEDIA_ALL_FOLDER, name: null, count: null, selected: folder === MEDIA_ALL_FOLDER },
      ...(folders?.items ?? []).map((item) => ({ id: item.id, name: item.name, count: item.photos + item.videos + item.other, selected: folder === item.id })),
    ];
    const cells: MediaCellVM[] = (media?.items ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      duration: item.duration,
      thumb: item.thumb,
      ready: item.ready,
      order: order.get(item.id) ?? null,
      free: free.has(item.id),
      fan: picker?.states.get(item.id)?.state ?? null,
    }));
    return {
      open: picker?.open ?? false,
      folders: { items: folderItems, hasMore: folders?.hasMore ?? false, loading: folders?.loading ?? false, error: folders?.error ? errorOf(folders.error, i18n) : null },
      grid: { items: cells, hasMore: media?.hasMore ?? false, loading: media?.loading ?? false, error: media?.error ? errorOf(media.error, i18n) : null },
      picks: summary.count,
      price: { text: attachment.price, problem: problem?.kind === 'price' ? msg(PRICE_PROBLEM_KEYS[problem.problem]) : null },
      priced: summary.priceCents !== null && summary.priceCents > 0,
      summary: summary.count === 0 ? null : summaryMsg(i18n, summary.count, summary.previews, summary.priceCents),
      attached: sendable.kind === 'media' ? { count: sendable.media.items.length, priceCents: sendable.media.priceCents } : null,
      blocked: sendable.kind === 'blocked' ? sendable.reason : null,
      allFree: problem?.kind === 'all-free',
      tags: picker?.tags?.state ?? 'none',
    };
  }

  // ── reads ──

  private picker(chat: ChatRef): Picker {
    const key = keyOf(chat);
    let picker = this.pickers.get(key);
    if (picker === undefined) {
      picker = { chat, open: false, folder: MEDIA_ALL_FOLDER, attachment: EMPTY_ATTACHMENT, tags: null, states: new Map(), asked: new Set() };
      this.pickers.set(key, picker);
    }
    return picker;
  }

  private vault(hostAccountId: string): Vault {
    let vault = this.vaults.get(hostAccountId);
    if (vault === undefined) {
      vault = { folders: list(), media: new Map() };
      this.vaults.set(hostAccountId, vault);
    }
    return vault;
  }

  private findItem(hostAccountId: string, mediaId: string): MediaItem | undefined {
    for (const media of this.vault(hostAccountId).media.values()) {
      const item = media.items.find((candidate) => candidate.id === mediaId);
      if (item !== undefined) return item;
    }
    return undefined;
  }

  /** The folder the picker shows is read when nothing of it is (or its read failed and was retried). */
  private showFolder(picker: Picker): void {
    const media = this.vault(picker.chat.hostAccountId).media.get(picker.folder);
    if (media === undefined) void this.readMedia(picker);
    else this.askStates(picker, media.items);
  }

  /** Every chat of the account whose picker shows what changed. */
  private changedAccount(hostAccountId: string): void {
    for (const picker of this.pickers.values()) if (picker.chat.hostAccountId === hostAccountId) this.deps.changed(picker.chat);
  }

  private async readFolders(chat: ChatRef): Promise<void> {
    const port = this.deps.port;
    const folders = this.vault(chat.hostAccountId).folders;
    if (port === undefined || folders.loading || !folders.hasMore) return;
    const run = ++folders.run;
    folders.loading = true;
    this.changedAccount(chat.hostAccountId);
    const read = await port.folders(chat.hostAccountId, folders.items.length);
    if (run !== folders.run || this.vaults.get(chat.hostAccountId)?.folders !== folders) return;
    folders.loading = false;
    if (read.ok) {
      const known = new Set(folders.items.map((item) => item.id));
      folders.items.push(...read.value.items.filter((item) => !known.has(item.id)));
      folders.hasMore = read.value.hasMore && read.value.items.length > 0;
      folders.error = null;
    } else folders.error = readError(read);
    this.changedAccount(chat.hostAccountId);
  }

  private async readMedia(picker: Picker): Promise<void> {
    const port = this.deps.port;
    const { hostAccountId } = picker.chat;
    const folder = picker.folder;
    const vault = this.vault(hostAccountId);
    let media = vault.media.get(folder);
    if (media === undefined) {
      media = list();
      vault.media.set(folder, media);
    }
    if (port === undefined || media.loading || !media.hasMore) return;
    const run = ++media.run;
    media.loading = true;
    this.changedAccount(hostAccountId);
    const read = await port.items(hostAccountId, folder, media.items.length);
    if (run !== media.run || this.vaults.get(hostAccountId)?.media.get(folder) !== media) return;
    media.loading = false;
    if (read.ok) {
      const known = new Set(media.items.map((item) => item.id));
      const fresh = read.value.items.filter((item) => !known.has(item.id));
      media.items.push(...fresh);
      media.hasMore = read.value.hasMore && read.value.items.length > 0;
      media.error = null;
      for (const other of this.pickers.values()) if (other.chat.hostAccountId === hostAccountId && other.folder === folder) this.askStates(other, fresh);
    } else media.error = readError(read);
    this.changedAccount(hostAccountId);
  }

  /** What the fan got of these media, for those not asked yet; a failed ask is not repeated (a marker is a hint). */
  private askStates(picker: Picker, items: readonly MediaItem[]): void {
    const port = this.deps.port;
    if (port === undefined || !picker.open || picker.chat.platformFanId === OUTREACH_PICKER_FAN) return;
    const ids = items.map((item) => item.id).filter((id) => !picker.asked.has(id));
    for (let at = 0; at < ids.length; at += MEDIA_LIMITS.idsPerRequest) {
      const batch = ids.slice(at, at + MEDIA_LIMITS.idsPerRequest);
      for (const id of batch) picker.asked.add(id);
      void port.fanStates(picker.chat, batch).then((read) => {
        // A panel closed meanwhile let what the fan got go: a late answer does not bring it back.
        if (!read.ok || !picker.open || this.pickers.get(keyOf(picker.chat)) !== picker) return;
        for (const state of read.value) picker.states.set(state.id, state);
        this.deps.changed(picker.chat);
      });
    }
  }

  /** The picks changed: their release forms are asked again, after a short pause. */
  private picksChanged(picker: Picker): void {
    const { clock } = this.deps;
    const timer = picker.tags?.timer ?? null;
    if (timer !== null) clock.clearTimer(timer);
    const ids = picker.attachment.picks.map((pick) => pick.id);
    if (ids.length === 0 || this.deps.port === undefined) picker.tags = null;
    else {
      const tags: NonNullable<Picker['tags']> = { ids: ids.join(','), state: 'loading', value: { users: [], guests: [] }, timer: null };
      picker.tags = tags;
      tags.timer = clock.setTimer(MEDIA_TAGS_DEBOUNCE_MS, () => {
        tags.timer = null;
        void this.deps.port?.tags(picker.chat.hostAccountId, ids).then((read) => {
          if (picker.tags !== tags || this.pickers.get(keyOf(picker.chat)) !== picker) return;
          if (read.ok) {
            tags.state = 'ok';
            tags.value = read.value;
          } else tags.state = 'failed';
          this.deps.changed(picker.chat);
        });
      });
    }
    this.deps.changed(picker.chat);
  }

  private blockedReason(picker: Picker): Msg | null {
    const problem = attachmentProblem(picker.attachment);
    if (problem?.kind === 'price') return msg('preview.media.blocked.price');
    if (problem?.kind === 'all-free') return msg('preview.media.blocked.allFree');
    if (picker.tags === null || picker.tags.state === 'loading') return msg('preview.media.blocked.tagsLoading');
    return null;
  }
}

const keyOf = (chat: ChatRef): string => `${chat.hostAccountId}|${chat.platformFanId}`;

/** «$25», «$24.99»: a price as OnlyFans shows it, never rounded. */
export const priceText = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** «3 медиа · 1 бесплатное превью · $25» / «2 медиа бесплатно». */
function summaryMsg(i18n: I18n, count: number, previews: number, priceCents: number | null): Msg {
  const media = i18n.plural('preview.media.count', count, { n: count });
  if (priceCents === null || priceCents === 0) return msg('preview.media.summaryFree', { media });
  return previews > 0
    ? msg('preview.media.summaryPaidPreviews', { media, previews: i18n.plural('preview.media.previews', previews, { n: previews }), price: priceText(priceCents) })
    : msg('preview.media.summaryPaid', { media, price: priceText(priceCents) });
}
