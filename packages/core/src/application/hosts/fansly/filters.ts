// The filters above Fansly's chats in a Fansly tab (2026-11-13; contracts fansly-filters.ts): the controller between
// the page's block of filter chips (FanslyPagePort `filters`), the strip the person chose (`settings.ext`
// `filterStrip`, the background's), the creator's memory of «Четыре группы» (the background's too) and the strip the UI
// draws. No DOM, no request of its own.
//
// - One mode at a time: «Две полки», «Четыре группы» or nothing of ours (Fansly's chips): the setting, and a block that
//   reads (shelves spec §9 with groups spec §8.4: a fan's list, a chip of no known kind, a chip missing or out of order,
//   a badge of another form, a click Fansly did not take, a column under 300 px). Until the setting is known, nothing
//   of ours: the page's own chips stand.
// - The set (what exists and its names) and the counts and the active filter are read anew at every change of the
//   block; the shelves' rows are computed only for a new set or width.
// - «Четыре группы»'s numbers (groups spec §3, §7): our counts from MAIN's copy of the unread of the loaded chats, shown
//   only while they agree with Fansly's own badges; a mismatch twice in a row, or no copy, and the numbers become dots
//   until the next full match. Between the two, the last numbers that agreed.
// - Every action is a click on Fansly's own chip, inside the person's handler (the page port makes it); a pick from a
//   group's menu is remembered for that group, per creator, in the background.

import type { FanslyPagePort } from '@cg/contracts/fansly';
import {
  EMPTY_FILTER_MEMO,
  FANSLY_FILTER_LIMITS,
  type FanslyFilterItem,
  type FanslyFilterMemo,
  type FanslyFilterRef,
  type FanslyFiltersClient,
  type FanslyFiltersCopy,
  type FanslyFilterSet,
  type FanslyFiltersView,
  type FanslyGroupsView,
  type FanslyShelvesLayout,
  type FanslyTextMeasure,
} from '@cg/contracts/fansly-filters';
import type { FanslyFilterStrip } from '@cg/contracts/settings-ext';

import { countsAgree, filterSet, groupCounts, groupsNumbers, shelvesLayout, type GroupCounts } from '../../../domain/hosts/fansly/filters';

export interface FanslyFiltersDeps {
  readonly page: FanslyPagePort['filters'];
  /** The creator the tab is on; null — none known yet. */
  creator(): string | null;
  /** `fansly.filters.read`; null — no answer. */
  read(creator: string): Promise<{ readonly strip: FanslyFilterStrip; readonly memo: FanslyFilterMemo } | null>;
  /** `fansly.filters.remember`; null — no answer. */
  remember(creator: string, group: 'tier' | 'list', key: string | null): Promise<FanslyFilterMemo | null>;
  /** The words of the tab's language now. */
  copy(): FanslyFiltersCopy;
  /** Test builds only: the controller's state after every change of it (the e2e's report). */
  readonly observe?: (stats: FanslyFiltersStats) => void;
}

export interface FanslyFiltersStats {
  readonly strip: FanslyFilterStrip | null;
  readonly mode: FanslyFiltersView['mode'];
  /** Why the block does not read; null — it reads. */
  readonly refused: string | null;
  readonly tiers: number;
  readonly lists: number;
  readonly steps: number;
  readonly active: string | null;
  /** «Четыре группы»'s numbers are dots. */
  readonly fallback: boolean;
  readonly memo: FanslyFilterMemo;
}

export interface FanslyFiltersController extends FanslyFiltersClient {
  /** The page's block, the creator or the language changed: read again. */
  sync(): void;
  /** The person chose another strip on the settings page. */
  stripChanged(strip: FanslyFilterStrip): void;
  /** Another sign-in, or the tab came back: the setting and the memory read again. */
  reread(): void;
  stats(): FanslyFiltersStats;
  dispose(): void;
}

const EMPTY_VIEW: FanslyFiltersView = { mode: null, set: null, items: new Map(), width: 0, spinning: false, groups: null };
/** Mismatches in a row after which «Четыре группы» shows dots instead of numbers (groups spec §7.4). */
const MISMATCHES = 2;

