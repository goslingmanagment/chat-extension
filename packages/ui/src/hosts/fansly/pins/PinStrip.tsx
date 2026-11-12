// The strip of temporary chat pins over Fansly's own list of chats (2026-11-12; contracts fansly-pins.ts): one row of
// chips between Fansly's filter chips and the list, in the list column's own margins, on the page's own colours (its
// CSS variables reach into our closed root), so it reads as a part of Fansly's list in both of its themes.
//
// - The strip's box animates its height alone, to a constant target (0 ↔ 44 px; no layout is read), and clips what it
//   holds. The controller decides when that height may change (never while the pointer is over the list) and which
//   chips stand (frozen while the pointer or the focus is in the strip); this component only draws it.
// - A chip: the fan's initial in a circle of the chat's own hue, the name, the terracotta dot of a fan who has the last
//   word (a 300 ms fade, nothing blinks), the open chat's chip lit. Chips shrink as a browser's tabs do: the names give
//   way first; when a chip would show only two or three letters, every chip stands as its circle alone with a faint ×
//   (the name in the title), never below 56 px (the circle and the × zone, always reserved, so a hover moves nothing);
//   past that the row scrolls sideways without a scrollbar. The × shows on hover or focus.
// - A chip that comes in grows into its place and fades in; one taken off while the strip is held is an inert,
//   invisible placeholder of its own width; its place closes once the hold ends. While a chip grows in or closes, no
//   chip takes a click. CSS transitions only; reduced motion: none (the kit's base sheet).
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { FANSLY_PIN_GLYPH, FANSLY_WAITING_DOT_COLOR } from '@cg/contracts/fansly-pin-glyph';
import { FANSLY_PIN_LIMITS, type FanslyPinChip, type FanslyPinsClient, type FanslyPinsCopy, type FanslyPinsView } from '@cg/contracts/fansly-pins';

import { useI18n, type SurfaceDefinition } from '../../../kit';

export function PinGlyph({ size, filled, stroke = 1.8 }: { readonly size: number; readonly filled: boolean; readonly stroke?: number }): JSX.Element {
  return (
    <svg viewBox={FANSLY_PIN_GLYPH.viewBox} width={size} height={size} aria-hidden="true" class="cg-pin-glyph">
      <path d={FANSLY_PIN_GLYPH.needle} fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" />
      <path d={FANSLY_PIN_GLYPH.head} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function CloseGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

export function useClientView<V>(client: { view(): V; subscribe(listener: (view: V) => void): () => void }): V {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

function Chip({ chip, client, copy }: { readonly chip: FanslyPinChip; readonly client: FanslyPinsClient; readonly copy: FanslyPinsCopy }): JSX.Element {
  const inert = chip.state === 'tombstone' || chip.state === 'closing';
  const title = copy.chipTitle(chip.name, chip.username);
  return (
    <div class="cg-pin" data-state={chip.state} data-open={chip.open ? 'true' : undefined} data-pin-group={chip.groupId} style={`--cg-pin-hue:${chip.hue}`} aria-hidden={inert ? 'true' : undefined}>
      <button
        type="button"
        class="cg-pin__open"
        title={title}
        aria-current={chip.open ? 'true' : undefined}
        tabIndex={inert ? -1 : 0}
        // The press keeps the focus where it was (the composer): the chat opens on the click.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!inert) client.open(chip.groupId);
        }}
      >
        <span class="cg-pin__face" aria-hidden="true">
          {chip.initial}
          <i class="cg-pin__dot" data-on={chip.waiting ? 'true' : 'false'} />
        </span>
        <span class="cg-pin__name">{chip.name}</span>
      </button>
      <button
        type="button"
        class="cg-pin__x"
        title={copy.unpin}
        aria-label={`${copy.unpin}: ${chip.name}`}
        tabIndex={inert ? -1 : 0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!inert) client.unpin(chip.groupId);
        }}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}

/**
 * Below this a chip would show fewer than three letters of a name and its «…»: the strip shows the circles alone (the
 * name in the title). Fansly's column (482 px) holds four chips with names, five and six as circles.
 */
const NAME_MIN_CHIP_PX = 88;
/** The strip's own glyph and its margin, and the gap between two chips. */
const GLYPH_PX = 26;
const GAP_PX = 6;

