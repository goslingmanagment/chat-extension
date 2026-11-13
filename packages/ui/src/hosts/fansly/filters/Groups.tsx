// «Четыре группы» (2026-11-13; groups spec): Fansly's filter chips drawn again as one 30 px row of five places —
// [All] [Subscribers ▾] [VIPs] [Followers] [Списки ▾] — the tiers and the lists inside two menus, the last tier and the
// last list picked from them remembered (the controller's, per creator), and the honest numbers of the groups: «Списки N»
// each chat once, the outlined «rest», dots when the numbers are not vouched for (the controller's self-check).
//
// - Every press is a click on Fansly's own chip (the controller's client); a pick from a menu is remembered.
// - Tight: the plans of §2.6 one after another, each from a clean slate, until the row fits.
// - Unpinning asks first, in place of the row (§6.5), behind UNPIN_CONFIRM: the owner has not said yet whether it stays.
// - The refresh is not in the row: `GroupsRefresh` stands in Fansly's search row, before its sort control (§4.2).
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { FanslyFilterItem, FanslyFiltersClient, FanslyFiltersCopy } from '@cg/contracts/fansly-filters';

import { Icon, STRIP_TOKENS, useFiltersView, useOutside } from './common';

/** Groups spec §6.5: the trash of a row or a tile asks «Убрать … с панели?» first; false — Fansly's own trash at once. */
export const UNPIN_CONFIRM = true;
/** A menu gets its search field from this many rows on (§2.2, §2.4). */
const SEARCH_FROM = 9;
/** A tooltip on hover comes after this long (on keyboard focus at once). */
const TIP_DELAY_MS = 450;

const kilo = (v: number): string => (v >= 1000 ? `${String(v / 1000).replace(/\.0$/, '')}k` : String(v));
const stepLabel = (step: { readonly lo: number; readonly hi: number | null }): string => (step.hi === null ? `${kilo(step.lo)}+` : `${kilo(step.lo)}-${kilo(step.hi)}`);
const shortName = (item: FanslyFilterItem): string => (item.kind === 'step' && item.step !== null ? `$${stepLabel(item.step)}` : item.label);

function Badge({ count, rest }: { readonly count: string | null; readonly rest?: boolean }): JSX.Element | null {
  return count === null ? null : <span class={`cgg-cnt${rest === true ? ' rest' : ''}`}>{count}</span>;
}

/** The ladder's slots: the steps by amount, a gap where two do not meet; each with its lit bars (§2.4). */
interface Slot {
  readonly gap: { readonly from: number; readonly to: number } | null;
  readonly item: FanslyFilterItem | null;
  readonly lit: number;
  readonly bars: number;
}
function ladderSlots(steps: readonly FanslyFilterItem[]): Slot[] {
  const raw: Array<{ gap: Slot['gap']; item: FanslyFilterItem | null }> = [];
  steps.forEach((item, index) => {
    const prev = steps[index - 1]?.step;
    const step = item.step;
    if (prev !== undefined && prev !== null && step !== null && prev.hi !== null && prev.hi < step.lo) raw.push({ gap: { from: prev.hi, to: step.lo }, item: null });
    raw.push({ gap: null, item });
  });
  const bars = Math.min(Math.max(raw.length, 3), 8);
  return raw.map((slot, index) => ({ ...slot, bars, lit: Math.max(1, Math.round(((index + 1) * bars) / raw.length)) }));
}

function Bars({ lit, bars, big }: { readonly lit: number; readonly bars: number; readonly big: boolean }): JSX.Element {
  return (
    <span class={big ? 'cgg-bars' : 'cgg-mini'} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <i key={String(index)} class={index < lit ? 'lit' : ''} style={`height:${String(Math.round((big ? 3 : 2) + ((index + 1) * (big ? 10 : 9)) / bars))}px`} />
      ))}
    </span>
  );
}

function ItemIcon({ item, slots }: { readonly item: FanslyFilterItem; readonly slots: readonly Slot[] }): JSX.Element {
  if (item.kind === 'tier') {
    return (
      <i class="cgg-st">
        <Icon name="star" size={12} color={item.color ?? 'currentColor'} />
      </i>
    );
  }
  if (item.kind === 'step') {
    const slot = slots.find((s) => s.item?.key === item.key);
    return <Bars lit={slot?.lit ?? 1} bars={slot?.bars ?? 3} big={false} />;
  }
  if (item.kind === 'fb') return <span class="cgg-fbi" aria-hidden="true">FB</span>;
  if (item.emoji !== null) return <span class="cgg-em">{item.emoji}</span>;
  return (
    <i class="cgg-li">
      <Icon name="list" size={13} />
    </i>
  );
}

const highlight = (text: string, query: string): JSX.Element | string => {
  const at = query === '' ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
};

/** The tight plans of §2.6, from the best: `sl` the list's name shorter, `ss` the tier's, `d` rests as dots, `tl`/`ts` icons alone, `sx` «Subscr…». */
const FIT_PLANS: ReadonlyArray<readonly string[]> = [[], ['sl'], ['sl', 'ss'], ['d', 'sl', 'ss'], ['d', 'tl', 'ss'], ['d', 'tl', 'ts'], ['d', 'tl', 'ts', 'sx']];