export function createFanslyFilters(deps: FanslyFiltersDeps): FanslyFiltersController {
  const listeners = new Set<(view: FanslyFiltersView) => void>();
  let disposed = false;
  let strip: FanslyFilterStrip | null = null;
  let memo: FanslyFilterMemo = EMPTY_FILTER_MEMO;
  /** The creator the setting and the memory were read for. */
  let readFor: string | null = null;
  /** The newest read asked: an older answer says nothing. */
  let asked = 0;
  let view: FanslyFiltersView = EMPTY_VIEW;
  let refused: string | null = 'no-block';
  let mismatches = MISMATCHES;
  let vouched: GroupCounts | null = null;
  let layoutCache: { readonly signature: string; readonly width: number; readonly layout: FanslyShelvesLayout } | null = null;

  const words = () => {
    const copy = deps.copy();
    return {
      shelves: { ladder: copy.ladder, ladderShort: copy.ladderShort, more: copy.more, stepFull: (step: { readonly lo: number; readonly hi: number | null }) => (step.hi === null ? `$${String(step.lo)}+` : `$${String(step.lo)}-$${String(step.hi)}`) },
      groups: { allLists: copy.allLists, noneUnread: copy.noneUnread, perList: copy.perList, unionLine: copy.unionLine, more: copy.more },
      staff: copy.staff,
    };
  };

  const stats = (): FanslyFiltersStats => {
    let active: string | null = null;
    for (const item of view.items.values()) if (item.active) active = item.key;
    return {
      strip,
      mode: view.mode,
      refused,
      tiers: view.set?.tiers.length ?? 0,
      lists: view.set?.lists.length ?? 0,
      steps: view.set?.steps.length ?? 0,
      active,
      fallback: view.groups?.fallback ?? true,
      memo,
    };
  };

  const publish = (next: FanslyFiltersView): void => {
    view = next;
    deps.observe?.(stats());
    for (const listener of [...listeners]) listener(view);
  };

  /** «Четыре группы»'s numbers: the counts vouched for by the self-check, or dots. */
  const groupsOf = (set: FanslyFilterSet, items: ReadonlyMap<string, FanslyFilterItem>): FanslyGroupsView => {
    const unread = deps.page.unread();
    const counts = unread === null ? null : groupCounts(unread);
    if (counts !== null && countsAgree(set, items, counts)) {
      mismatches = 0;
      vouched = counts;
    } else {
      mismatches = Math.min(MISMATCHES, mismatches + 1);
      if (mismatches >= MISMATCHES) vouched = null;
    }
    const shown = mismatches < MISMATCHES ? vouched : null;
    const numbers = groupsNumbers(set, items, memo, shown, words().groups);
    return { ...numbers, fallback: shown === null };
  };

  const compute = (): void => {
    if (disposed) return;
    const read = deps.page.read();
    if (!read.ok) {
      refused = read.reason;
      if (view !== EMPTY_VIEW) publish(EMPTY_VIEW);
      else deps.observe?.(stats());
      return;
    }
    refused = null;
    const block = read.block;
    const set = filterSet(block, deps.page.names(), words().staff);
    const narrow = block.width < FANSLY_FILTER_LIMITS.minWidthPx;
    const mode = strip === null || strip === 'native' || narrow ? null : strip;
    const groups = mode === 'groups' ? groupsOf(set, set.items) : null;
    publish({ mode, set, items: set.items, width: block.width, spinning: block.spinning, groups });
  };

  const readSettings = (): void => {
    const creator = deps.creator();
    if (creator === null) return;
    readFor = creator;
    const ask = ++asked;
    void deps.read(creator).then(
      (answer) => {
        if (disposed || ask !== asked || answer === null) return;
        strip = answer.strip;
        memo = answer.memo;
        compute();
      },
      () => undefined,
    );
  };

  const off = deps.page.onChange(() => compute());

  const itemOf = (key: string): FanslyFilterItem | null => view.items.get(key) ?? null;
  const select = (ref: FanslyFilterRef): boolean => (disposed ? false : deps.page.select(ref));
  const rememberFor = (group: 'tier' | 'list', key: string | null): void => {
    const creator = deps.creator();
    if (creator === null) return;
    memo = group === 'tier' ? { ...memo, tier: key } : { ...memo, list: key };
    const ask = asked;
    void deps.remember(creator, group, key).then(
      (answer) => {
        if (disposed || answer === null || ask !== asked) return;
        memo = answer;
        compute();
      },
      () => undefined,
    );
  };

  const controller: FanslyFiltersController = {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shelves(width: number, measure: FanslyTextMeasure): FanslyShelvesLayout {
      const set = view.set;
      if (set === null) return { rows: [], tierMode: 'none', ladder: null };
      const w = Math.round(width * 10) / 10;
      if (layoutCache !== null && layoutCache.signature === set.signature && layoutCache.width === w) return layoutCache.layout;
      const layout = shelvesLayout(set, w, measure, words().shelves);
      layoutCache = { signature: set.signature, width: w, layout };
      return layout;
    },
    select,
    unpin(ref) {
      if (disposed) return false;
      const item = itemOf(`list:${String(ref.index)}`);
      const done = deps.page.unpin(ref);
      // Our own unpin of the remembered list: the memory goes with it (someone else's unpin only hides it).
      if (done && item !== null && item.memo !== null && item.memo === memo.list) rememberFor('list', null);
      return done;
    },
    pin: () => (disposed ? false : deps.page.pin()),
    refresh: () => (disposed ? false : deps.page.refresh()),
    pick(key) {
      const item = itemOf(key);
      if (item === null) return false;
      const done = select(item.ref);
      if (done && item.memo !== null) rememberFor(item.kind === 'tier' ? 'tier' : 'list', item.memo);
      return done;
    },
    pickSubscribers() {
      const done = select({ kind: 'base', base: 'subscribers' });
      if (done) rememberFor('tier', null);
      return done;
    },
    sync() {
      if (disposed) return;
      const creator = deps.creator();
      if (creator !== null && creator !== readFor) {
        // Another creator: nothing of the old one's memory, the setting read again.
        memo = EMPTY_FILTER_MEMO;
        readSettings();
      }
      compute();
    },
    stripChanged(next) {
      if (disposed || next === strip) return;
      strip = next;
      compute();
    },
    reread() {
      if (disposed) return;
      readSettings();
    },
    stats,
    dispose() {
      disposed = true;
      off();
      listeners.clear();
    },
  };
  readSettings();
  compute();
  return controller;
}