/**
 * Whether the chips stand as circles alone: the row's width (its own size, watched, never read while anything moves)
 * shared by the chips leaves a chip too narrow for a name. Changes only with the chips' count or the column's width.
 */
function useCompact(count: number): { readonly ref: { current: HTMLDivElement | null }; readonly on: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    const View = node?.ownerDocument.defaultView;
    if (node === null || View === null || View === undefined || typeof View.ResizeObserver !== 'function') return undefined;
    const observer = new View.ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, on: width > 0 && count > 0 && (width - GLYPH_PX - (count - 1) * GAP_PX) / count < NAME_MIN_CHIP_PX };
}

/** Two frames: the strip's first height is painted before it moves (a strip placed before Fansly's rows needs no motion). */
function useArrived(instant: boolean): boolean {
  const [arrived, setArrived] = useState(instant);
  useEffect(() => {
    if (arrived) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return arrived;
}

export function pinStripSurface(client: FanslyPinsClient, texts: Readonly<Record<'ru' | 'en', FanslyPinsCopy>>, instant: () => boolean): SurfaceDefinition {
  function PinStrip(): JSX.Element {
    const i18n = useI18n();
    const copy = texts[i18n.language];
    const view: FanslyPinsView = useClientView(client);
    const arrived = useArrived(instant());
    const height = arrived ? view.height : 0;
    const box = useRef<HTMLDivElement>(null);
    // Closing chips count until they are gone: names come back only once their places are free.
    const compact = useCompact(view.chips.length);
    const moving = view.chips.some((chip) => chip.state === 'in' || chip.state === 'closing');
    // The pointer or the focus inside: the controller holds the strip's layout until both left.
    const pointer = useRef(false);
    const focus = useRef(false);
    const say = (): void => client.hold(pointer.current || focus.current);
    useEffect(() => () => client.hold(false), []);
    return (
      <div
        ref={box}
        class="cg-pins"
        role="toolbar"
        aria-label={copy.strip}
        data-height={String(height)}
        style={`height:${height}px`}
        onPointerEnter={() => {
          pointer.current = true;
          say();
        }}
        onPointerLeave={() => {
          pointer.current = false;
          say();
        }}
        onFocusIn={() => {
          focus.current = true;
          say();
        }}
        onFocusOut={(event) => {
          focus.current = box.current?.contains(event.relatedTarget as Node | null) === true;
          say();
        }}
      >
        <div class="cg-pins__row" ref={compact.ref} data-compact={compact.on ? 'true' : undefined} data-moving={moving ? 'true' : undefined}>
          <span class="cg-pins__glyph" aria-hidden="true">
            <PinGlyph size={14} filled={false} />
          </span>
          {view.chips.map((chip) => (
            <Chip key={chip.groupId} chip={chip} client={client} copy={copy} />
          ))}
        </div>
      </div>
    );
  }
  return { view: PinStrip, styles: [{ id: 'cg-pin-strip', css: PIN_STRIP_CSS }] };
}

const STRIP_PX = FANSLY_PIN_LIMITS.stripPx;
const CHIP_PX = 30;

const PIN_STRIP_CSS = `
:host { display: block; }
.cg-root[data-cg-surface='inbox-slot'] { container-type: normal; font-size: 13px; line-height: 16px; color: var(--font-1, #d6dce8); }
.cg-pins { position: relative; overflow: hidden; height: 0; transition: height 200ms cubic-bezier(.2, 0, 0, 1); }
.cg-pins[data-height='0'] { transition-duration: 160ms; }
.cg-pins__row {
  ${'' /* The chips stand in the middle of the strip, as much room over them as under them, whatever the page leaves
  under its own chips (Fansly's 1em, none with FBuddy). */}
  display: flex; align-items: center; gap: ${GAP_PX}px; height: ${STRIP_PX}px; padding: 0 4px 0 6px; box-sizing: border-box;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain;
}
.cg-pins__row::-webkit-scrollbar { display: none; }
${'' /* While a chip grows in or its place closes, its neighbours move: no chip takes a click then. */}
.cg-pins__row[data-moving] .cg-pin { pointer-events: none; }
.cg-pins__glyph { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: ${CHIP_PX}px; margin-right: 2px; color: var(--font-tint-3, #9da2ad); opacity: .75; }
.cg-pin-glyph { display: block; flex: none; }
.cg-pin {
  position: relative; flex: 0 1 auto; display: flex; align-items: center; min-width: 56px; max-width: 184px; height: ${CHIP_PX}px; box-sizing: border-box;
  border-radius: ${CHIP_PX / 2}px; background: var(--dark-3, #1a1e26); box-shadow: inset 0 0 0 1px var(--border-color, rgba(255,255,255,.06));
  transition: background-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, max-width 160ms cubic-bezier(.2, 0, 0, 1), min-width 160ms cubic-bezier(.2, 0, 0, 1), margin 160ms cubic-bezier(.2, 0, 0, 1);
}
.cg-pin:hover { background: color-mix(in srgb, var(--font-1, #d6dce8) 7%, var(--dark-3, #1a1e26)); }
.cg-pin[data-open='true'] { background: color-mix(in srgb, var(--blue-1, #2699f7) 16%, var(--dark-3, #1a1e26)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--blue-1, #2699f7) 55%, transparent); }
${'' /* A chip grows in from no width at all: its minimum too, or it would jump to 56 px at once. */}
.cg-pin[data-state='in'] { animation: cg-pin-in 160ms cubic-bezier(.2, 0, 0, 1); }
@keyframes cg-pin-in { from { max-width: 0; min-width: 0; opacity: 0; } }
.cg-pin[data-state='tombstone'], .cg-pin[data-state='closing'] { opacity: 0; pointer-events: none; }
.cg-pin[data-state='closing'] { max-width: 0; min-width: 0; margin-right: -${GAP_PX}px; transition-delay: 0ms, 0ms, 0ms, 120ms, 120ms, 120ms; overflow: hidden; }
.cg-pin__open {
  flex: 1 1 auto; display: flex; align-items: center; gap: 6px; min-width: 0; height: ${CHIP_PX}px; padding: 0 0 0 3px; border-radius: ${CHIP_PX / 2}px 0 0 ${CHIP_PX / 2}px;
  color: var(--font-1, #d6dce8); cursor: pointer;
}
.cg-pin[data-open='true'] .cg-pin__open { cursor: default; }
.cg-pin__face {
  position: relative; flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: hsl(var(--cg-pin-hue) 32% 42%); color: #fff; font-size: 11px; font-weight: 600; line-height: 1; letter-spacing: 0;
}
.cg-pin__dot {
  position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; background: ${FANSLY_WAITING_DOT_COLOR};
  box-shadow: 0 0 0 2px var(--dark-1, #111215); opacity: 0; transition: opacity 300ms ease;
}
.cg-pin__dot[data-on='true'] { opacity: 1; }
.cg-pin__name { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; line-height: 16px; font-weight: 500; }
.cg-pins__row[data-compact] .cg-pin__name { display: none; }
.cg-pins__row[data-compact] .cg-pin__open { flex: 0 0 34px; justify-content: center; padding: 0; }
.cg-pin__x {
  flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: ${CHIP_PX}px; padding: 0 4px 0 0; border-radius: 0 ${CHIP_PX / 2}px ${CHIP_PX / 2}px 0;
  color: var(--font-tint-3, #9da2ad); opacity: 0; transition: opacity 100ms ease, color 100ms ease;
}
${'' /* Circles alone: the × stands faint at rest, so the pill reads «(J) ×», not a pill with an empty half. */}
.cg-pins__row[data-compact] .cg-pin__x { opacity: .4; }
.cg-pins__row .cg-pin:hover .cg-pin__x, .cg-pins__row .cg-pin:focus-within .cg-pin__x { opacity: 1; }
.cg-pin__x:hover { color: var(--font-1, #d6dce8); }
.cg-pin__x svg { display: block; padding: 3px; box-sizing: content-box; border-radius: 50%; transition: background-color 100ms ease; }
.cg-pin__x:hover svg { background: color-mix(in srgb, var(--font-1, #d6dce8) 14%, transparent); }
.cg-root .cg-pin :focus-visible { outline: 2px solid var(--blue-1, #2699f7); outline-offset: -2px; border-radius: ${CHIP_PX / 2}px; }
`;
