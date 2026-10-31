// Where a site's «who is online» comes from (the adapter's `online`, tab/adapter.ts): what the tab tells the hub
// before the hub's list is read — Fansly's followers active lately (the background's read), ChatSpace's own word of who
// is online (2026-10-31, hub #952) — and, on ChatSpace where the owner's `onlineProbe` is on, how the page's probe
// went for this tab, so the window can say when ChatSpace did not answer.

import type { I18nKey } from '@cg/contracts/errors';

/** The page's probe failed lately in this tab: ChatSpace answered with an error, or said its own read timed out. */
export interface OnlineProbeTrouble {
  readonly kind: 'error' | 'timeout';
  /** When this tab asks for the probe again (epoch ms): it backs off, never hammers. */
  readonly retryAt: number;
}

/** How the page's probe went for this tab (ChatSpace, the owner's `onlineProbe`). */
export interface OnlineProbeStatus {
  /** The probe of the page failed the last time this tab ran it; null — it did not, or it never ran here. */
  trouble(pageId: number): OnlineProbeTrouble | null;
  subscribe(listener: () => void): () => void;
}

/** A site's source of who is online, told to the hub before its list is read. */
export interface OnlineSiteSource {
  /**
   * Who of the page is online by the site's own word, reported to the hub; resolves when the report went (or there
   * was nothing to report), never rejects. `account` — the creator's account on the platform (the binding's).
   */
  seen(pageId: number, account: string): Promise<void>;
  /** The page's probe as this tab ran it; absent — the site has none. */
  readonly probe?: OnlineProbeStatus;
  /**
   * The site's own words for where «who is online» comes from: the window's line, and its empty list. Absent — the
   * words of a page the tab reads itself (Fansly's).
   */
  readonly words?: { readonly line: I18nKey; readonly empty: I18nKey };
}
