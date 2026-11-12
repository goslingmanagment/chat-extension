// The filters above the chats (2026-11-13, contracts fansly-filters.ts): Fansly's own block of filter chips of the
// route's list of chats, read, hidden while a strip of ours stands, and clicked for the person (shelves spec §8).
//
// - Where: `div.messages-nav-wrapper` of the route's list (`app-messages-route div.messages-list-wrapper`, the port's
//   sync says it), never the mini chat's lookalike (`app-messaging-overlay`). The creator's block is
//   `.messages-nav-wrapper .bubble-wrap-sm`; the fan's (`.bubble-wrap` without `-sm`) does not read.
// - What: the `div.bubble` children in order, told apart by their structure, never by English text — this production
//   build prints no `stringid` attribute (main:23270): All, Subscribers, a tier (`i.fa-star`) × n, [Staff], VIPs,
//   Followers, a list (`i.fa-trash-can`) × n, the pencil (`i.fa-pencil`), the refresh (`i.fa-arrows-rotate`). Anything
//   else does not read. A label is its label node's text (never the chip's: the badge is inside it), the count the
//   badge's `span` (`\d+` or `99+`), the active one `.active` (exactly one).
// - Hidden: `display: none !important` inline on the block, the one node of the page we change, taken off when asked,
//   on a fallback and on dispose; a block the page makes anew while hidden is hidden too. Nothing global.
// - Acting: the native node looked up again right before its `.click()` (by its place among the chips of its kind,
//   its label checked), only inside the person's own click or key (the caller's handler). A filter's click that does
//   not make its chip the active one within a frame and a task: the block does not read (`click`) until Fansly's
//   active chip moves again, said once to the log.
// - Kept in step: one MutationObserver on the block (coalesced into one change a turn), one on the list for a block
//   that comes or goes, a ResizeObserver on the list for the width. The full names and the unread are MAIN's
//   `fx.filters` (the port hands them in).

import type { FanslyFilterBlock, FanslyFilterChip, FanslyFilterNames, FanslyFilterRead, FanslyFilterRef, FanslyFilterRefusal, FanslyFilterUnread } from '@cg/contracts/fansly-filters';

const NAV = 'messages-nav-wrapper';
const CHIPS = '.bubble-wrap.bubble-wrap-sm';
const FAN_CHIPS = '.bubble-wrap';
const BADGE = /^(?:\d{1,5}|99\+)$/;
/** The strip's side margins (12 px each) within the list's column. */
const MARGINS = 24;

export interface InboxFiltersDeps {
  readonly win: Window;
  /** Said once a page for each reason the block did not read, and for a click Fansly did not take. */
  readonly diag: (event: string, detail: Readonly<Record<string, string | number | boolean | null>>) => void;
}

interface Parsed {
  readonly block: Omit<FanslyFilterBlock, 'width'>;
  readonly nodes: {
    readonly base: Readonly<Record<'all' | 'subscribers' | 'staff' | 'vips' | 'followers', HTMLElement | null>>;
    readonly tiers: readonly HTMLElement[];
    readonly lists: readonly HTMLElement[];
    readonly pencil: HTMLElement;
    readonly refresh: HTMLElement;
  };
}

type ChipKind = 'plain' | 'subscribers' | 'tier' | 'list' | 'pencil' | 'refresh' | 'unknown';

const kindOf = (chip: Element): ChipKind => {
  if (chip.querySelector('i.fa-star') !== null) return 'tier';
  if (chip.querySelector('i.fa-trash-can') !== null) return 'list';
  if (chip.querySelector('i.fa-pencil') !== null) return 'pencil';
  if (chip.querySelector('i.fa-arrows-rotate') !== null) return 'refresh';
  if (chip.querySelector('i') !== null) return 'unknown';
  const label = chip.querySelector(':scope > xd-localization-string');
  if (label === null) return 'unknown';
  return label.classList.contains('margin-right-text') ? 'subscribers' : 'plain';
};

