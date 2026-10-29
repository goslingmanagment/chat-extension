// What the board controllers share inside one tab (architecture.md §10.1
// «активен один оверлей», SP-035, SP-056): which of our overlays are open,
// which fan each preview shows, and how a list answers for its fans — who a
// handle is, who the neighbours are, and, for «Новые», the greeting lease.
// The controllers never import each other: they meet here.

import { type FanBadges } from '@cg/contracts/fan-badges';
import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import { type ClaimVM, type GreetingStatusVM, type NewcomerKind, type PreviewSource, type ReasonVM, type TargetHandle } from '@cg/contracts/vm';

import { type LocalGreeting } from '../../domain/newcomers/rows';

export interface SurfacesState {
  readonly spenders: boolean;
  readonly newcomers: boolean;
  /** 1.63.0: the window of «Рассылка». */
  readonly outreach: boolean;
  /** «Рассылка» folded into its chip in the page's corner: its outreach goes on while the person works in the chats. */
  readonly outreachChip: boolean;
  /** 1.65.0: the window of «Онлайн». */
  readonly online: boolean;
  /** 2026-10-29: the window of «Очереди». */
  readonly queues: boolean;
  readonly fanPanel: boolean;
  /** The fan each preview shows; null — closed. */
  readonly preview: Readonly<Record<PreviewSource, TargetHandle | null>>;
}

const NO_PREVIEW: SurfacesState['preview'] = { spenders: null, newcomers: null, palette: null, outreach: null, online: null, queue: null };
const CLOSED: SurfacesState = { spenders: false, newcomers: false, outreach: false, outreachChip: false, online: false, queues: false, fanPanel: false, preview: NO_PREVIEW };
type List = 'spenders' | 'newcomers' | 'outreach' | 'online' | 'queues';
const LISTS: readonly List[] = ['spenders', 'newcomers', 'outreach', 'online', 'queues'];
/** The preview each list's window holds: «Очереди»'s card is the preview from `queue`. */
const PREVIEW_OF: Readonly<Record<List, PreviewSource>> = { spenders: 'spenders', newcomers: 'newcomers', outreach: 'outreach', online: 'online', queues: 'queue' };

/**
 * Open state of the R12 overlays. The lists — Spenders, «Новые», «Рассылка», «Онлайн» — are
 * one window at a time: opening one closes the others with their previews. The
 * palette's preview (CS-030) is a window of its own and one of them too: it
 * closes the lists, and a list closes it. «Рассылка» may fold into a chip that
 * stays on the page under any window. The composition root reads it to mount
 * and unmount the surfaces.
 */
export class Surfaces {
  private state: SurfacesState = CLOSED;
  private readonly listeners = new Set<(state: SurfacesState, previous: SurfacesState) => void>();

  current(): SurfacesState {
    return this.state;
  }

