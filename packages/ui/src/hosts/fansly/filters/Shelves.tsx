// «Две полки» (2026-11-13; shelves spec): Fansly's filter chips drawn again as three shelves — All and Subscribers with
// its tiers; VIPs, Followers and the lists; the spend ladder — at most five rows, the rows computed by the core from the
// set and the width (never from a count, the active filter, a hover or a focus), «ещё N» for what does not fit and «⋯»
// for the actions. Every press is a click on Fansly's own chip (the controller's client).
//
// - A chip: the label left, an 18 px slot for its count always there, so a count never moves anything (§3, §5.1).
// - One tab stop (roving), arrows move through the cells (§6.2); one popover at a time, Esc and a press outside close it.
// - Unpinning a list asks first (§7), behind UNPIN_CONFIRM: the owner has not said yet whether the question stays.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { FanslyFilterItem, FanslyFiltersClient, FanslyFiltersCopy, FanslyShelfCell } from '@cg/contracts/fansly-filters';

import { Icon, STRIP_TOKENS, useFiltersView, useMeasure, useOutside, useWidth } from './common';

/** Shelves spec §7: «Убрать список» asks «Убрать … из фильтров?» before Fansly's own trash; false — the picker unpins at once. */
export const UNPIN_CONFIRM = true;

type Pop = { readonly view: 'ov'; readonly key: string } | { readonly view: 'menu' } | { readonly view: 'pick' } | { readonly view: 'confirm'; readonly key: string } | null;

const SHAPE: Readonly<Record<NonNullable<FanslyShelfCell['shape']>, string>> = { first: 'g1', middle: 'gm', last: 'g9' };

function Badge({ count }: { readonly count: string | null }): JSX.Element | null {
  if (count === null) return null;
  return <span class={`cgf-b${count === '99+' ? ' cgf-b3' : count.length > 1 ? ' cgf-b2' : ''}`}>{count}</span>;
}

/** The sum of what an «ещё N» hides, as a badge (`99+` counts as 100). */
const hiddenCount = (hidden: readonly string[], items: ReadonlyMap<string, FanslyFilterItem>): string | null => {
  const sum = hidden.reduce((total, key) => total + (items.get(key)?.n ?? 0), 0);
  return sum <= 0 ? null : sum > 99 ? '99+' : String(sum);
};

function ItemIcon({ item }: { readonly item: FanslyFilterItem }): JSX.Element | null {
  if (item.kind === 'tier') {
    return (
      <span class="cgf-ic">
        <Icon name="star" size={12} color={item.color ?? 'currentColor'} />
      </span>
    );
  }
  return item.emoji === null ? null : <span class="cgf-ic cgf-em">{item.emoji}</span>;
}

