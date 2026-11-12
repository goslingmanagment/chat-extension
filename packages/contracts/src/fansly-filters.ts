// The filters above Fansly's chats (2026-11-13): Fansly's own block of filter chips over a creator's list of chats (All,
// Subscribers, a chip per tier, VIPs, Followers, a chip per pinned list, the pencil and the refresh) drawn again as one
// of two strips the chatter picks in the settings (`settings.ext` `filterStrip`): «Две полки» (`shelves`) or «Четыре
// группы» (`groups`); `native` leaves Fansly's chips as they are.
//
// Either strip changes how the block looks, never what it does:
// - Fansly's block stays in the page, hidden; every filter click is a click on Fansly's own chip, made in the
//   person's own click or key (host-fansly isolated/inbox-filters.ts); MAIN never clicks.
// - What exists, which filter is on and every count are read from Fansly's block. The full names of tiers and lists and
//   the unread of the loaded chats by what decides each filter are read from the page's own answers in MAIN
//   (`fx.filters`): the extension asks Fansly nothing.
// - All or nothing: a block that does not read, a fan's list, a click Fansly did not take — Fansly's chips come back
//   untouched; never an empty strip, never one beside Fansly's visible block, never a state not read from Fansly.
//
// The pure rules (the kind of a list, a tier's words, the spend ladder, the shelves' layout, the groups' numbers and
// their self-check) are core's (domain/hosts/fansly/filters.ts); the controller is core's
// (application/hosts/fansly/filters.ts); the views are ui's (hosts/fansly/filters). Here: the types they share, the
// limits of MAIN's event, and the per-chatter memory of «Четыре группы» the background keeps.

import * as z from 'zod/mini';

import { NativeIdSchema, boundedText } from './primitives';

export const FANSLY_FILTER_LIMITS = {
  /** Fansly allows ten tiers (its tier editor); room for more, never trusted to stay ten. */
  tiers: 40,
  /** Pinned lists MAIN reads from the page's setting. */
  lists: 200,
  /** A name of a tier or a list as the page's answers carry it. */
  nameMaxChars: 200,
  /** Loaded chats with unread messages MAIN says (more: the copy is not trusted, the numbers fall back). */
  unreadRows: 600,
  /** Lists one fan is in, as MAIN says them. */
  rowLists: 64,
  /** Distinct list ids over the rows. */
  listIds: 2000,
  /** The shelves' content below this width: Fansly's chips instead (All, Subscribers and «ещё N» no longer fit). */
  minWidthPx: 300,
  /** The strip's height of «Четыре группы» on every set: no layout moves when its numbers do. */
  groupsPx: 30,
} as const;

/** One of Fansly's fixed chips. `staff` — the chip Fansly shows on an account that has a chat with Fansly's staff. */
export type FanslyFilterBase = 'all' | 'subscribers' | 'staff' | 'vips' | 'followers';

/** A filter as one of Fansly's chips: its kind and its place among the chips of its kind, with the label it printed. */
export type FanslyFilterRef =
  | { readonly kind: 'base'; readonly base: FanslyFilterBase }
  | { readonly kind: 'tier'; readonly index: number; readonly label: string }
  | { readonly kind: 'list'; readonly index: number; readonly label: string };

/** One chip as the page prints it: never its whole text (the badge is inside it). */
export interface FanslyFilterChip {
  readonly label: string;
  readonly active: boolean;
  /** The badge as printed: `7`, `99+`; null — none (Fansly prints it above zero only). */
  readonly count: string | null;
}

/** Fansly's block of a creator's list of chats, as read from the page (shelves spec §8.2). */
export interface FanslyFilterBlock {
  readonly all: FanslyFilterChip;
  readonly subscribers: FanslyFilterChip;
  readonly staff: FanslyFilterChip | null;
  readonly vips: FanslyFilterChip;
  readonly followers: FanslyFilterChip;
  /** Fansly's order; `color` — the star's own colour, null — none set. */
  readonly tiers: ReadonlyArray<FanslyFilterChip & { readonly color: string | null }>;
  /** The order they were pinned in. */
  readonly lists: readonly FanslyFilterChip[];
  /** Fansly's refresh icon spins (a reload of the list is on its way). */
  readonly spinning: boolean;
  /** The strip's content width: the list's column less its borders and the strip's margins (CSS px). */
  readonly width: number;
}

/** Why the block does not read: Fansly's chips stay as they are. */
export type FanslyFilterRefusal = 'no-block' | 'fan-branch' | 'unknown-chip' | 'missing-chip' | 'order' | 'badge' | 'hidden' | 'click';

export type FanslyFilterRead = { readonly ok: true; readonly block: FanslyFilterBlock } | { readonly ok: false; readonly reason: FanslyFilterRefusal };

/** The full names the page's own answers gave (MAIN): `/account/me` tiers with an active plan, the pinned lists' setting. */
export interface FanslyFilterNames {
  /** null — no `/account/me` read yet. */
  readonly tiers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly color: string | null }> | null;
  /** null — the pinned lists' setting not read yet. */
  readonly lists: ReadonlyArray<{ readonly id: string; readonly label: string }> | null;
}