  subscribe(listener: (state: SurfacesState, previous: SurfacesState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: SurfacesState): void {
    const previous = this.state;
    if (
      next.spenders === previous.spenders &&
      next.newcomers === previous.newcomers &&
      next.outreach === previous.outreach &&
      next.outreachChip === previous.outreachChip &&
      next.online === previous.online &&
      next.queues === previous.queues &&
      next.fanPanel === previous.fanPanel &&
      next.preview.spenders === previous.preview.spenders &&
      next.preview.newcomers === previous.preview.newcomers &&
      next.preview.palette === previous.preview.palette &&
      next.preview.outreach === previous.preview.outreach &&
      next.preview.online === previous.preview.online &&
      next.preview.queue === previous.preview.queue
    ) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener(next, previous);
  }

  setList(list: List, open: boolean): void {
    const s = this.state;
    if (!open) {
      this.set({ ...s, [list]: false, preview: { ...s.preview, [PREVIEW_OF[list]]: null } });
      return;
    }
    // One list at a time: the others close with their previews, and so does the palette's.
    const preview = { ...s.preview, palette: null };
    for (const other of LISTS) if (other !== list) preview[PREVIEW_OF[other]] = null;
    this.set({ ...s, spenders: list === 'spenders', newcomers: list === 'newcomers', outreach: list === 'outreach', online: list === 'online', queues: list === 'queues', preview });
  }

  /** «Свернуть» of «Рассылка» and back: the chip in the page's corner. */
  setOutreachChip(on: boolean): void {
    this.set({ ...this.state, outreachChip: on });
  }

  setFanPanel(open: boolean): void {
    this.set({ ...this.state, fanPanel: open });
  }

  setPreview(source: PreviewSource, handle: TargetHandle | null): void {
    const s = this.state;
    // The palette's preview opens in its own window: the lists and their previews close.
    if (source === 'palette' && handle !== null) this.set({ ...s, spenders: false, newcomers: false, outreach: false, online: false, queues: false, preview: { ...NO_PREVIEW, palette: handle } });
    else this.set({ ...s, preview: { ...s.preview, [source]: handle } });
  }

  /**
   * A chat opens from a board: the lists and their previews close (SP-035). «Рассылка» folds into its chip: the person
   * looks at the chat and comes back to the outreach with one click.
   */
  closeBoards(): void {
    const s = this.state;
    this.set({ ...s, spenders: false, newcomers: false, outreach: false, online: false, queues: false, outreachChip: s.outreachChip || s.outreach, preview: NO_PREVIEW });
  }

  closeAll(): void {
    this.set(CLOSED);
  }

  clear(): void {
    this.listeners.clear();
    this.state = CLOSED;
  }
}

/** A fan as a preview target: what the list that listed the fan knows. */
export interface PreviewTargetInfo {
  readonly handle: TargetHandle;
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
  /**
   * The fan's conversation when the list knows it and it is not the fan — on Fansly the group id the list resolved
   * for this fan (FS-SPD-2), never the route of the chat on screen. Absent — the conversation is the fan (ChatSpace).
   */
  readonly conversationRef?: string;
  readonly name: string;
  readonly username: string | null;
  readonly lifetime: MoneyMills | null;
  /** Spent in the last 30 days, when the list knows exactly that; null — unknown. */
  readonly period30: MoneyMills | null;
  readonly weWroteAt: IsoTimestamp | null;
  readonly fanWroteAt: IsoTimestamp | null;
  readonly newcomer: { readonly kind: NewcomerKind; readonly subscribedAt: IsoTimestamp } | null;
  /** Fansly: the fan's blue card and FBuddy's gem, as the list knows them; absent or null — none known. */
  readonly badges?: FanBadges | null;
}

/** How a list answers for its fans. */
export interface PreviewDirectory {
  /** A passive lookup before opening the card, without marking the conversation read. */
  prepare?(handle: TargetHandle): Promise<void>;
  /** Its chat button can resolve a conversation on the person's click. */
  readonly canResolve?: boolean;
  resolve(handle: TargetHandle): PreviewTargetInfo | null;
  /** The fans before and after in the order the list shows them. */
  neighbours(handle: TargetHandle): { readonly previous: TargetHandle | null; readonly next: TargetHandle | null };
  /** The list changed (rows, order): the preview's header and neighbours follow. */
  subscribe(listener: () => void): () => void;
}

/** The «Новые» side of a preview: the greeting lease and status of the fan on the card (H-7). */
export interface GreetingDesk {
  /**
   * Takes the lease for a Generate click (it is taken there, §8.5); a refusal
   * names its code. `taken` — this very call took a lease the tab did not hold.
   */
  claimForGenerate(fanRef: string): Promise<{ readonly ok: true; readonly taken: boolean } | { readonly ok: false; readonly code: CgCode; readonly error: CgErrorView }>;
  /**
   * 1.32.0: the person opened the card of a greeting a batch made while nobody looked: a lease of this tab that ran
   * out meanwhile is taken again (never a colleague's), so the greeting's parts can be sent. Optional: a desk without
   * it keeps «бронь истекла — нажмите Hi ещё раз».
   */
  reclaim?(fanRef: string): void;
  /** The Generate click that took the lease started no operation: the lease goes back at once, so colleagues are not locked out for nothing. */
  giveBack(fanRef: string): void;
  /** The lease token a greeting is sent under; null — no live lease of this tab. */
  leaseToken(fanRef: string): string | null;
  claim(fanRef: string): ClaimVM;
  greeting(fanRef: string): GreetingStatusVM;
  /** Why Hi is off for the fan; null — it may start. */
  hiBlocked(fanRef: string): ReasonVM | null;
  /** A fingerprint of the fan's thread as the list shows it now; a draft written on another one is stale (NF-018). */
  threadRevision(fanRef: string): string | null;
  /** Parts of the greeting this tab sends, as the preview's attempts stand. */
  noteProgress(fanRef: string, progress: LocalGreeting['progress']): void;
  /** The person did something with the fan (the lease is renewed only while they do); `busy` — something is in flight. */
  touch(fanRef: string, busy: boolean): void;
  /** A claim refusal the hub gave to a send of this fan (the lease was lost). */
  noteRefusal(fanRef: string, code: CgCode): void;
  subscribe(listener: () => void): () => void;
}