function fit(seg: HTMLElement): void {
  const over = (): number => seg.scrollWidth - seg.clientWidth;
  const reset = (): void => {
    for (const label of seg.querySelectorAll<HTMLElement>('.cgg-lbl')) label.style.maxWidth = '';
    for (const group of seg.querySelectorAll('.tight')) group.classList.remove('tight');
    for (const rest of seg.querySelectorAll('.asdot')) rest.classList.remove('asdot');
  };
  const shrink = (group: string, min: number, word = false): void => {
    const g = seg.querySelector(`.${group}`);
    const label = g?.querySelector<HTMLElement>(word ? '.cgg-lbl' : '.cgg-sb.main .cgg-lbl');
    if (g === null || g === undefined || label === null || label === undefined || g.classList.contains('tight')) return;
    // «Subscribers» itself only in the last plan, and only while no tier stands on it.
    if (group === 'g-subs' && !word && g.querySelector('.cgg-sb.main .cgg-st') === null) return;
    if (word && g.querySelector('.cgg-sb.main .cgg-st') !== null) return;
    const o = over();
    if (o <= 1) return;
    label.style.maxWidth = `${String(Math.max(min, label.offsetWidth - o))}px`;
  };
  const tight = (group: string): void => {
    const g = seg.querySelector(`.${group}`);
    if (g !== null && g.querySelector('.cgg-sb.main :is(.cgg-st, .cgg-em, .cgg-mini, .cgg-fbi, .cgg-li)') !== null) g.classList.add('tight');
  };
  const steps: Readonly<Record<string, () => void>> = {
    sl: () => shrink('g-lists', 36),
    ss: () => shrink('g-subs', 36),
    d: () => {
      for (const rest of seg.querySelectorAll('.cgg-cnt.rest')) rest.classList.add('asdot');
    },
    tl: () => tight('g-lists'),
    ts: () => tight('g-subs'),
    sx: () => shrink('g-subs', 46, true),
  };
  seg.classList.add('measure');
  for (const plan of FIT_PLANS) {
    reset();
    for (const step of plan) steps[step]?.();
    if (over() <= 1) break;
  }
  seg.classList.remove('measure');
}

interface Tip {
  readonly text: string;
  readonly sub: string | null;
  readonly x: number;
  readonly y: number;
}

