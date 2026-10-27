// The open fan's warning marks in Fansly's own chat header, after «Регистрация»: the agency's list the fan is in («💩
// Бомж», the list's own label) and «⛔ Блоклист» when FANSLY BLOCKLIST has posts about the fan. In that row's size, its
// marks in the warm and the red ink; nothing at all when no mark applies. Warnings only: they disable nothing.
//
// Each mark explains itself in a card under it: on hover (after a short pause, kept while the pointer is over the mark
// or the card), on keyboard focus, and pinned by a click (a second click, Esc or a press elsewhere puts it away). The
// card is a manual popover: the top layer escapes the slot's `contain: layout` and the header's clipping, as our
// tooltip does (kit/components/Tooltip.tsx); without popover support it stands `position: fixed`.
import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { FanMarksClient, FanMarksCopy, FanMarksView } from '@cg/contracts/fan-marks-fansly';

import { useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

type Which = 'lists' | 'blocklist';
type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

/** The pause before a hover opens a card, and before leaving both the mark and its card puts it away. */
export const FAN_MARKS_HOVER = { openMs: 300, closeMs: 250 } as const;
const GAP_PX = 6;
const EDGE_PX = 8;

function useView(client: FanMarksClient): FanMarksView {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

export function fanMarksSurface(client: FanMarksClient, texts: Readonly<Record<'ru' | 'en', FanMarksCopy>>): SurfaceDefinition {
  function FanMarks(): JSX.Element | null {
    const copy = texts[useI18n().language];
    const now = useNowFn();
    const view = useView(client);
    const id = useId();
    const [open, setOpen] = useState<{ readonly which: Which; readonly pinned: boolean } | null>(null);
    const root = useRef<HTMLSpanElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const marks = useRef<Partial<Record<Which, HTMLButtonElement | null>>>({});
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clear = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const later = (ms: number, run: () => void): void => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        run();
      }, ms);
    };
    const shown = { lists: view.lists !== null, blocklist: view.posts.length > 0 } as const;
    // A mark that went (another chat, a new answer) takes its card along.
    const which = open !== null && shown[open.which] ? open.which : null;

    useEffect(() => clear, []);
    useLayoutEffect(() => {
      const bubble = card.current as PopoverElement | null;
      const anchor = which === null ? null : (marks.current[which] ?? null);
      if (bubble === null || anchor === null) return;
      const place = (): void => {
        try {
          if (!bubble.matches(':popover-open')) bubble.showPopover?.();
        } catch {
          // No popover support: the fixed card is the fallback.
        }
        const win = bubble.ownerDocument.defaultView;
        const at = anchor.getBoundingClientRect();
        const own = bubble.getBoundingClientRect();
        const width = win?.innerWidth ?? Number.POSITIVE_INFINITY;
        const height = win?.innerHeight ?? Number.POSITIVE_INFINITY;
        const top = at.bottom + GAP_PX;
        bubble.style.top = `${Math.round(top)}px`;
        bubble.style.left = `${Math.round(Math.max(EDGE_PX, Math.min(at.left, width - own.width - EDGE_PX)))}px`;
        bubble.style.maxHeight = `${Math.max(120, Math.round(height - top - EDGE_PX))}px`;
        bubble.style.visibility = 'visible';
      };
      place();
      const win = bubble.ownerDocument.defaultView;
      win?.addEventListener('resize', place);
      return () => win?.removeEventListener('resize', place);
    }, [which, view]);
    // A press anywhere else puts a card away. Our root is closed: from the page's document the press is on our host.
    useEffect(() => {
      if (which === null) return;
      const node = root.current;
      const host = node === null ? null : (node.getRootNode() as ShadowRoot).host;
      const doc = node?.ownerDocument;
      if (host === null || host === undefined || doc === undefined) return;
      const onPress = (event: PointerEvent): void => {
        if (!event.composedPath().includes(host)) setOpen(null);
      };
      // Passive, only while a card is out: it reads the path and never cancels the page's own press.
      doc.addEventListener('pointerdown', onPress, { capture: true, passive: true });
      return () => doc.removeEventListener('pointerdown', onPress, { capture: true });
    }, [which]);

    if (!shown.lists && !shown.blocklist) return null;

    const enter = (mark: Which): void => {
      if (open?.which === mark) return clear();
      // From one mark to the other while a card is out: no second pause.
      if (open !== null && !open.pinned) {
        clear();
        setOpen({ which: mark, pinned: false });
        return;
      }
      if (open === null) later(FAN_MARKS_HOVER.openMs, () => setOpen({ which: mark, pinned: false }));
    };
    const leave = (): void => {
      if (open === null) return clear();
      if (!open.pinned) later(FAN_MARKS_HOVER.closeMs, () => setOpen(null));
    };
    const press = (mark: Which): void => {
      clear();
      setOpen(open?.which === mark && open.pinned ? null : { which: mark, pinned: true });
    };
    const escape = (event: TargetedKeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Escape' || which === null) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = marks.current[which];
      setOpen(null);
      anchor?.focus();
    };
    const mark = (kind: Which, label: string): JSX.Element => (
      <>
        <span aria-hidden="true" class="cg-fm__divider">
          |
        </span>
        <button
          type="button"
          ref={(node) => {
            marks.current[kind] = node;
          }}
          class={`cg-fm__mark cg-fm__mark--${kind}`}
          data-fan-mark={kind}
          aria-expanded={which === kind ? 'true' : 'false'}
          aria-controls={which === kind ? `cg-fm-${id}` : undefined}
          onPointerEnter={() => enter(kind)}
          onPointerLeave={leave}
          onClick={() => press(kind)}
          onFocus={(event) => {
            if (open === null && event.currentTarget.matches(':focus-visible')) setOpen({ which: kind, pinned: false });
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (open !== null && !open.pinned && !(next !== null && card.current?.contains(next))) setOpen(null);
          }}
          onKeyDown={escape}
        >
          <span class="cg-fm__label">{label}</span>
        </button>
      </>
    );

    return (
      <span class="cg-fm" ref={root} data-fan-marks={[shown.lists ? 'lists' : '', shown.blocklist ? 'blocklist' : ''].filter(Boolean).join(' ')}>
        {view.lists === null ? null : mark('lists', view.lists.label)}
        {shown.blocklist ? mark('blocklist', copy.blocklist) : null}
        {which === null ? null : (
          <div
            ref={card}
            id={`cg-fm-${id}`}
            class={`cg-fm__card cg-fm__card--${which}`}
            data-fan-marks-card={which}
            role="dialog"
            aria-label={which === 'lists' ? (view.lists?.label ?? '') : copy.postsTitle}
            popover="manual"
            style={{ visibility: 'hidden' }}
            onPointerEnter={clear}
            onPointerLeave={leave}
            onKeyDown={escape}
          >
            {which === 'lists' ? (
              (view.lists?.groups ?? []).map((group) => (
                <p key={group.label} class="cg-fm__where">
                  {copy.listsWhere(group.label, group.here, group.names)}
                </p>
              ))
            ) : (
              <>
                <p class="cg-fm__title">{copy.postsTitle}</p>
                <p class="cg-fm__about">{copy.postsAbout}</p>
                <ul class="cg-fm__posts">
                  {view.posts.map((post) => (
                    <li key={`${String(post.postedAt)}|${post.link ?? post.text}`} class="cg-fm__post">
                      <p class="cg-fm__meta">{[copy.date(post.postedAt, now()), post.author, post.renamed ? copy.aboutHandle(post.handle) : null].filter((part): part is string => part !== null && part !== '').join(' · ')}</p>
                      <p class="cg-fm__text">{post.text}</p>
                      {post.link === null ? null : (
                        <a class="cg-fm__open" href={post.link} target="_blank" rel="noopener noreferrer">
                          {copy.open}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                {view.posts.some((post) => post.link !== null) ? <p class="cg-fm__note">{copy.openNote}</p> : null}
              </>
            )}
          </div>
        )}
      </span>
    );
  }
  return {
    view: FanMarks,
    styles: [
      {
        id: 'cg-fan-marks',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-fm { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; }
    .cg-fm__divider { margin: 0 2px; }
    .cg-fm__mark { all: unset; display: inline-flex; align-items: center; cursor: pointer; border-radius: 6px; font-weight: 500; }
    .cg-fm__mark--lists { color: var(--cg-amber-ink); }
    .cg-fm__mark--blocklist { color: var(--cg-bad-ink); }
    .cg-fm__label { display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
    .cg-fm__mark:hover .cg-fm__label, .cg-fm__mark[aria-expanded='true'] .cg-fm__label { text-decoration: underline; text-underline-offset: 2px; }
    .cg-fm__mark:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
    .cg-fm__card {
      position: fixed; z-index: 970; inset: auto; top: 0; left: 0; margin: 0; border: 0; box-sizing: border-box;
      width: max-content; max-width: min(360px, calc(100vw - 16px)); overflow: auto; padding: 10px 12px;
      border-radius: var(--cg-r-lg); background: var(--cg-raised); color: var(--cg-ink);
      box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
      font-family: var(--cg-font); font-size: var(--cg-text-sm); line-height: 17px; font-weight: 400; white-space: normal; text-align: left;
    }
    .cg-fm__card p { margin: 0; }
    .cg-fm__where + .cg-fm__where { margin-top: 4px; }
    .cg-fm__title { color: var(--cg-bad-ink); font-weight: 600; }
    .cg-fm__about { margin-top: 2px; color: var(--cg-ink-muted); }
    .cg-fm__posts { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .cg-fm__post { padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
    .cg-fm__meta { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; font-variant-numeric: tabular-nums; }
    .cg-fm__text { margin-top: 3px; color: var(--cg-ink); white-space: pre-line; overflow-wrap: anywhere; }
    .cg-fm__open { display: inline-block; margin-top: 5px; color: var(--cg-accent); font-weight: 500; text-decoration: none; border-radius: 4px; }
    .cg-fm__open:hover { text-decoration: underline; text-underline-offset: 2px; }
    .cg-fm__open:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
    .cg-fm__note { margin-top: 8px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
  `,
      },
    ],
  };
}