export function Shelves({ client, copy }: { readonly client: FanslyFiltersClient; readonly copy: FanslyFiltersCopy }): JSX.Element | null {
  const view = useFiltersView(client);
  const box = useWidth<HTMLDivElement>();
  const { ref: line, measure } = useMeasure();
  const [ready, setReady] = useState(false);
  const [pop, setPop] = useState<Pop>(null);
  const [rover, setRover] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  // The hidden line is in the page first: the texts are measured in the strip's own font from the first layout.
  useLayoutEffect(() => setReady(true), []);
  const width = box.width > 0 ? box.width : view.width;
  const layout = ready && view.set !== null ? client.shelves(width, measure) : null;
  const cells = layout?.rows.flatMap((row) => row.cells) ?? [];
  const items = view.items;
  const activeKey = [...items.values()].find((item) => item.active)?.key ?? 'all';
  const holder = cells.find((c) => c.type === 'overflow' && c.hidden.includes(activeKey))?.key ?? activeKey;
  const stop = rover !== null && cells.some((c) => c.key === rover && c.type !== 'label') ? rover : holder;

  const close = (back: boolean): void => {
    if (pop === null) return;
    if (back) focusNext.current = pop.view === 'ov' ? pop.key : 'more';
    setPop(null);
  };
  useOutside(pop !== null, root, () => setPop(null));
  // A set that changed under an open popover: the picker and the question go; a menu stays while its anchor does.
  const signature = view.set?.signature ?? '';
  useEffect(() => {
    setPop((current) => (current === null || current.view === 'menu' || (current.view === 'ov' && cells.some((c) => c.key === current.key)) ? current : null));
  }, [signature]);

  // After each render: focus where it was asked, the popover under its anchor, tooltips of the right half to the left.
  useLayoutEffect(() => {
    const node = root.current;
    if (node === null) return;
    const want = focusNext.current;
    focusNext.current = null;
    if (want !== null) node.querySelector<HTMLElement>(`[data-cgf-focus="${CSS.escape(want)}"]`)?.focus({ preventScroll: true });
    const rr = node.getBoundingClientRect();
    for (const tipped of node.querySelectorAll<HTMLElement>('.cgf-c[data-tip]')) tipped.classList.toggle('tr', tipped.getBoundingClientRect().left - rr.left > rr.width / 2);
    const panel = popRef.current;
    if (panel === null || pop === null) return;
    const anchor = node.querySelector<HTMLElement>(`[data-cgf-key="${CSS.escape(pop.view === 'ov' ? pop.key : 'more')}"]`);
    if (anchor === null) return;
    const ar = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    panel.style.left = `${String(Math.max(-4, Math.min(ar.right - rr.left - w, rr.width + 4 - w)))}px`;
    panel.style.top = `${String(ar.bottom - rr.top + 6)}px`;
  });

  if (layout === null) {
    return (
      <div class="cgf" ref={root}>
        <div class="cgf-rows" ref={box.ref} />
        <div class="cgf-meas" ref={line} aria-hidden="true" />
      </div>
    );
  }

  const open = (next: Pop, focus: string | null): void => {
    focusNext.current = focus;
    setPop(next);
  };
  const press = (item: FanslyFilterItem): void => {
    setPop(null);
    client.select(item.ref);
  };

  const cell = (c: FanslyShelfCell): JSX.Element => {
    if (c.type === 'label') return <span class="cgf-ll" key={c.key}>{c.text}</span>;
    const focusable = { tabIndex: c.key === stop ? 0 : -1, 'data-cgf-key': c.key, 'data-cgf-focus': c.key, onFocus: () => setRover(c.key) };
    if (c.type === 'more') {
      const on = pop !== null && pop.view !== 'ov';
      return (
        <button
          key="more"
          type="button"
          class={`cgf-c cgf-more${on ? ' on' : ''}`}
          data-tip={copy.actions}
          aria-label={copy.actions}
          aria-haspopup="menu"
          aria-expanded={on ? 'true' : 'false'}
          onClick={() => (on ? close(true) : open({ view: 'menu' }, 'a:add'))}
          {...focusable}
        >
          <Icon name="dots" size={16} />
        </button>
      );
    }
    if (c.type === 'overflow') {
      const expanded = pop?.view === 'ov' && pop.key === c.key;
      const on = c.hidden.includes(activeKey);
      const first = c.hidden[0] ?? null;
      return (
        <button
          key={c.key}
          type="button"
          class={`cgf-c${on ? ' on' : ''}`}
          aria-haspopup="menu"
          aria-expanded={expanded ? 'true' : 'false'}
          onClick={() => (expanded ? close(true) : open({ view: 'ov', key: c.key }, first === null ? null : `h:${first}`))}
          {...focusable}
        >
          <span class="cgf-lb">{c.text}</span>
          <span class="cgf-sl">
            <Badge count={hiddenCount(c.hidden, items)} />
          </span>
        </button>
      );
    }
    const item = items.get(c.key);
    if (item === undefined) return <span key={c.key} />;
    const shape = c.shape === null ? '' : ` ${SHAPE[c.shape]}`;
    const say = c.text === null || c.tip !== null || c.text !== item.full ? (item.kind === 'step' ? copy.stepSay(item.label) : item.full) : undefined;
    return (
      <button
        key={c.key}
        type="button"
        class={`cgf-c${shape}${c.inner ? ' in' : ''}${c.joint ? ' j' : ''}${item.active ? ' on' : ''}`}
        aria-pressed={item.active ? 'true' : 'false'}
        aria-label={say}
        data-tip={c.tip ?? undefined}
        data-cg-filter={item.key}
        onClick={() => press(item)}
        {...focusable}
      >
        <ItemIcon item={item} />
        {c.text === null ? null : <span class="cgf-lb">{c.text}</span>}
        <span class="cgf-sl">
          <Badge count={item.count} />
        </span>
      </button>
    );
  };

  /** Arrows inside the strip: the cells in reading order, up and down to the nearest left edge; Esc closes a popover. */
  const onKey = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    if (event.key === 'Escape' && pop !== null) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const inPop = target.closest('.cgf-pop') !== null;
    const node = root.current;
    if (node === null) return;
    if (inPop) {
      const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
      const horizontal = (event.key === 'ArrowRight' || event.key === 'ArrowLeft') && pop?.view === 'confirm';
      if (!vertical && !horizontal) return;
      const all = [...node.querySelectorAll<HTMLElement>('.cgf-pop [data-cgf-focus]')];
      const at = all.indexOf(target);
      if (at < 0) return;
      event.preventDefault();
      all[(at + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
      return;
    }
    if (!target.classList.contains('cgf-c')) return;
    const all = [...node.querySelectorAll<HTMLElement>('.cgf-rows .cgf-c')];
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const at = all.indexOf(target);
      if (at < 0) return;
      event.preventDefault();
      all[(at + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...node.querySelectorAll<HTMLElement>('.cgf-row')];
      const next = rows[rows.indexOf(target.closest('.cgf-row') as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next === undefined) return;
      event.preventDefault();
      const x = target.getBoundingClientRect().left;
      [...next.querySelectorAll<HTMLElement>('.cgf-c')].sort((a, b) => Math.abs(a.getBoundingClientRect().left - x) - Math.abs(b.getBoundingClientRect().left - x))[0]?.focus();
    }
  };
  /** Tab out of a popover closes it. */
  const onFocusOut = (event: FocusEvent): void => {
    const panel = popRef.current;
    const to = event.relatedTarget as Node | null;
    if (panel !== null && pop !== null && panel.contains(event.target as Node) && to !== null && !panel.contains(to)) setPop(null);
  };

  const set = view.set;
  const row = (id: string, label: string | JSX.Element, onClick: () => void, icon: JSX.Element | null, extra: Readonly<Record<string, string>> = {}): JSX.Element => (
    <button key={id} type="button" class="cgf-mi" data-cgf-focus={id} onClick={onClick} {...extra}>
      {icon}
      {label}
    </button>
  );
  const nameOf = (item: FanslyFilterItem): string => (item.kind === 'step' ? copy.stepSay(item.label) : item.label);
  let panel: JSX.Element | null = null;
  if (pop !== null && set !== null) {
    if (pop.view === 'ov') {
      const hidden = cells.find((c) => c.key === pop.key)?.hidden ?? [];
      // The count of each row on its right, as on a chip.
      panel = (
        <div class="cgf-pop cgf-ovp" role="menu" aria-label={pop.key === 'ov:tiers' ? copy.moreTiers : copy.moreLists} ref={popRef}>
          <div class="cgf-pl">
            {hidden.map((key) => {
              const item = items.get(key);
              if (item === undefined) return null;
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.active ? 'true' : 'false'}
                  class={`cgf-mi${item.active ? ' cur' : ''}`}
                  data-cgf-focus={`h:${key}`}
                  data-cg-filter={item.key}
                  onClick={() => {
                    focusNext.current = pop.key;
                    press(item);
                  }}
                >
                  <span class="cgf-ic cgf-mic">{item.kind === 'tier' ? <Icon name="star" size={12} color={item.color ?? 'currentColor'} /> : (item.emoji ?? '')}</span>
                  <span class="cgf-nm">{nameOf(item)}</span>
                  <Badge count={item.count} />
                </button>
              );
            })}
          </div>
        </div>
      );
    } else if (pop.view === 'menu') {
      const pinned = set.lists.length + set.steps.length > 0;
      panel = (
        <div class="cgf-pop cgf-menu" role="menu" aria-label={copy.actions} ref={popRef}>
          {row(
            'a:add',
            copy.addList,
            () => {
              setPop(null);
              client.pin();
            },
            <Icon name="pencil" size={15} />,
            { role: 'menuitem' },
          )}
          {pinned
            ? row(
                'a:pick',
                copy.removeList,
                () => {
                  const first = set.lists[0] ?? set.steps[0];
                  open({ view: 'pick' }, first === undefined ? null : `p:${first.key}`);
                },
                <Icon name="trash" size={15} />,
                { role: 'menuitem' },
              )
            : null}
          {row(
            'a:refresh',
            copy.refresh,
            () => {
              focusNext.current = 'more';
              setPop(null);
              client.refresh();
            },
            <Icon name="refresh" size={15} />,
            { role: 'menuitem' },
          )}
        </div>
      );
    } else if (pop.view === 'pick') {
      const choose = (item: FanslyFilterItem): void => {
        if (UNPIN_CONFIRM) open({ view: 'confirm', key: item.key }, 'a:cancel');
        else {
          focusNext.current = 'more';
          setPop(null);
          if (item.ref.kind === 'list') client.unpin(item.ref);
        }
      };
      panel = (
        <div class="cgf-pop cgf-pick" role="dialog" aria-label={copy.removeHeader} ref={popRef}>
          <div class="cgf-ph">
            <Icon name="trash" size={15} />
            {copy.removeHeader}
          </div>
          <div class="cgf-pl">
            {set.lists.map((item) => row(`p:${item.key}`, <span class="cgf-nm">{item.label}</span>, () => choose(item), <span class="cgf-ic cgf-mic">{item.emoji ?? ''}</span>, { 'data-cg-filter': item.key }))}
            {set.lists.length > 0 && set.steps.length > 0 ? <div class="cgf-psep" /> : null}
            {set.steps.map((item) =>
              row(
                `p:${item.key}`,
                <span>
                  <span class="cgf-lead">{copy.stepLead}</span>${item.label}
                </span>,
                () => choose(item),
                <span class="cgf-ic cgf-mic" />,
                { 'data-cg-filter': item.key },
              ),
            )}
          </div>
        </div>
      );
    } else {
      const item = items.get(pop.key);
      if (item !== undefined) {
        const name = item.kind === 'step' ? copy.stepSay(item.label) : item.kind === 'fb' ? item.label : item.full;
        panel = (
          <div class="cgf-pop cgf-confirm" role="alertdialog" aria-label={copy.confirmTitle(name)} ref={popRef}>
            <div class="cgf-ct">
              <Icon name="trash" size={15} />
              <span>{copy.confirmTitle(name)}</span>
            </div>
            <div class="cgf-cx">{copy.confirmText}</div>
            <div class="cgf-cb">
              <button type="button" class="cgf-btn" data-cgf-focus="a:cancel" onClick={() => close(true)}>
                {copy.cancel}
              </button>
              <button
                type="button"
                class="cgf-btn cgf-danger"
                data-cgf-focus="a:unpin"
                onClick={() => {
                  focusNext.current = 'more';
                  setPop(null);
                  // Gone meanwhile (another chatter unpinned it): nothing is clicked.
                  if (item.ref.kind === 'list') client.unpin(item.ref);
                }}
              >
                {copy.remove}
              </button>
            </div>
          </div>
        );
      }
    }
  }

  return (
    <div class="cgf" ref={root} onKeyDown={onKey} onFocusOut={onFocusOut}>
      <div class="cgf-rows" role="group" aria-label={copy.strip} ref={box.ref} data-cg-filters="shelves" data-rows={String(layout.rows.length)}>
        {layout.rows.map((r, index) => (
          <div class="cgf-row" data-shelf={String(r.shelf)} key={`${String(r.shelf)}:${String(index)}`} role={r.shelf === 3 ? 'group' : undefined} aria-label={r.shelf === 3 ? copy.ladder : undefined}>
            {r.cells.map(cell)}
          </div>
        ))}
      </div>
      {panel}
      <div class="cgf-meas" ref={line} aria-hidden="true" />
    </div>
  );
}