/** A chip's label: its label node's own text (the badge is beside it, never inside it). */
const labelOf = (chip: Element): string => {
  const node = chip.querySelector(':scope > span.margin-right-text') ?? chip.querySelector(':scope > xd-localization-string');
  return (node?.textContent ?? '').trim();
};

const chipOf = (chip: HTMLElement): FanslyFilterChip | null => {
  const badge = chip.querySelector(':scope > .badge');
  const count = badge === null ? null : (badge.querySelector('span')?.textContent ?? badge.textContent ?? '').trim();
  if (count !== null && !BADGE.test(count)) return null;
  return { label: labelOf(chip), active: chip.classList.contains('active'), count };
};

/** Fansly's block as it is now; a reason — it does not read. */
function parse(nav: Element): Parsed | FanslyFilterRefusal {
  const wrap = nav.querySelector(CHIPS);
  if (wrap === null) return nav.querySelector(FAN_CHIPS) === null ? 'no-block' : 'fan-branch';
  const chips = [...wrap.children].filter((child): child is HTMLElement => child.classList.contains('bubble'));
  if (chips.length !== wrap.children.length) return 'unknown-chip';
  const kinds = chips.map(kindOf);
  if (kinds.includes('unknown')) return 'unknown-chip';
  // All, Subscribers, tier × n, [Staff], VIPs, Followers, list × n, pencil, refresh — nothing else, nothing out of order.
  let at = 0;
  const take = (kind: ChipKind): HTMLElement | null => (kinds[at] === kind ? (chips[at++] ?? null) : null);
  const all = take('plain');
  const subscribers = take('subscribers');
  if (all === null || subscribers === null) return 'missing-chip';
  const tiers: HTMLElement[] = [];
  for (let chip = take('tier'); chip !== null; chip = take('tier')) tiers.push(chip);
  const plain: HTMLElement[] = [];
  for (let chip = take('plain'); chip !== null; chip = take('plain')) plain.push(chip);
  if (plain.length < 2 || plain.length > 3) return 'missing-chip';
  const lists: HTMLElement[] = [];
  for (let chip = take('list'); chip !== null; chip = take('list')) lists.push(chip);
  const pencil = take('pencil');
  const refresh = take('refresh');
  if (pencil === null || refresh === null) return 'missing-chip';
  if (at !== chips.length) return 'order';
  const [staff, vips, followers] = plain.length === 3 ? plain : [null, ...plain];
  const read = (chip: HTMLElement | null | undefined): FanslyFilterChip | null | 'bad' => (chip === null || chip === undefined ? null : (chipOf(chip) ?? 'bad'));
  const base = { all: read(all), subscribers: read(subscribers), staff: read(staff), vips: read(vips), followers: read(followers) };
  const tierChips = tiers.map((chip) => {
    const read = chipOf(chip);
    const color = chip.querySelector<HTMLElement>('i.fa-star')?.style.color ?? '';
    return read === null ? null : { ...read, color: color === '' ? null : color };
  });
  const listChips = lists.map(chipOf);
  if (Object.values(base).includes('bad') || tierChips.includes(null) || listChips.includes(null)) return 'badge';
  const every = [...Object.values(base), ...tierChips, ...listChips].filter((chip): chip is FanslyFilterChip => chip !== null && chip !== 'bad');
  if (every.filter((chip) => chip.active).length !== 1) return 'order';
  return {
    block: {
      all: base.all as FanslyFilterChip,
      subscribers: base.subscribers as FanslyFilterChip,
      staff: base.staff as FanslyFilterChip | null,
      vips: base.vips as FanslyFilterChip,
      followers: base.followers as FanslyFilterChip,
      tiers: tierChips as Array<FanslyFilterChip & { readonly color: string | null }>,
      lists: listChips as FanslyFilterChip[],
      spinning: refresh.querySelector('i.fa-arrows-rotate.fa-spin') !== null,
    },
    nodes: { base: { all, subscribers, staff: staff ?? null, vips: vips ?? null, followers: followers ?? null }, tiers, lists, pencil, refresh },
  };
}