export function Groups({ client, copy }: { readonly client: FanslyFiltersClient; readonly copy: FanslyFiltersCopy }): JSX.Element | null {
  const view = useFiltersView(client);
  const [open, setOpen] = useState<'subs' | 'lists' | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tip, setTip] = useState<Tip | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const seg = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const tipTimer = useRef<number | null>(null);
  const set = view.set;
  const g = view.groups;
  const items = view.items;
  const narrow = view.width > 0 && view.width < 420;

  const closeAll = (back: boolean): void => {
    if (back && open !== null) focusNext.current = open === 'subs' ? 'c-subs' : 'c-lists';
    setOpen(null);
    setConfirm(null);
    setQuery('');
  };
  useOutside(open !== null, root, () => closeAll(false));
  const signature = set?.signature ?? '';
  useEffect(() => {
    if (confirm !== null && !items.has(confirm)) setConfirm(null);
    if (open === 'subs' && g?.split !== true) setOpen(null);
  }, [signature]);

  useLayoutEffect(() => {
    const node = root.current;
    if (seg.current !== null) fit(seg.current);
    const want = focusNext.current;
    focusNext.current = null;
    if (node !== null && want !== null) {
      const target = want === '__first' ? (node.querySelector<HTMLElement>('.cgg-menu [data-nav][aria-checked="true"]') ?? node.querySelector<HTMLElement>('.cgg-menu input[data-nav], .cgg-menu .cgg-mi, .cgg-menu .cgg-tsel')) : node.querySelector<HTMLElement>(`[data-fk="${CSS.escape(want)}"]`);
      target?.focus({ preventScroll: true });
    }
    const panel = menu.current;
    if (node === null || panel === null || seg.current === null) return;
    const rr = node.getBoundingClientRect();
    const sr = seg.current.getBoundingClientRect();
    const anchor = node.querySelector(open === 'subs' ? '.g-subs' : '.g-lists');
    const ar = anchor?.getBoundingClientRect() ?? sr;
    const left = open === 'subs' ? ar.left - rr.left : sr.right - rr.left - panel.offsetWidth;
    panel.style.left = `${String(Math.round(Math.max(-4, Math.min(rr.width + 4 - panel.offsetWidth, left))))}px`;
    const top = Math.round(sr.bottom - rr.top + 6);
    panel.style.top = `${String(top)}px`;
    // No taller than the column: the rows scroll, the search and the footer stand; a cut row shows there is more.
    const scroll = panel.querySelector<HTMLElement>('.cgg-mscroll');
    if (scroll === null) return;
    scroll.style.maxHeight = '';
    const win = node.ownerDocument.defaultView;
    const room = (win?.innerHeight ?? 800) - (rr.top + top) - 12;
    const fixed = panel.offsetHeight - scroll.offsetHeight;
    let max = Math.max(120, Math.min(440, room) - fixed);
    if (scroll.scrollHeight > max) {
      const tops = [...scroll.querySelectorAll<HTMLElement>('.cgg-mi-w, .cgg-mh, .cgg-cf')].map((row) => row.offsetTop - scroll.offsetTop).filter((t) => t < max - 12);
      const last = tops[tops.length - 1];
      if (last !== undefined) max = last + 18;
    }
    scroll.style.maxHeight = `${String(max)}px`;
    const on = scroll.querySelector<HTMLElement>('[aria-checked="true"]');
    if (on !== null && scroll.scrollHeight > scroll.clientHeight && want === '__first') scroll.scrollTop = Math.max(0, on.offsetTop - scroll.offsetTop - scroll.clientHeight / 2);
    scroll.classList.toggle('fade-b', scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2);
  });
  useLayoutEffect(() => {
    const node = root.current;
    const box = tipRef.current;
    if (node === null || box === null || tip === null) return;
    const rr = node.getBoundingClientRect();
    box.style.left = `${String(Math.round(Math.max(-4, Math.min(rr.width + 4 - box.offsetWidth, tip.x))))}px`;
    box.style.top = `${String(Math.round(tip.y))}px`;
  }, [tip]);

  if (set === null || g === null) return null;

  const slots = ladderSlots(set.steps);
  const staff = items.get('staff') ?? null;
  const pinned = [...set.steps, ...set.lists];
  const listsOn = pinned.some((item) => item.active) || staff?.active === true;
  const subsOn = items.get('subscribers')?.active === true || set.tiers.some((item) => item.active);

  const hideTip = (): void => {
    if (tipTimer.current !== null) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(null);
  };
  const showTip = (target: HTMLElement, now: boolean): void => {
    hideTip();
    const text = target.dataset['tip'];
    const node = root.current;
    if (text === undefined || node === null) return;
    const place = (): void => {
      if (!target.isConnected) return;
      const rr = node.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const inMenu = target.closest('.cgg-menu') !== null && target.closest('.cgg-lad') === null;
      const x = inMenu && r.right - rr.left + 10 + 220 <= rr.width ? r.right - rr.left + 10 : r.left - rr.left;
      const y = inMenu && r.right - rr.left + 10 + 220 <= rr.width ? r.top - rr.top : r.bottom - rr.top + 8;
      setTip({ text, sub: target.dataset['tip2'] ?? null, x, y });
    };
    if (now) place();
    else tipTimer.current = setTimeout(place, TIP_DELAY_MS);
  };
  const tipped = (event: Event): HTMLElement | null => (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]') ?? null;

  const select = (item: FanslyFilterItem | null | undefined): void => {
    hideTip();
    closeAll(false);
    if (item !== null && item !== undefined) client.select(item.ref);
  };
  const pick = (key: string, group: 'subs' | 'lists', keyboard: boolean): void => {
    hideTip();
    if (key === 'subscribers') client.pickSubscribers();
    else client.pick(key);
    setOpen(null);
    setConfirm(null);
    setQuery('');
    focusNext.current = keyboard ? (group === 'subs' ? 'b-subs' : 'b-lists') : null;
  };
  const toggle = (which: 'subs' | 'lists', keyboard: boolean): void => {
    hideTip();
    setConfirm(null);
    setQuery('');
    if (open === which) {
      setOpen(null);
      return;
    }
    setOpen(which);
    if (keyboard) focusNext.current = '__first';
  };
  const unpin = (item: FanslyFilterItem): void => {
    setConfirm(null);
    focusNext.current = 'pin';
    if (item.ref.kind === 'list') client.unpin(item.ref);
  };
  const tipOf = (item: FanslyFilterItem): { readonly 'data-tip': string; readonly 'data-tip2'?: string } => {
    const sub = item.kind === 'tier' ? copy.kindTier : item.kind === 'step' ? copy.kindStep : item.kind === 'fb' ? copy.kindFb : item.cut || item.full.length > 21 ? copy.kindCut : null;
    return sub === null ? { 'data-tip': item.full } : { 'data-tip': item.full, 'data-tip2': sub };
  };

  const one = (key: 'all' | 'vips' | 'followers' | 'subscribers', count?: string | null, extra: Record<string, string> = {}): JSX.Element | null => {
    const item = items.get(key);
    if (item === undefined) return null;
    return (
      <div class={`cgg-sg${item.active ? ' on' : ''}${key === 'subscribers' ? ' g-subs' : ''}`}>
        <button type="button" class="cgg-sb" data-fk={`b-${key}`} data-cg-filter={key} aria-pressed={item.active ? 'true' : 'false'} onClick={() => select(item)} {...extra}>
          <span class="cgg-lbl">{item.label}</span>
          <Badge count={count === undefined ? item.count : count} />
        </button>
      </div>
    );
  };

  let subs: JSX.Element | null;
  if (!g.split) {
    subs = one('subscribers', g.subscribers, g.oneTier === null ? {} : { 'data-tip': copy.oneTier(g.oneTier.label), 'data-tip2': copy.oneTierHint });
  } else {
    const shown = g.tier;
    const live = shown === null ? null : (items.get(shown.key) ?? shown);
    subs = (
      <div class={`cgg-sg grp g-subs split${subsOn ? ' on' : ''}${open === 'subs' ? ' open' : ''}`}>
        <button type="button" class="cgg-sb main" data-fk="b-subs" data-cg-filter={live?.key ?? 'subscribers'} aria-pressed={(live?.active ?? items.get('subscribers')?.active) === true ? 'true' : 'false'} onClick={() => select(live ?? items.get('subscribers'))} {...(live === null ? {} : tipOf(live))}>
          {live === null ? (
            <span class="cgg-lbl">{items.get('subscribers')?.label ?? 'Subscribers'}</span>
          ) : (
            <>
              <ItemIcon item={live} slots={slots} />
              <span class="cgg-lbl">{live.label}</span>
            </>
          )}
          <Badge count={live === null ? g.subscribers : live.count} />
        </button>
        <button type="button" class="cgg-sb chv" data-fk="c-subs" aria-haspopup="menu" aria-expanded={open === 'subs' ? 'true' : 'false'} aria-label={copy.subsMenu} data-tip={copy.subsMenu} {...(g.tierRest === null ? {} : { 'data-tip2': copy.tierRest(g.tierRest) })} onClick={(event) => toggle('subs', event.detail === 0)}>
          <i class="cgg-chev">
            <Icon name="chev" size={10} />
          </i>
          <Badge count={g.tierRest} rest />
        </button>
      </div>
    );
  }

  let lists: JSX.Element;
  if (g.list === null) {
    lists = (
      <div class={`cgg-sg grp g-lists whole${listsOn ? ' on' : ''}${open === 'lists' ? ' open' : ''}`}>
        <button type="button" class="cgg-sb" data-fk="c-lists" aria-haspopup="menu" aria-expanded={open === 'lists' ? 'true' : 'false'} data-tip={g.summary[0]} data-tip2={g.summary[1]} onClick={(event) => toggle('lists', event.detail === 0)}>
          <span class="cgg-lbl">{copy.lists}</span>
          <Badge count={g.union} />
          <i class="cgg-chev">
            <Icon name="chev" size={10} />
            {g.dot ? <b class="cgg-dot" /> : null}
          </i>
        </button>
      </div>
    );
  } else {
    const live = items.get(g.list.key) ?? g.list;
    lists = (
      <div class={`cgg-sg grp g-lists split${listsOn ? ' on' : ''}${open === 'lists' ? ' open' : ''}`}>
        <button type="button" class="cgg-sb main" data-fk="b-lists" data-cg-filter={live.key} aria-pressed={live.active ? 'true' : 'false'} onClick={() => select(live)} {...tipOf(live)}>
          <ItemIcon item={live} slots={slots} />
          <span class="cgg-lbl">{shortName(live)}</span>
          <Badge count={live.count} />
        </button>
        <button type="button" class="cgg-sb chv" data-fk="c-lists" aria-haspopup="menu" aria-expanded={open === 'lists' ? 'true' : 'false'} aria-label={copy.allLists} data-tip={copy.allLists} {...(g.listRest === null ? {} : { 'data-tip2': copy.listRest(g.listRest) })} onClick={(event) => toggle('lists', event.detail === 0)}>
          <i class="cgg-chev">
            <Icon name="chev" size={10} />
            {g.dot ? <b class="cgg-dot" /> : null}
          </i>
          <Badge count={g.listRest} rest />
        </button>
      </div>
    );
  }

  const confirmBox = (item: FanslyFilterItem): JSX.Element => {
    const what = item.kind === 'step' && item.step !== null ? copy.groupsConfirmWhatStep(stepLabel(item.step)) : item.kind === 'fb' ? copy.groupsConfirmWhatFb(item.label) : `«${item.emoji === null ? '' : `${item.emoji} `}${item.label}»`;
    const title = copy.groupsConfirmTitle(what);
    return (
      <div class="cgg-cf" role="alertdialog" aria-label={title} key={`cf:${item.key}`}>
        <div class="cgg-cf-t">{title}</div>
        <div class="cgg-cf-d">{copy.groupsConfirmText}</div>
        <div class="cgg-cf-b">
          <button type="button" class="cgg-del" data-fk="cf-yes" data-nav onClick={() => unpin(item)}>
            <Icon name="trash" size={13} />
            {copy.groupsRemove}
          </button>
          <button
            type="button"
            class="cgg-no"
            data-fk="cf-no"
            data-nav
            onClick={() => {
              setConfirm(null);
              focusNext.current = `t-${item.key}`;
            }}
          >
            {copy.cancel}
          </button>
        </div>
      </div>
    );
  };
  const ask = (item: FanslyFilterItem): void => {
    hideTip();
    if (!UNPIN_CONFIRM) {
      unpin(item);
      return;
    }
    setConfirm(item.key);
    focusNext.current = 'cf-no';
  };

  const row = (item: FanslyFilterItem | null, group: 'subs' | 'lists', trash: boolean, q: string): JSX.Element => {
    const key = item?.key ?? 'subscribers';
    if (item !== null && confirm === item.key) return confirmBox(item);
    const live = item === null ? null : (items.get(item.key) ?? item);
    const on = live === null ? items.get('subscribers')?.active === true : live.active;
    const name = live === null ? (items.get('subscribers')?.label ?? 'Subscribers') : shortName(live);
    return (
      <div class="cgg-mi-w" key={key}>
        <button type="button" class={`cgg-mi${on ? ' on' : ''}`} role="menuitemradio" aria-checked={on ? 'true' : 'false'} data-fk={`m-${key}`} data-nav data-cg-filter={key} onClick={(event) => pick(key, group, event.detail === 0)} {...(live === null || live.kind === 'base' ? {} : tipOf(live))}>
          <i class="cgg-ico">{live === null ? <Icon name="users" size={15} /> : <ItemIcon item={live} slots={slots} />}</i>
          <span class="cgg-nm">{highlight(name, q)}</span>
          {/* «Subscribers»: the number of all subscribers (Fansly's badge counts a tier while one was on). */}
          <Badge count={live === null ? g.subscribers : live.count} />
          {on ? (
            <i class="cgg-ck">
              <Icon name="check" size={14} />
            </i>
          ) : null}
        </button>
        {trash && live !== null ? (
          <button type="button" class="cgg-mtr" data-fk={`t-${key}`} data-nav aria-label={`${copy.unpinShort}: ${name}`} data-tip={copy.unpinShort} onClick={() => ask(live)}>
            <Icon name="trash" size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  const searchField = (placeholder: string): JSX.Element => (
    <div class="cgg-msearch">
      <Icon name="search" size={14} />
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={query}
        data-fk="mq"
        data-nav
        onInput={(event) => {
          setQuery((event.target as HTMLInputElement).value);
          setConfirm(null);
        }}
      />
    </div>
  );

  let panel: JSX.Element | null = null;
  if (open === 'subs') {
    const many = set.tiers.length + 1 >= SEARCH_FROM;
    const q = many ? query.trim() : '';
    const hits = q === '' ? null : set.tiers.filter((item) => item.label.toLowerCase().includes(q.toLowerCase()) || item.full.toLowerCase().includes(q.toLowerCase()));
    panel = (
      <div class="cgg-menu" role="menu" aria-label={copy.subsMenu} style="width:248px" ref={menu}>
        {many ? searchField(copy.findTier) : null}
        <div class="cgg-mscroll">
          {hits === null ? (
            <>
              {row(null, 'subs', false, '')}
              <div class="cgg-msep" />
              {set.tiers.map((item) => row(item, 'subs', false, ''))}
            </>
          ) : hits.length === 0 ? (
            <div class="cgg-mempty">{copy.nothingFound}</div>
          ) : (
            hits.map((item) => row(item, 'subs', false, q))
          )}
        </div>
      </div>
    );
  } else if (open === 'lists') {
    const many = set.lists.length >= SEARCH_FROM;
    const q = many ? query.trim() : '';
    const own = set.lists.filter((item) => item.kind === 'own');
    const fb = set.lists.filter((item) => item.kind === 'fb');
    let body: JSX.Element | JSX.Element[];
    if (q !== '') {
      const ql = q.toLowerCase();
      const hits = [...own, ...fb, ...set.steps].filter((item) => shortName(item).toLowerCase().includes(ql) || item.full.toLowerCase().includes(ql));
      body = hits.length === 0 ? <div class="cgg-mempty">{copy.nothingFound}</div> : hits.map((item) => row(item, 'lists', true, q));
    } else if (pinned.length === 0 && staff === null) {
      body = <div class="cgg-mempty">{copy.emptyLists}</div>;
    } else {
      const ladderConfirm = confirm !== null && set.steps.some((item) => item.key === confirm) ? (items.get(confirm) ?? null) : null;
      body = (
        <>
          {set.steps.length > 0 ? (
            <>
              <div class="cgg-mh">{copy.ladderHeader}</div>
              <div class="cgg-lad" role="group" aria-label={copy.ladderHeader}>
                {slots.map((slot, index) => {
                  if (slot.gap !== null) {
                    return (
                      <div class="cgg-gapslot" key={`gap:${String(index)}`} data-tip={copy.gap(kilo(slot.gap.from), kilo(slot.gap.to))} aria-hidden="true">
                        <i />
                      </div>
                    );
                  }
                  const item = slot.item === null ? null : (items.get(slot.item.key) ?? slot.item);
                  if (item === null || item.step === null) return null;
                  return (
                    <div class={`cgg-tile${item.active ? ' on' : ''}`} key={item.key}>
                      <button type="button" class="cgg-tsel" role="menuitemradio" aria-checked={item.active ? 'true' : 'false'} data-fk={`m-${item.key}`} data-nav data-cg-filter={item.key} onClick={(event) => pick(item.key, 'lists', event.detail === 0)} {...tipOf(item)}>
                        <Bars lit={slot.lit} bars={slot.bars} big />
                        <span class="cgg-lt">{stepLabel(item.step)}</span>
                      </button>
                      <Badge count={item.count} />
                      <button type="button" class="cgg-ttr" data-fk={`t-${item.key}`} data-nav aria-label={`${copy.unpinShort}: $${stepLabel(item.step)}`} data-tip={copy.unpinShort} onClick={() => ask(item)}>
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {ladderConfirm === null ? null : confirmBox(ladderConfirm)}
            </>
          ) : null}
          {set.steps.length > 0 && own.length > 0 ? <div class="cgg-msep" /> : null}
          {own.map((item) => row(item, 'lists', true, ''))}
          {fb.length > 0 ? (
            <>
              <div class="cgg-mh">{copy.fbHeader}</div>
              {fb.map((item) => row(item, 'lists', true, ''))}
            </>
          ) : null}
          {staff !== null ? (
            <>
              <div class="cgg-mh">{copy.fanslyHeader}</div>
              {row(staff, 'lists', false, '')}
            </>
          ) : null}
        </>
      );
    }
    panel = (
      <div class="cgg-menu" role="menu" aria-label={copy.allLists} style="width:328px" ref={menu}>
        {many ? searchField(copy.findList) : null}
        <div class="cgg-mscroll" onScroll={(event) => {
          const scroll = event.currentTarget as HTMLElement;
          scroll.classList.toggle('fade-b', scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2);
        }}>{body}</div>
        <div class="cgg-mfoot">
          <button
            type="button"
            class="cgg-mf"
            data-fk="pin"
            data-nav
            onClick={() => {
              closeAll(false);
              client.pin();
            }}
          >
            <Icon name="pencil" size={14} />
            {copy.pinList}
          </button>
        </div>
      </div>
    );
  }

  /** The menus' keys (§6.2): arrows over the search, rows and tiles (a trash only by Tab), Enter in the search picks the first hit, Esc the innermost. */
  const onKey = (event: KeyboardEvent): void => {
    const node = root.current;
    const target = event.target as HTMLElement | null;
    if (node === null || target === null) return;
    if (event.key === 'Escape') {
      if (confirm !== null) {
        event.preventDefault();
        event.stopPropagation();
        focusNext.current = `t-${confirm}`;
        setConfirm(null);
      } else if (query !== '') {
        event.preventDefault();
        event.stopPropagation();
        focusNext.current = 'mq';
        setQuery('');
      } else if (open !== null) {
        event.preventDefault();
        event.stopPropagation();
        closeAll(true);
      }
      hideTip();
      return;
    }
    const panelNode = menu.current;
    if (panelNode !== null && panelNode.contains(target)) {
      if (event.key === 'Enter' && target.dataset['fk'] === 'mq') {
        const first = panelNode.querySelector<HTMLElement>('.cgg-mi, .cgg-tsel');
        if (first !== null) {
          event.preventDefault();
          const key = first.dataset['cgFilter'];
          if (key !== undefined) pick(key, open ?? 'lists', true);
        }
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const all = [...panelNode.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => !el.matches('.cgg-mtr, .cgg-ttr') || el === target);
      if (all.length === 0) return;
      event.preventDefault();
      let at = all.indexOf(target);
      at = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : event.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      all[at]?.focus();
      all[at]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'ArrowDown' && (target.dataset['fk'] === 'c-subs' || target.dataset['fk'] === 'c-lists')) {
      event.preventDefault();
      if (open === null) toggle(target.dataset['fk'] === 'c-subs' ? 'subs' : 'lists', true);
    }
  };

  return (
    <div
      class={`cgg${narrow ? ' w400' : ''}`}
      ref={root}
      onKeyDown={onKey}
      onMouseOver={(event) => {
        const target = tipped(event);
        if (target !== null && !target.contains(event.relatedTarget as Node | null)) showTip(target, false);
      }}
      onMouseOut={(event) => {
        const target = tipped(event);
        if (target !== null && !target.contains(event.relatedTarget as Node | null)) hideTip();
      }}
      onFocusIn={(event) => {
        const target = tipped(event);
        if (target !== null && target.matches(':focus-visible')) showTip(target, true);
        else hideTip();
      }}
      onFocusOut={() => hideTip()}
    >
      <div class="cgg-strip">
        <div class="cgg-seg" role="toolbar" aria-label={copy.groupsLabel} ref={seg} data-cg-filters="groups" data-fallback={g.fallback ? 'true' : 'false'}>
          {one('all')}
          {subs}
          {one('vips')}
          {one('followers')}
          {lists}
        </div>
      </div>
      {panel}
      {tip === null ? null : (
        <div class="cgg-tip" ref={tipRef} role="tooltip">
          {tip.text}
          {tip.sub === null ? null : <small>{tip.sub}</small>}
        </div>
      )}
    </div>
  );
}

/** The refresh of «Четыре группы» in Fansly's search row (§4.2): Fansly's own refresh; it spins while Fansly's does. */
export function GroupsRefresh({ client, copy }: { readonly client: FanslyFiltersClient; readonly copy: FanslyFiltersCopy }): JSX.Element | null {
  const view = useFiltersView(client);
  if (view.mode !== 'groups') return null;
  return (
    <button type="button" class={`cgg-srf${view.spinning ? ' spin' : ''}`} aria-label={copy.refreshCounts} data-tip={copy.refreshCounts} data-cg-filter="refresh" onClick={() => client.refresh()}>
      <Icon name="refresh" size={16} />
    </button>
  );
}

/** The strip 10 px under the search row (its own 16 px, less 6) and 10 px over the list (§2.5). */
export const GROUPS_CSS = `
.cgg { position: relative; margin: -6px 4px 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; font-size: 16px; line-height: 1.25; color: var(--cgf-ink); }
.cgg, .cgg-srf { ${STRIP_TOKENS} }
.cgg.w400 { margin-left: 0; margin-right: 0; }
.cgg svg { display: block; }
.cgg-strip { margin: 0; }
.cgg-seg { display: flex; align-items: stretch; height: 30px; background: var(--cgf-chip); border-radius: 9px; padding: 2px; overflow: hidden; }
.cgg-sg { position: relative; flex: 1 0 auto; display: flex; align-items: stretch; border-radius: 7px; min-width: 0; overflow: hidden; }
.cgg-seg.measure .cgg-sg { flex-shrink: 0 !important; }
.cgg-seg.measure .cgg-sg.grp .cgg-lbl { min-width: 0; }
.cgg-sg.tight .cgg-lbl { display: none; }
.cgg-sg.tight .cgg-sb.main { justify-content: center; }
.cgg-sg.g-lists { flex-shrink: 8; }
.cgg-sg.g-subs { flex-shrink: 1; }
.cgg-sg.grp .cgg-lbl { min-width: 2.9em; }
.cgg-sg + .cgg-sg::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 1px; background: var(--cgf-line); transition: opacity .1s; }
.cgg-sg.on::before, .cgg-sg.on + .cgg-sg::before, .cgg-sg.open::before, .cgg-sg.open + .cgg-sg::before, .cgg-sg:hover::before, .cgg-sg:hover + .cgg-sg::before { opacity: 0; }
.cgg-sb { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 6px; border-radius: 7px; font-size: 12.5px; white-space: nowrap; color: var(--cgf-ink); min-width: 0; }
.cgg-lbl { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cgg-sb:hover { background: var(--cgf-hover); }
.cgg-sg.on { background: var(--cgf-on); box-shadow: inset 0 0 0 1px var(--cgf-on-line); }
.cgg-sg.on .cgg-sb:hover { background: var(--cgf-on-hover); }
.cgg-sg.open { background: var(--cgf-hover); }
.cgg-sg.split .cgg-sb.main { flex: 1 1 auto; justify-content: flex-end; padding-right: 3px; border-radius: 7px 0 0 7px; }
.cgg-sb.chv { flex: 1 0 auto; min-width: auto; justify-content: flex-start; padding: 0 6px 0 3px; border-radius: 0 7px 7px 0; position: relative; }
.cgg-sb.chv::after { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 1px; background: var(--cgf-line); opacity: 0; transition: opacity .1s; }
.cgg-sg.split:hover .cgg-sb.chv::after { opacity: 1; }
.cgg-chev { position: relative; width: 10px; height: 10px; color: var(--cgf-soft); flex: 0 0 10px; display: block; }
.cgg-sg.open .cgg-chev { transform: rotate(180deg); }
.cgg-dot { position: absolute; top: -4px; right: -5px; width: 7px; height: 7px; border-radius: 50%; background: var(--blue-1, #2699f7); box-shadow: 0 0 0 2px var(--cgf-chip); }
.cgg-sg.open .cgg-dot { top: auto; bottom: -4px; right: auto; left: -5px; }
.cgg-sg.on .cgg-dot { box-shadow: 0 0 0 2px var(--cgf-on); }
.cgg-cnt { min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--blue-1, #2699f7); color: #fff; font-weight: 700; font-size: 11px; line-height: 18px; text-align: center; flex: 0 0 auto; letter-spacing: 0; }
.cgg-cnt.rest { background: transparent; color: var(--cgf-soft); box-shadow: inset 0 0 0 1.5px var(--cgf-line); margin-left: 4px; }
.cgg-sg.on .cgg-cnt.rest { box-shadow: inset 0 0 0 1.5px var(--cgf-on-line); }
.cgg .cgg-cnt.rest.asdot { font-size: 0; min-width: 7px; width: 7px; height: 7px; padding: 0; margin-left: 3px; background: var(--blue-1, #2699f7); box-shadow: none; }
.cgg-fbi { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 13px; border: 1.2px solid var(--cgf-soft); border-radius: 3px; font: 800 7.5px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--cgf-soft); letter-spacing: -.3px; flex: 0 0 auto; }
.cgg-li { display: inline-flex; width: 13px; height: 13px; color: var(--cgf-soft); flex: 0 0 13px; }
.cgg-st { display: inline-flex; width: 12px; height: 12px; flex: 0 0 12px; }
.cgg-em { font-size: 12.5px; line-height: 1; flex: 0 0 auto; }
.cgg-mini { display: inline-flex; align-items: flex-end; gap: 1px; height: 12px; flex: 0 0 auto; }
.cgg-mini i { width: 2px; border-radius: 1px; background: var(--cgf-line); }
.cgg-mini i.lit { background: var(--cgf-soft); }
.cgg.w400 .cgg-sb { padding: 0 4px; font-size: 12px; gap: 3px; }
.cgg.w400 .cgg-sg.split .cgg-sb.main { padding-right: 2px; }
.cgg.w400 .cgg-sb.chv { padding: 0 5px 0 2px; }
.cgg.w400 .cgg-cnt { padding: 0 3.5px; min-width: 17px; font-size: 10.5px; }
.cg-root .cgg :focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: 1px; }
.cgg-menu { position: absolute; z-index: 20; display: flex; flex-direction: column; background: var(--cgf-pop); border: 1px solid var(--cgf-line); border-radius: 12px; box-shadow: var(--cgf-shadow); color: var(--cgf-ink); padding: 6px; font-size: 13.5px; line-height: 1.25; }
.cgg-mscroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--cgf-line) transparent; margin: 0 -2px; padding: 0 2px; }
.cgg-mscroll.fade-b { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 34px), rgba(0,0,0,.28)); mask-image: linear-gradient(180deg, #000 calc(100% - 34px), rgba(0,0,0,.28)); }
.cgg-mfoot { border-top: 1px solid var(--cgf-line); margin: 5px 2px 0; padding-top: 5px; }
.cgg-msearch { display: flex; align-items: center; gap: 7px; height: 32px; margin: 0 0 6px; padding: 0 10px; border-radius: 8px; background: var(--input-bg, #0e0f12); border: 1px solid var(--cgf-line); color: var(--cgf-faint); }
.cgg-msearch svg { flex: 0 0 14px; }
.cgg-msearch input { flex: 1; min-width: 0; background: none; border: 0; color: var(--cgf-ink); font-size: 13px; padding: 0; outline: none; }
.cgg-msearch input::placeholder { color: var(--cgf-faint); }
.cgg-msearch:focus-within { border-color: var(--cgf-on-line); }
.cg-root .cgg-msearch input:focus-visible { outline: none; }
.cgg-mempty { padding: 10px 10px 8px; color: var(--cgf-soft); font-size: 12.5px; line-height: 1.4; white-space: normal; }
.cgg-mi mark { background: none; color: var(--blue-1, #2699f7); font-weight: 700; }
.cgg-mi-w { position: relative; }
.cgg-mi { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 30px 0 10px; border-radius: 7px; white-space: nowrap; color: var(--cgf-ink); text-align: left; }
.cgg-mi:hover { background: var(--cgf-pop-hover); }
.cg-root .cgg-mi:focus-visible { outline: none; background: var(--cgf-pop-hover); box-shadow: inset 0 0 0 2px var(--blue-1, #2699f7); }
.cgg-mi.on { font-weight: 600; }
.cgg-nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cgg-ico { width: 16px; height: 16px; color: var(--cgf-soft); flex: 0 0 16px; display: flex; align-items: center; justify-content: center; }
.cgg-ico .cgg-em { font-size: 14px; width: 16px; text-align: center; }
.cgg-ck { position: absolute; right: 9px; top: 9px; width: 14px; height: 14px; color: var(--blue-1, #2699f7); }
.cgg-mtr { position: absolute; right: 4px; top: 4px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--blue-1, #2699f7); opacity: 0; }
.cgg-mi-w:hover .cgg-mtr, .cgg-mtr:focus-visible { opacity: 1; }
.cgg-mtr:hover { background: var(--cgf-pop-hover); }
.cgg-mi-w:hover .cgg-ck { opacity: 0; }
.cgg-mh { font-size: 10.5px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--cgf-faint); padding: 7px 10px 5px; }
.cgg-msep { height: 1px; background: var(--cgf-line); margin: 5px 4px; }
.cgg-mf { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 10px; border-radius: 7px; color: var(--cgf-soft); font-size: 13px; white-space: nowrap; text-align: left; }
.cgg-mf svg { color: var(--blue-1, #2699f7); }
.cgg-mf:hover { background: var(--cgf-pop-hover); color: var(--cgf-ink); }
.cg-root .cgg-mf:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--blue-1, #2699f7); }
.cgg-lad { display: flex; flex-wrap: wrap; gap: 6px 4px; padding: 2px; }
.cgg-tile { position: relative; flex: 1 1 0; min-width: 38px; }
.cgg-gapslot { flex: 0 0 8px; display: flex; justify-content: center; align-items: stretch; padding: 8px 0; }
.cgg-gapslot i { width: 0; border-left: 1.5px dotted var(--cgf-faint); }
.cgg-tsel { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 7px 2px 6px; border-radius: 8px; background: var(--cgf-chip); }
.cgg-tsel:hover { background: var(--cgf-hover); }
.cg-root .cgg-tsel:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--blue-1, #2699f7); }
.cgg-bars { display: flex; align-items: flex-end; gap: 1.5px; height: 13px; }
.cgg-bars i { width: 3px; border-radius: 1px; background: var(--cgf-line); }
.cgg-bars i.lit { background: var(--cgf-faint); }
.cgg-tsel:hover .cgg-bars i.lit { background: var(--cgf-soft); }
.cgg-lt { font-size: 10.5px; color: var(--cgf-soft); white-space: nowrap; letter-spacing: -.3px; }
.cgg-tile.on .cgg-tsel { background: var(--cgf-on); box-shadow: inset 0 0 0 1px var(--cgf-on-line); }
.cgg-tile.on .cgg-bars i.lit { background: var(--blue-1, #2699f7); }
.cgg-tile.on .cgg-lt { color: var(--cgf-ink); }
.cgg-tile .cgg-cnt { position: absolute; top: -6px; right: -3px; min-width: 16px; height: 16px; font-size: 10px; line-height: 16px; padding: 0 4px; box-shadow: 0 0 0 2px var(--cgf-pop); }
.cgg-ttr { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: var(--blue-1, #2699f7); opacity: 0; }
.cgg-tile:hover .cgg-ttr, .cgg-ttr:focus-visible { opacity: 1; }
.cgg-ttr:hover { background: var(--cgf-pop-hover); }
.cgg-cf { background: color-mix(in srgb, var(--cgf-red) 7%, var(--cgf-pop)); border: 1px solid color-mix(in srgb, var(--cgf-red) 32%, transparent); border-radius: 9px; padding: 9px 10px 10px; margin: 2px 0 4px; white-space: normal; }
.cgg-cf-t { font-size: 13px; font-weight: 700; color: var(--cgf-ink); line-height: 1.35; }
.cgg-cf-d { font-size: 12px; color: var(--cgf-soft); line-height: 1.4; margin-top: 3px; }
.cgg-cf-b { display: flex; gap: 8px; margin-top: 9px; }
.cgg-del { display: flex; align-items: center; gap: 6px; background: var(--cgf-red); color: #fff; font-weight: 700; font-size: 12.5px; border-radius: 6px; padding: 5px 10px; }
.cgg-del:hover { background: color-mix(in srgb, var(--cgf-red) 88%, #000); }
.cgg-no { background: var(--cgf-chip); color: var(--cgf-ink); font-size: 12.5px; border-radius: 6px; padding: 5px 12px; }
.cgg-no:hover { background: var(--cgf-hover); }
.cgg-tip { position: absolute; z-index: 40; background: var(--cgf-pop); border: 1px solid var(--cgf-line); color: var(--cgf-ink); font-size: 12px; line-height: 1.35; padding: 6px 9px; border-radius: 7px; box-shadow: var(--cgf-shadow); white-space: nowrap; pointer-events: none; }
.cgg-tip small { display: block; color: var(--cgf-soft); font-size: 11px; }
.cgg-srf { position: relative; width: 28px; height: 28px; margin-left: 7px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: var(--cgf-soft); flex: 0 0 28px; }
.cgg-srf:hover { color: var(--cgf-ink); background: var(--cgf-hover); }
.cgg-srf.spin svg { animation: cgg-spin .7s linear infinite; }
.cg-root .cgg-srf:focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: 1px; border-radius: 7px; }
.cgg-srf[data-tip]::after { content: attr(data-tip); position: absolute; top: 34px; right: 0; z-index: 6; display: none; background: var(--cgf-pop); border: 1px solid var(--cgf-line); color: var(--cgf-ink); font-size: 12px; line-height: 1.35; padding: 6px 9px; border-radius: 7px; box-shadow: var(--cgf-shadow); white-space: nowrap; pointer-events: none; }
.cgg-srf[data-tip]:hover::after, .cgg-srf[data-tip]:focus-visible::after { display: block; }
@keyframes cgg-spin { to { transform: rotate(360deg); } }
`;