export const SHELVES_CSS = `
.cgf { position: relative; margin: 0 4px; font-family: var(--v2-font-family-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif); font-size: 12.25px; line-height: 22px; color: var(--cgf-ink); ${STRIP_TOKENS} }
.cgf-rows { min-height: 22px; padding-bottom: 4px; }
.cgf-meas { position: absolute; left: -9999px; top: 0; visibility: hidden; white-space: nowrap; pointer-events: none; }
.cgf-meas > span { white-space: nowrap; }
.cgf-row { display: flex; align-items: center; height: 22px; margin-bottom: 5px; white-space: nowrap; }
.cgf-row:last-child { margin-bottom: 0; }
.cgf-c {
  display: inline-flex; align-items: center; flex: 0 0 auto; height: 22px; padding: 0 2px 0 8px; border-radius: 11px; background: var(--cgf-chip);
  white-space: nowrap; margin-right: 5px; position: relative; transition: background-color .1s linear; color: inherit;
}
.cgf-c.in { padding-left: 5px; }
.cgf-c.j { margin-right: 1px; }
.cgf-c.g1 { border-radius: 11px 3px 3px 11px; }
.cgf-c.gm { border-radius: 3px; }
.cgf-c.g9 { border-radius: 3px 11px 11px 3px; }
.cgf-c:hover { background: var(--cgf-hover); }
.cgf-c.on { background: var(--cgf-on); box-shadow: inset 0 0 0 1px var(--cgf-on-line); }
.cgf-c.on:hover { background: var(--cgf-on-hover); }
.cg-root .cgf-c:focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: 2px; z-index: 2; border-radius: 11px; }
.cgf-ic { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.cgf-ic svg { display: block; }
.cgf-em, .cgf-meas .cgf-em { font-size: 12px; line-height: 1; }
.cgf-lb { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cgf-ic + .cgf-lb { margin-left: 3px; }
.cgf-sl { flex: 0 0 18px; width: 18px; height: 18px; margin-left: 3px; position: relative; }
.cgf-b { position: absolute; top: 0; left: 50%; transform: translateX(-50%); min-width: 18px; height: 18px; border-radius: 9px; background: var(--blue-1, #2699f7); color: #fff; font-weight: 700; font-size: 11.5px; line-height: 18px; text-align: center; }
.cgf-b.cgf-b2 { font-size: 10.5px; }
.cgf-b.cgf-b3 { font-size: 9px; min-width: 21px; letter-spacing: -.2px; }
.cgf-ll { flex: 0 0 auto; color: var(--cgf-soft); margin-right: 6px; white-space: nowrap; }
.cgf-c.cgf-more { padding: 0; width: 24px; justify-content: center; margin-right: 0; color: var(--cgf-soft); }
.cgf-c.cgf-more:hover, .cgf-c.cgf-more.on { color: var(--cgf-ink); }
.cgf-c.cgf-more svg { display: block; }
.cgf-c[data-tip]::after {
  content: attr(data-tip); position: absolute; top: 28px; left: 0; z-index: 6; display: none; background: var(--cgf-pop); border: 1px solid var(--cgf-line); border-radius: 6px;
  padding: 4px 8px; font-size: 12px; font-weight: 400; line-height: 16px; color: var(--cgf-ink); white-space: nowrap; box-shadow: var(--cgf-shadow); pointer-events: none;
}
.cgf-c[data-tip].tr::after { left: auto; right: 0; }
.cgf-c[data-tip]:hover::after, .cgf-c[data-tip]:focus-visible::after { display: block; }
.cgf-c[aria-expanded="true"]::after { display: none !important; }
.cgf-pop { position: absolute; z-index: 8; background: var(--cgf-pop); border: 1px solid var(--cgf-line); border-radius: 10px; box-shadow: var(--cgf-shadow); padding: 5px; font-size: 13px; line-height: 18px; color: var(--cgf-ink); }
.cgf-mi { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 12px 7px 10px; border-radius: 6px; white-space: nowrap; color: var(--cgf-ink); text-align: left; }
.cgf-mi svg { display: block; flex: 0 0 auto; color: var(--blue-1, #2699f7); }
.cgf-mi:hover { background: var(--cgf-pop-hover); }
.cg-root .cgf-mi:focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: -2px; border-radius: 6px; }
.cgf-mic { width: 16px; font-size: 13px; line-height: 1; text-align: center; }
.cgf-lead { color: var(--cgf-soft); }
.cgf-pick { width: 264px; }
.cgf-ovp { min-width: 220px; max-width: 300px; }
.cgf-ovp .cgf-pl { max-height: 300px; }
.cgf-nm { overflow: hidden; text-overflow: ellipsis; }
.cgf-mi .cgf-b { position: static; transform: none; margin-left: auto; padding: 0 5px; flex: 0 0 auto; }
.cgf-mi.cur { box-shadow: inset 0 0 0 1px var(--cgf-on-line); background: var(--cgf-on); }
.cgf-pick .cgf-mi { padding: 5px 12px 5px 10px; }
.cgf-ph { display: flex; align-items: center; gap: 9px; padding: 7px 10px 6px; font-weight: 600; color: var(--cgf-ink); }
.cgf-ph svg { color: var(--blue-1, #2699f7); display: block; }
.cgf-pl { max-height: 330px; overflow: auto; scrollbar-width: thin; }
.cgf-psep { height: 1px; background: var(--cgf-line); margin: 4px 8px; }
.cgf-confirm { width: 304px; padding: 14px 14px 12px; }
.cgf-ct { display: flex; gap: 9px; font-weight: 700; font-size: 14px; line-height: 19px; }
.cgf-ct svg { color: var(--blue-1, #2699f7); margin-top: 2px; flex: 0 0 auto; display: block; }
.cgf-cx { margin-top: 7px; color: var(--cgf-soft); font-size: 13px; line-height: 18px; }
.cgf-cb { display: flex; justify-content: flex-end; gap: 8px; margin-top: 13px; }
.cgf-btn { font-size: 12.5px; line-height: 1; padding: 7px 12px; border-radius: 7px; background: var(--cgf-chip); border: 1px solid var(--cgf-line); color: var(--cgf-ink); font-weight: 600; }
.cgf-btn:hover { background: var(--cgf-hover); }
.cgf-btn.cgf-danger { border-color: color-mix(in srgb, var(--cgf-red) 55%, transparent); color: var(--cgf-red); background: color-mix(in srgb, var(--cgf-red) 8%, var(--cgf-pop)); }
.cgf-btn.cgf-danger:hover { background: color-mix(in srgb, var(--cgf-red) 14%, var(--cgf-pop)); }
.cg-root .cgf-btn:focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: 2px; border-radius: 7px; }
`;
