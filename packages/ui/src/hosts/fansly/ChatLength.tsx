// The chat's length in Fansly's own chat header (2026-11-08, the owner: «хочу еще видеть сколько было месаг с челом,
// аккуратный такой баджик… чтобы чаттеры видели как давно общение», then «покомпактнее бы… чтобы при наведении чето
// всплывало»): after «Регистрация», the speech bubble and how many messages the chat ever had, «428»; with no count (the
// hub cannot say it exactly), how long ago it began, «3 мес». In that row's size and ink like «Удалил».
//
// The card under it says it in full: how many, since when and how long that is, how often on average. It opens on
// hover (after a short pause, kept while the pointer is over the badge or the card), on keyboard focus, and pinned by a
// click (a second click, Esc or a press elsewhere puts it away). A manual popover like the marks' (FanMarks.tsx): the
// top layer escapes the slot's `contain: layout` and the header's clipping; without popover support it stands
// `position: fixed`.
import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { ChatLengthClient, ChatLengthCopy, ChatLengthView } from '@cg/contracts/deleted-fansly';

import { Icon, useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

/** The pause before a hover opens the card, and before leaving both the badge and its card puts it away. */
export const CHAT_LENGTH_HOVER = { openMs: 300, closeMs: 250 } as const;
const GAP_PX = 6;
const EDGE_PX = 8;

function useView(client: ChatLengthClient): ChatLengthView | null {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

export function chatLengthSurface(client: ChatLengthClient, texts: Readonly<Record<'ru' | 'en', ChatLengthCopy>>): SurfaceDefinition {
  function ChatLength(): JSX.Element | null {
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
    const shown = open !== null && view !== null;

    useEffect(() => clear, []);
    // Another chat (no badge until its read answers) takes the card along.
    useEffect(() => {
      if (view === null) setOpen(null);
    }, [view]);
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
        bubble.style.top = `${Math.round(at.bottom + GAP_PX)}px`;
        bubble.style.left = `${Math.round(Math.max(EDGE_PX, Math.min(at.left, width - own.width - EDGE_PX)))}px`;
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

    if (view === null) return null;

    const enter = (): void => {
      if (open !== null) return clear();
      later(CHAT_LENGTH_HOVER.openMs, () => setOpen({ pinned: false }));
    };
    const leave = (): void => {
      if (open === null) return clear();
      if (!open.pinned) later(CHAT_LENGTH_HOVER.closeMs, () => setOpen(null));
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
    const at = now();
    const title = copy.title(view.messages, view.since);
    const pace = view.messages === null ? null : copy.pace(view.messages, view.since, at);

    return (
      <span class="cg-cl" ref={root} data-chat-length={view.messages === null ? 'unknown' : String(view.messages)}>
        <span aria-hidden="true" class="cg-cl__divider">
          |
        </span>
        <button
          type="button"
          ref={mark}
          class="cg-cl__mark cg-num"
          aria-label={title}
          aria-expanded={shown ? 'true' : 'false'}
          aria-controls={shown ? `cg-cl-${id}` : undefined}
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
          <Icon name="bubble" size={13} />
          <span>{view.messages === null ? copy.age(view.since, at) : copy.count(view.messages)}</span>
        </button>
        {!shown ? null : (
          <div
            ref={card}
            id={`cg-cl-${id}`}
            class="cg-cl__card"
            data-chat-length-card=""
            role="dialog"
            aria-label={title}
            popover="manual"
            style={{ visibility: 'hidden' }}
            onPointerEnter={clear}
            onPointerLeave={leave}
            onKeyDown={escape}
          >
            <p class="cg-cl__head">
              <Icon name="bubble" size={14} />
              <span class="cg-num">{copy.heading(view.messages)}</span>
            </p>
            <p class="cg-cl__since cg-num">{copy.since(view.since, at)}</p>
            {pace === null ? null : <p class="cg-cl__pace cg-num">{pace}</p>}
            {view.messages === null ? <p class="cg-cl__unknown">{copy.unknown}</p> : null}
          </div>
        )}
      </span>
    );
  }
  return {
    view: ChatLength,
    styles: [
      {
        id: 'cg-chat-length',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-cl { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; }
    .cg-cl__divider { margin: 0 2px; }
    .cg-cl__mark { all: unset; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; border-radius: 6px; color: var(--cg-ink-2); font-weight: 500; font-variant-numeric: tabular-nums; }
    .cg-cl__mark:hover, .cg-cl__mark[aria-expanded='true'] { color: var(--cg-accent); }
    .cg-cl__mark:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
    .cg-cl__mark svg { flex: none; }
    .cg-cl__card {
      position: fixed; z-index: 970; inset: auto; top: 0; left: 0; margin: 0; border: 0; box-sizing: border-box;
      width: max-content; min-width: 200px; max-width: min(300px, calc(100vw - 16px)); padding: 10px 12px;
      border-radius: var(--cg-r-lg); background: var(--cg-raised); color: var(--cg-ink);
      box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
      font-family: var(--cg-font); font-size: var(--cg-text-sm); line-height: 17px; font-weight: 400; white-space: normal; text-align: left;
    }
    .cg-cl__card p { margin: 0; }
    .cg-cl__head { display: flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-size: 14px; line-height: 18px; font-weight: 600; }
    .cg-cl__head svg { flex: none; color: var(--cg-ink-muted); }
    .cg-cl__since { margin-top: 4px; color: var(--cg-ink-2); }
    .cg-cl__pace { margin-top: 2px; color: var(--cg-ink-muted); }
    .cg-cl__unknown { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--cg-rule-2); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
  `,
      },
    ],
  };
}