/** A loaded chat with unread messages, by what decides Fansly's filters: its fan's subscription, tier and lists. */
export interface FanslyFilterUnreadRow {
  readonly unread: number;
  readonly subscriber: boolean;
  readonly tierId: string | null;
  readonly lists: readonly string[];
}

/** MAIN's copy of the page's unread by filter facts (groups spec §7); null where not known. */
export interface FanslyFilterUnread {
  readonly rows: readonly FanslyFilterUnreadRow[];
}

/** What the two strips can ask of Fansly's block, each a click of Fansly's own in the person's handler. */
export interface FanslyFilterActions {
  /** A filter: a click on its chip. false — the chip is gone or no longer what it was. */
  select(ref: FanslyFilterRef): boolean;
  /** Unpin a list: a click on its chip's trash (Fansly unpins it for the whole account). */
  unpin(ref: Extract<FanslyFilterRef, { kind: 'list' }>): boolean;
  /** Fansly's pencil: its own «Select a List» window. */
  pin(): boolean;
  /** Fansly's refresh: the unread and the list read again. */
  refresh(): boolean;
}

// ── The memory of «Четыре группы» (groups spec §9) ─────────────────────────────

/**
 * A group's remembered pick: the tier or the list picked last from its menu, by the page's id when the names are known,
 * else `label:<the chip's label>`; null — none.
 */
export const FanslyFilterMemoKeySchema = z.nullable(boundedText(FANSLY_FILTER_LIMITS.nameMaxChars + 6));

/** One creator's memory: the last tier and the last list picked from the menus. */
export const FanslyFilterMemoSchema = z.strictObject({ tier: FanslyFilterMemoKeySchema, list: FanslyFilterMemoKeySchema });
export type FanslyFilterMemo = z.infer<typeof FanslyFilterMemoSchema>;

export const EMPTY_FILTER_MEMO: FanslyFilterMemo = { tier: null, list: null };

/** A change of one group's memory. */
export const FanslyFilterMemoChangeSchema = z.strictObject({ hostAccountId: NativeIdSchema, group: z.enum(['tier', 'list']), key: FanslyFilterMemoKeySchema });

// ── The view (types only) ────────────────────────────────────────────────────

/** Kinds of a filter as the strips draw it: Fansly's fixed chips, a tier, a step of the spend ladder, another FBuddy list, the agency's own. */
export type FanslyFilterKind = 'base' | 'tier' | 'step' | 'fb' | 'own';

/** One filter of the block, read and classified: what both strips are drawn from. */
export interface FanslyFilterItem {
  /** Stable within a set: `all`, `subscribers`, `staff`, `vips`, `followers`, `tier:<i>`, `list:<i>`. */
  readonly key: string;
  readonly ref: FanslyFilterRef;
  readonly kind: FanslyFilterKind;
  /** The words the strip prints: Fansly's label of a fixed chip, a tier's words, a list's name without its emoji or `[FB]`. */
  readonly label: string;
  /** The whole name: the page's data when it agrees with the chip, else the chip's label. */
  readonly full: string;
  /** Fansly cut the chip's name and the whole one is not known. */
  readonly cut: boolean;
  /** A tier's star colour; null — none set. */
  readonly color: string | null;
  /** An own list's leading emoji. */
  readonly emoji: string | null;
  /** A step of the spend ladder: dollars, `hi` null — open-ended. */
  readonly step: { readonly lo: number; readonly hi: number | null } | null;
  /** The page's id of the tier or list, when its name agreed; null — not known. */
  readonly id: string | null;
  /** The memory's key of a tier or a list (`id`, else `label:<label>`). */
  readonly memo: string | null;
  /** Fansly's badge as printed; null — none. */
  readonly count: string | null;
  /** The badge as a number (`99+` is 100); 0 — none. */
  readonly n: number;
  readonly active: boolean;
}

/** The set the layout depends on: what exists and its names, never a count, a selection, a hover or a focus. */
export interface FanslyFilterSet {
  /** Changes only when a filter comes or goes, or a name or colour changes. */
  readonly signature: string;
  readonly base: ReadonlyArray<FanslyFilterItem>;
  readonly tiers: readonly FanslyFilterItem[];
  /** `fb` and `own` lists, pin order. */
  readonly lists: readonly FanslyFilterItem[];
  /** Steps ascending. */
  readonly steps: readonly FanslyFilterItem[];
}

/** «Две полки»: a cell of a row, as the layout placed it (shelves spec §4). */
export interface FanslyShelfCell {
  /** An item's key, or `ov:tiers` / `ov:lists` / `ov:steps` («ещё N»), `label` (the ladder's), `more` («⋯»). */
  readonly key: string;
  readonly type: 'chip' | 'overflow' | 'label' | 'more';
  /** The text drawn: a label, a step's text (compact or full), «ещё N», the ladder's label; null — a star alone. */
  readonly text: string | null;
  /** What the chip does not show in full; null — nothing. */
  readonly tip: string | null;
  /** A glued run's segment: first, middle, last; null — a pill of its own. */
  readonly shape: 'first' | 'middle' | 'last' | null;
  /** Glued to the one before it (5 px on the left). */
  readonly inner: boolean;
  /** The next one is glued to it (1 px after it). */
  readonly joint: boolean;
  /** «ещё N»: the keys of the items it hides. */
  readonly hidden: readonly string[];
}