/** MAIN's `fx.filters` as it crossed the bridge. */
export interface FiltersWire {
  readonly tiers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly color: string | null }> | null;
  readonly lists: ReadonlyArray<{ readonly id: string; readonly label: string }> | null;
  readonly unread: { readonly ids: readonly string[]; readonly rows: ReadonlyArray<{ readonly u: number; readonly s: boolean; readonly t: string | null; readonly l: readonly number[] }> } | null;
}

export function createInboxFilters(doc: Document, deps: InboxFiltersDeps) {
  const { win } = deps;
  let list: Element | null = null;
  let nav: HTMLElement | null = null;
  /** The block we hid: shown again from this very node. */
  let hiddenNav: HTMLElement | null = null;
  let wantHidden = false;
  let names: FanslyFilterNames = { tiers: null, lists: null };
  let unread: FanslyFilterUnread | null = null;
  let width = 0;
  /** A filter's click Fansly did not take: no strip until its active chip moves again. */
  let failedOn: string | null = null;
  let disposed = false;
  const said = new Set<string>();
  const listeners = new Set<() => void>();
  let owed = false;

  const sayOnce = (event: string, detail: Readonly<Record<string, string | number | boolean | null>>): void => {
    const key = `${event}:${JSON.stringify(detail)}`;
    if (said.has(key)) return;
    said.add(key);
    deps.diag(event, detail);
  };
  const changed = (): void => {
    if (owed || disposed) return;
    owed = true;
    queueMicrotask(() => {
      owed = false;
      if (disposed) return;
      for (const listener of [...listeners]) listener();
    });
  };

  const navOf = (target: Element | null): HTMLElement | null => {
    if (target === null) return null;
    for (const child of target.children) if (child.classList.contains(NAV)) return child as HTMLElement;
    return null;
  };
  /** Our hiding on the block of now, and off any other. */
  const applyHidden = (): void => {
    const target = wantHidden ? nav : null;
    if (hiddenNav !== null && hiddenNav !== target) {
      hiddenNav.style.removeProperty('display');
      hiddenNav = null;
    }
    if (target !== null && hiddenNav !== target) {
      target.style.setProperty('display', 'none', 'important');
      hiddenNav = target;
    }
  };

  const blockObserver = new MutationObserver(() => {
    if (failedOn !== null && nav !== null) {
      const parsed = parse(nav);
      if (typeof parsed !== 'string' && activeKey(parsed) !== failedOn) failedOn = null;
    }
    changed();
  });
  const listObserver = new MutationObserver(() => {
    const next = navOf(list);
    if (next === nav) return;
    follow(next);
    changed();
  });
  const View = win as unknown as { ResizeObserver?: typeof ResizeObserver };
  const resize = typeof View.ResizeObserver === 'function'
    ? new View.ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        const next = entry === undefined ? 0 : Math.max(0, Math.round(entry.contentRect.width) - MARGINS);
        if (next === width) return;
        width = next;
        changed();
      })
    : null;

  const follow = (next: HTMLElement | null): void => {
    blockObserver.disconnect();
    nav = next;
    if (nav !== null) blockObserver.observe(nav, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    applyHidden();
    // Our own hiding said nothing of the page's.
    blockObserver.takeRecords();
  };

  const activeKey = (parsed: Parsed): string => {
    const { block } = parsed;
    for (const base of ['all', 'subscribers', 'staff', 'vips', 'followers'] as const) if (block[base]?.active === true) return base;
    const tier = block.tiers.findIndex((chip) => chip.active);
    if (tier >= 0) return `tier:${String(tier)}`;
    const pinned = block.lists.findIndex((chip) => chip.active);
    return pinned >= 0 ? `list:${String(pinned)}` : 'none';
  };

  const current = (): Parsed | FanslyFilterRefusal => (nav === null ? 'no-block' : parse(nav));
  const keyOf = (ref: FanslyFilterRef): string => (ref.kind === 'base' ? ref.base : `${ref.kind}:${String(ref.index)}`);
  /** The native chip of a filter now, its label checked; null — gone or not what it was. */
  const nodeOf = (parsed: Parsed, ref: FanslyFilterRef): HTMLElement | null => {
    if (ref.kind === 'base') return parsed.nodes.base[ref.base];
    const nodes = ref.kind === 'tier' ? parsed.nodes.tiers : parsed.nodes.lists;
    const chips = ref.kind === 'tier' ? parsed.block.tiers : parsed.block.lists;
    const node = nodes[ref.index] ?? null;
    return node !== null && chips[ref.index]?.label === ref.label ? node : null;
  };
  const press = (node: HTMLElement): boolean => {
    if (!node.isConnected) return false;
    node.click();
    return true;
  };

  return {
    /** The route's list of chats now (the port's sync); null — none. */
    sync(target: Element | null): void {
      if (disposed || target === list) return;
      listObserver.disconnect();
      resize?.disconnect();
      list = target;
      failedOn = null;
      if (list !== null) {
        listObserver.observe(list, { childList: true });
        resize?.observe(list);
        width = Math.max(0, list.clientWidth - MARGINS);
      } else width = 0;
      follow(navOf(list));
      changed();
    },
    read(): FanslyFilterRead {
      const parsed = current();
      if (typeof parsed === 'string') {
        if (parsed !== 'no-block') sayOnce('filters-refused', { reason: parsed });
        return { ok: false, reason: parsed };
      }
      if (failedOn !== null) return { ok: false, reason: 'click' };
      return { ok: true, block: { ...parsed.block, width } };
    },
    names: (): FanslyFilterNames => names,
    unread: (): FanslyFilterUnread | null => unread,
    /** MAIN's `fx.filters`; null — MAIN's state started over (nothing of it known until it says again). */
    facts(wire: FiltersWire | null): void {
      names = wire === null ? { tiers: null, lists: null } : { tiers: wire.tiers, lists: wire.lists };
      const facts = wire?.unread ?? null;
      unread = facts === null ? null : { rows: facts.rows.map((row) => ({ unread: row.u, subscriber: row.s, tierId: row.t, lists: row.l.flatMap((at) => facts.ids[at] ?? []) })) };
      changed();
    },
    hide(on: boolean): void {
      if (disposed) return;
      wantHidden = on;
      applyHidden();
      blockObserver.takeRecords();
    },
    select(ref: FanslyFilterRef): boolean {
      const parsed = current();
      if (typeof parsed === 'string') return false;
      const node = nodeOf(parsed, ref);
      if (node === null || !press(node)) return false;
      const key = keyOf(ref);
      const took = (): boolean => {
        const now = current();
        return typeof now !== 'string' && activeKey(now) === key;
      };
      if (!took()) {
        // Fansly paints in bursts: a frame and a task more before the click is called not taken.
        win.requestAnimationFrame(() =>
          win.setTimeout(() => {
            if (disposed || took()) return;
            const now = current();
            failedOn = typeof now === 'string' ? 'none' : activeKey(now);
            sayOnce('filters-click', { kind: ref.kind });
            changed();
          }, 0),
        );
      }
      return true;
    },
    unpin(ref: Extract<FanslyFilterRef, { kind: 'list' }>): boolean {
      const parsed = current();
      if (typeof parsed === 'string') return false;
      const trash = nodeOf(parsed, ref)?.querySelector<HTMLElement>('i.fa-trash-can') ?? null;
      return trash !== null && press(trash);
    },
    pin(): boolean {
      const parsed = current();
      return typeof parsed !== 'string' && press(parsed.nodes.pencil);
    },
    refresh(): boolean {
      const parsed = current();
      return typeof parsed !== 'string' && press(parsed.nodes.refresh);
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      wantHidden = false;
      applyHidden();
      blockObserver.disconnect();
      listObserver.disconnect();
      resize?.disconnect();
      listeners.clear();
    },
  };
}

export type InboxFilters = ReturnType<typeof createInboxFilters>;
