// What the board controllers share inside one tab (architecture.md §10.1
// «активен один оверлей», SP-035, SP-056): which of our overlays are open,
// which fan each preview shows, and how a list answers for its fans — who a
// handle is, who the neighbours are, and, for «Новые», the greeting lease.
// The controllers never import each other: they meet here.

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import { type ClaimVM, type GreetingStatusVM, type NewcomerKind, type PreviewSource, type ReasonVM, type TargetHandle } from '@cg/contracts/vm';

import { type LocalGreeting } from '../../domain/newcomers/rows';

export interface SurfacesState {
  readonly spenders: boolean;
  readonly newcomers: boolean;
  readonly fanPanel: boolean;
  /** The fan each preview shows; null — closed. */
  readonly preview: Readonly<Record<PreviewSource, TargetHandle | null>>;
}

const CLOSED: SurfacesState = { spenders: false, newcomers: false, fanPanel: false, preview: { spenders: null, newcomers: null, palette: null } };

/**
 * Open state of the R12 overlays. The lists are one window at a time: opening
 * one closes the other with its preview. The palette's preview (CS-030) is a
 * window of its own and one of them too: it closes the lists, and a list
 * closes it. The composition root reads it to mount and unmount the surfaces.
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
      next.fanPanel === previous.fanPanel &&
      next.preview.spenders === previous.preview.spenders &&
      next.preview.newcomers === previous.preview.newcomers &&
      next.preview.palette === previous.preview.palette
    ) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener(next, previous);
  }

  setList(list: 'spenders' | 'newcomers', open: boolean): void {
    const s = this.state;
    if (list === 'spenders') {
      this.set(open ? { ...s, spenders: true, newcomers: false, preview: { ...s.preview, newcomers: null, palette: null } } : { ...s, spenders: false, preview: { ...s.preview, spenders: null } });
    } else {
      this.set(open ? { ...s, newcomers: true, spenders: false, preview: { ...s.preview, spenders: null, palette: null } } : { ...s, newcomers: false, preview: { ...s.preview, newcomers: null } });
    }
  }

  setFanPanel(open: boolean): void {
    this.set({ ...this.state, fanPanel: open });
  }

  setPreview(source: PreviewSource, handle: TargetHandle | null): void {
    const s = this.state;
    // The palette's preview opens in its own window: the lists and their previews close.
    if (source === 'palette' && handle !== null) this.set({ ...s, spenders: false, newcomers: false, preview: { spenders: null, newcomers: null, palette: handle } });
    else this.set({ ...s, preview: { ...s.preview, [source]: handle } });
  }

  /** A chat opens from a board: the lists and their previews close (SP-035). */
  closeBoards(): void {
    this.set({ ...this.state, spenders: false, newcomers: false, preview: { spenders: null, newcomers: null, palette: null } });
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
  /** The Generate click that took the lease started no operation: the lease goes back at once, so colleagues are not locked out for nothing. */
  giveBack(fanRef: string): void;
  /** The lease token a greeting is sent under; null — no live lease of this tab. */
  leaseToken(fanRef: string): string | null;
  claim(fanRef: string): ClaimVM;
  greeting(fanRef: string): GreetingStatusVM;
  /** Why Hi is off for the fan; null — it may start. */
  hiBlocked(fanRef: string): ReasonVM | null;
  /** The hub confirms a current subscription to this page (X8 condition 9). */
  subscribed(fanRef: string): boolean;
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