export interface FanslyShelvesLayout {
  readonly rows: ReadonlyArray<{ readonly shelf: 1 | 2 | 3; readonly cells: readonly FanslyShelfCell[] }>;
  readonly tierMode: 'none' | 'named' | 'stars' | 'cut';
  readonly ladder: { readonly label: string; readonly compact: boolean } | null;
}

/** A text's width in the strip's own font, measured by the view (`emoji` — at the emoji's own size). */
export type FanslyTextMeasure = (text: string, kind: 'label' | 'emoji') => number;

/** «Четыре группы»: what the two groups show (groups spec §2, §3). */
export interface FanslyGroupsView {
  /** More than one tier: Subscribers is split (main part + chevron) and has a menu. */
  readonly split: boolean;
  /** The only tier when there is one (its name in the tooltip). */
  readonly oneTier: FanslyFilterItem | null;
  /** The remembered tier shown on the main part; null — «Subscribers». */
  readonly tier: FanslyFilterItem | null;
  /** The number on «Subscribers» when no tier is shown; null — none we can vouch for. */
  readonly subscribers: string | null;
  /** Subscribers outside the shown tier (outlined); null — none or not vouched for. */
  readonly tierRest: string | null;
  /** The remembered list shown on the main part; null — «Списки». */
  readonly list: FanslyFilterItem | null;
  /** «Списки N»: unread in chats whose fan is in at least one pinned list, each chat once; null — none or not vouched for. */
  readonly union: string | null;
  /** Unread in chats in another pinned list and not in the shown one (outlined); null — none or not vouched for. */
  readonly listRest: string | null;
  /** The numbers are not vouched for (groups spec §7.4): a dot where something inside is unread. */
  readonly fallback: boolean;
  /** The dot on the chevron of «Списки». */
  readonly dot: boolean;
  /** The tooltip of «Списки»: the per-list summary, two lines. */
  readonly summary: readonly [string, string];
}

/** What the controller says to a strip. */
export interface FanslyFiltersView {
  /** The strip that stands; null — Fansly's own chips (the setting, or the block does not read). */
  readonly mode: 'shelves' | 'groups' | null;
  readonly set: FanslyFilterSet | null;
  /** Every item by its key: counts and the active filter, apart from the set. */
  readonly items: ReadonlyMap<string, FanslyFilterItem>;
  /** The content width the page gives the strip (CSS px). */
  readonly width: number;
  readonly spinning: boolean;
  readonly groups: FanslyGroupsView | null;
}

export interface FanslyFiltersClient extends FanslyFilterActions {
  view(): FanslyFiltersView;
  subscribe(listener: (view: FanslyFiltersView) => void): () => void;
  /** «Две полки»: the rows for this width, the texts measured by the view (pure; the same set and width give the same rows). */
  shelves(width: number, measure: FanslyTextMeasure): FanslyShelvesLayout;
  /** «Четыре группы»: a filter picked from a group's menu — clicked, and remembered for its group. */
  pick(key: string): boolean;
  /** «Четыре группы»: «Subscribers» picked in its menu — clicked, and the tier forgotten. */
  pickSubscribers(): boolean;
}

/** The words of the strips (core i18n filters.ts). */
export interface FanslyFiltersCopy {
  readonly strip: string;
  readonly ladder: string;
  readonly ladderShort: string;
  readonly more: (count: number) => string;
  readonly actions: string;
  readonly addList: string;
  readonly removeList: string;
  readonly refresh: string;
  readonly removeHeader: string;
  readonly stepSay: (text: string) => string;
  readonly confirmTitle: (name: string) => string;
  readonly confirmText: string;
  readonly cancel: string;
  readonly remove: string;
  readonly moreLists: string;
  readonly moreTiers: string;
  readonly staff: string;
  // «Четыре группы»
  readonly lists: string;
  readonly groupsLabel: string;
  readonly subsMenu: string;
  readonly allLists: string;
  readonly noneUnread: string;
  readonly perList: string;
  readonly unionLine: (count: string) => string;
  readonly oneTier: (name: string) => string;
  readonly oneTierHint: string;
  readonly tierRest: (count: string) => string;
  readonly listRest: (count: string) => string;
  readonly kindTier: string;
  readonly kindStep: string;
  readonly kindFb: string;
  readonly kindCut: string;
  readonly findTier: string;
  readonly findList: string;
  readonly nothingFound: string;
  readonly ladderHeader: string;
  readonly fbHeader: string;
  readonly fanslyHeader: string;
  readonly emptyLists: string;
  readonly pinList: string;
  readonly unpinShort: string;
  readonly gap: (from: string, to: string) => string;
  readonly groupsConfirmTitle: (what: string) => string;
  readonly groupsConfirmWhatStep: (label: string) => string;
  readonly groupsConfirmWhatFb: (name: string) => string;
  readonly groupsConfirmText: string;
  readonly groupsRemove: string;
  readonly refreshCounts: string;
}
