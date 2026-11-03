// «Фан удалил» in Fansly's own chat header, after the fan's marks (2026-11-03, the owner: «показывать удаленные
// сообщения фана»): the trash, «Удалил» and how many, in that row's size and ink like «Заметки»; nothing at all while the
// fan deleted nothing. A deletion still fresh (the last hour, not yet seen here) fills the count in the accent until the
// card is opened. It disables nothing.
//
// The card lists the deleted messages, the latest first, each as the fan's bubble with when it was sent and how soon it
// went, under one line for the chatter: the fan does not know, so neither quote nor hint. It opens on hover (after a short
// pause, kept while the pointer is over the mark or the card), on keyboard focus, and pinned by a click (a second click,
// Esc or a press elsewhere puts it away). A manual popover like the marks' (FanMarks.tsx): the top layer escapes the
// slot's `contain: layout` and the header's clipping; without popover support it stands `position: fixed`.
import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { DeletedMessageView, DeletedMessagesClient, DeletedMessagesCopy, DeletedMessagesView } from '@cg/contracts/deleted-fansly';

import { Icon, useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

/** The pause before a hover opens the card, and before leaving both the mark and its card puts it away. */
export const DELETED_HOVER = { openMs: 300, closeMs: 250 } as const;
const GAP_PX = 6;
const EDGE_PX = 8;

function useView(client: DeletedMessagesClient): DeletedMessagesView {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

function Message({ message, copy, now }: { readonly message: DeletedMessageView; readonly copy: DeletedMessagesCopy; readonly now: number }): JSX.Element {
  const text = message.text?.trim() ?? null;
  const empty = text === null || text === '';
  return (
    <li class="cg-dm__item" data-deleted-message={message.id} data-fresh={message.fresh ? 'true' : 'false'}>
      <div class="cg-dm__bubble">
        {empty ? (
          <p class="cg-dm__text cg-dm__text--none">
            {text !== null && message.attachments > 0 ? <Icon name="media" size={12} /> : null}
            <span>{text === null ? copy.notKept : message.attachments > 0 ? copy.attachments(message.attachments) : copy.noText}</span>
          </p>
        ) : (
          <p class="cg-dm__text">{text}</p>
        )}
        {!empty && message.attachments > 0 ? (
          <p class="cg-dm__att">
            <Icon name="media" size={12} />
            <span>{copy.attachments(message.attachments)}</span>
          </p>
        ) : null}
      </div>
      <p class="cg-dm__meta cg-num">
        {message.fresh ? <span class="cg-dm__fresh">{copy.fresh}</span> : null}
        <span>{copy.meta(message.sentAt, message.deletedAt, now)}</span>
      </p>
    </li>
  );
}

export function deletedMessagesSurface(client: DeletedMessagesClient, texts: Readonly<Record<'ru' | 'en', DeletedMessagesCopy>>): SurfaceDefinition {
  function DeletedMessages(): JSX.Element | null {
    const copy = texts[useI18n().language];
    const now = useNowFn();
    const view = useView(client);
    const id = useId();
    const [open, setOpen] = useState<{ readonly pinned: boolean } | null>(null);
    const root = useRef<HTMLSpanElement>(null);
    const mark = useRef<HTMLButtonElement>(null);
    const card = useRef<HTMLDivElement>(null);
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
    const shown = open !== null && view.total > 0;

    /** The open card showed a fresh message: once it is put away, what it showed is seen. */
    const sawFresh = useRef(false);
    useEffect(() => clear, []);
    // While open, its «новое» tags stay, so the chatter sees which ones came; the accent goes when it closes.
    useEffect(() => {
      if (shown && view.fresh > 0) sawFresh.current = true;
      else if (!shown && sawFresh.current) {
        sawFresh.current = false;
        client.seen();
      }
    }, [shown, view]);
    useLayoutEffect(() => {
      const bubble = card.current as PopoverElement | null;
      const anchor = mark.current;
      if (!shown || bubble === null || anchor === null) return;
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
        bubble.style.maxHeight = `${Math.max(160, Math.round(height - top - EDGE_PX))}px`;
        bubble.style.visibility = 'visible';
      };
      place();
      const win = bubble.ownerDocument.defaultView;
      win?.addEventListener('resize', place);
      return () => win?.removeEventListener('resize', place);
    }, [shown, view]);
    // A press anywhere else puts the card away. Our root is closed: from the page's document the press is on our host.
    useEffect(() => {
      if (!shown) return;
      const node = root.current;
      const host = node === null ? null : (node.getRootNode() as ShadowRoot).host;
      const doc = node?.ownerDocument;
      if (host === null || host === undefined || doc === undefined) return;
      const onPress = (event: PointerEvent): void => {
        if (!event.composedPath().includes(host)) setOpen(null);
      };
      // Passive, only while the card is out: it reads the path and never cancels the page's own press.
      doc.addEventListener('pointerdown', onPress, { capture: true, passive: true });
      return () => doc.removeEventListener('pointerdown', onPress, { capture: true });
    }, [shown]);

    if (view.total === 0) return null;

    const enter = (): void => {
      if (open !== null) return clear();
      later(DELETED_HOVER.openMs, () => setOpen({ pinned: false }));
    };
    const leave = (): void => {
      if (open === null) return clear();
      if (!open.pinned) later(DELETED_HOVER.closeMs, () => setOpen(null));
    };
    const press = (): void => {
      clear();
      setOpen(open?.pinned === true ? null : { pinned: true });
    };
    const escape = (event: TargetedKeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Escape' || !shown) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
      mark.current?.focus();
    };
    const title = copy.title(view.total);
    const more = view.total - view.messages.length;
    const at = now();

    return (
      <span class="cg-dm" ref={root} data-deleted-messages={String(view.total)} data-fresh={view.fresh > 0 ? 'true' : 'false'}>
        <span aria-hidden="true" class="cg-dm__divider">
          |
        </span>
        <button
          type="button"
          ref={mark}
          class="cg-dm__mark"
          aria-label={title}
          aria-expanded={shown ? 'true' : 'false'}
          aria-controls={shown ? `cg-dm-${id}` : undefined}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onClick={press}
          onFocus={(event) => {
            if (open === null && event.currentTarget.matches(':focus-visible')) setOpen({ pinned: false });
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (open !== null && !open.pinned && !(next !== null && card.current?.contains(next))) setOpen(null);
          }}
          onKeyDown={escape}
        >
          <Icon name="trash" size={13} />
          <span>{copy.mark}</span>
          <span class="cg-dm__count cg-num">{view.total}</span>
        </button>
        {!shown ? null : (
          <div
            ref={card}
            id={`cg-dm-${id}`}
            class="cg-dm__card"
            data-deleted-card=""
            role="dialog"
            aria-label={title}
            popover="manual"
            style={{ visibility: 'hidden' }}
            onPointerEnter={clear}
            onPointerLeave={leave}
            onKeyDown={escape}
          >
            <div class="cg-dm__head">
              <p class="cg-dm__title">{title}</p>
              <p class="cg-dm__hint">
                <Icon name="eyeOff" size={12} />
                <span>{copy.hint}</span>
              </p>
            </div>
            <ul class="cg-dm__list">
              {view.messages.map((message) => (
                <Message key={message.id} message={message} copy={copy} now={at} />
              ))}
            </ul>
            {more > 0 ? <p class="cg-dm__more">{copy.more(more)}</p> : null}
          </div>
        )}
      </span>
    );
  }
  return {
    view: DeletedMessages,
    styles: [
      {
        id: 'cg-deleted-messages',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-dm { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; }
    .cg-dm__divider { margin: 0 2px; }
    .cg-dm__mark { all: unset; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; border-radius: 6px; color: var(--cg-ink-2); font-weight: 500; }
    .cg-dm__mark:hover, .cg-dm__mark[aria-expanded='true'] { color: var(--cg-accent); }
    .cg-dm__mark:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
    .cg-dm__mark svg { flex: none; }
    .cg-dm__count {
      min-width: 14px; height: 14px; padding: 0 4px; box-sizing: border-box; border-radius: var(--cg-r-pill);
      background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2);
      font-size: 10px; line-height: 14px; font-weight: 600; text-align: center;
    }
    .cg-dm[data-fresh='true'] .cg-dm__mark { color: var(--cg-accent); }
    .cg-dm[data-fresh='true'] .cg-dm__count { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); animation: cg-dm-pulse 1.4s var(--cg-ease) 2; }
    @keyframes cg-dm-pulse { 0%, 100% { box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 0 0 0 var(--cg-focus-soft); } 50% { box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 0 0 4px var(--cg-focus-soft); } }
    @media (prefers-reduced-motion: reduce) { .cg-dm[data-fresh='true'] .cg-dm__count { animation: none; } }
    .cg-dm__card {
      position: fixed; z-index: 970; inset: auto; top: 0; left: 0; margin: 0; border: 0; box-sizing: border-box;
      width: min(340px, calc(100vw - 16px)); overflow: auto; overscroll-behavior: contain; padding: 12px;
      border-radius: var(--cg-r-lg); background: var(--cg-raised); color: var(--cg-ink);
      box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
      font-family: var(--cg-font); font-size: var(--cg-text-sm); line-height: 17px; font-weight: 400; white-space: normal; text-align: left;
    }
    .cg-dm__card p { margin: 0; }
    .cg-dm__head { display: flex; flex-direction: column; gap: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--cg-rule-2); }
    .cg-dm__title { color: var(--cg-ink-strong); font-weight: 600; }
    .cg-dm__hint { display: flex; align-items: flex-start; gap: 6px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
    .cg-dm__hint svg { flex: none; margin-top: 1px; }
    .cg-dm__list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .cg-dm__item { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .cg-dm__bubble {
      max-width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 12px 12px 12px 4px;
      background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
    }
    .cg-dm__item[data-fresh='true'] .cg-dm__bubble { box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
    .cg-dm__text { color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
    .cg-dm__text--none { display: flex; align-items: center; gap: 5px; color: var(--cg-ink-muted); font-style: italic; }
    .cg-dm__att { display: flex; align-items: center; gap: 5px; margin-top: 3px !important; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
    .cg-dm__text--none svg, .cg-dm__att svg { flex: none; }
    .cg-dm__meta { display: flex; align-items: center; gap: 6px; padding-left: 4px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
    .cg-dm__fresh { padding: 0 6px; border-radius: var(--cg-r-pill); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; line-height: 15px; }
    .cg-dm__more { margin-top: 10px !important; padding-top: 8px; border-top: 1px solid var(--cg-rule-2); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
  `,
      },
    ],
  };
}
