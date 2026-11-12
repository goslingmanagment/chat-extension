// The pin button of a row of Fansly's own list of chats (2026-11-12, temporary chat pins), drawn by inbox-marks.ts.
//
// A solid 28 px disc in the row's hover colour, with a soft halo of the same colour and a hairline ring, on the row's
// second line (the preview's): left of the unread badge when the row has one, else at the row's right edge, and never
// higher than the bottom of the row's time. It may cover the tail of the preview and nothing else of Fansly's: the
// time and the badge stay seen and a click on them still opens the chat. Its place is measured once each time it is
// shown (the badge against the row's box); its top is a distance from the row's top, so FBuddy's taller rows keep it on
// the second line. Only the disc takes the pointer, and only while it is shown.
//
// Its press keeps the focus where it was, its click goes no further than the disc (the row's link never hears it: no
// chat opens, nothing is marked read), only a person's click counts. A plain node with inline styles, as the marks.

import { FANSLY_PIN_GLYPH } from '@cg/contracts/fansly-pin-glyph';

export const ROW_BUTTON_KIND = 'row';
const PREVIEW = '.font-size-xs.eclipse';
const BADGES = '.badge-container';
const TIME = '.message-time';
const SIZE = 28;
/** Between the disc and the badge, and from the row's right edge when there is no badge (Fansly's `.5em`). */
const GAP_PX = 4;
const EDGE_PX = 8;

const DISC_STYLE = [
  'position:absolute',
  `width:${SIZE}px`,
  `height:${SIZE}px`,
  'right:8px',
  'top:30px',
  'box-sizing:border-box',
  'margin:0',
  'padding:0',
  'border:0',
  'border-radius:50%',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'cursor:pointer',
  'outline:none',
  'opacity:0',
  'pointer-events:none',
  'z-index:3',
  'transition:opacity 100ms ease,color 100ms ease,background-color 100ms ease',
  '-webkit-user-drag:none',
  'user-select:none',
  'box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--font-1,#d6dce8) 14%,transparent),0 0 3px 3px var(--dark-3,#1a1e26)',
].join(';');

const LOOK = {
  rest: { color: 'var(--font-tint-3,#9da2ad)', background: 'var(--dark-3,#1a1e26)' },
  over: { color: 'var(--font-1,#d6dce8)', background: 'color-mix(in srgb,var(--font-1,#d6dce8) 10%,var(--dark-3,#1a1e26))' },
  pinned: 'var(--blue-1,#2699f7)',
} as const;

const SVG = 'http://www.w3.org/2000/svg';

/** The pin glyph as plain nodes (no markup parsed): `filled` — a pinned chat's. */
export function pinGlyph(doc: Document, size: number, filled: boolean, stroke = 2): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', FANSLY_PIN_GLYPH.viewBox);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'display:block;pointer-events:none;flex:none');
  for (const d of [FANSLY_PIN_GLYPH.needle, FANSLY_PIN_GLYPH.head]) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', filled && d === FANSLY_PIN_GLYPH.head ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', String(stroke));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/** A style written only when it differs: the list's every change dresses its buttons again. */
const put = (element: HTMLElement, property: 'color' | 'backgroundColor' | 'opacity' | 'pointerEvents' | 'top' | 'right', value: string): void => {
  if (element.style[property] !== value) element.style[property] = value;
};

export interface RowButtonWords {
  readonly pinned: boolean;
  readonly label: string;
}

/** A row's disc: made once per row and chat, dressed after every change, shown and placed on a person's hover. */
export function makeRowButton(doc: Document, attribute: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.draggable = false;
  button.setAttribute(attribute, ROW_BUTTON_KIND);
  button.setAttribute('style', DISC_STYLE);
  // The focus stays where it was (the composer): no press of ours moves it, and no drag of the row starts here.
  const keep = (event: Event): void => {
    event.preventDefault();
  };
  button.addEventListener('pointerdown', keep);
  button.addEventListener('mousedown', keep);
  button.addEventListener('dragstart', keep);
  // The row's link never hears this click: no chat opens, nothing is marked read.
  button.addEventListener('auxclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.isTrusted && event.button === 0) onClick(button);
  });
  const hover = (over: boolean) => (): void => {
    button.dataset['over'] = over ? '1' : '';
    dressLook(button);
  };
  button.addEventListener('pointerenter', hover(true));
  button.addEventListener('pointerleave', hover(false));
  return button;
}

function dressLook(button: HTMLButtonElement): void {
  const pinned = button.getAttribute('aria-pressed') === 'true';
  const over = button.dataset['over'] === '1';
  put(button, 'color', pinned ? LOOK.pinned : over ? LOOK.over.color : LOOK.rest.color);
  put(button, 'backgroundColor', over ? LOOK.over.background : LOOK.rest.background);
}

/** Its glyph and words: pinned or not; the styles of the pointer on the disc itself. */
export function dressRowButton(doc: Document, button: HTMLButtonElement, words: RowButtonWords): void {
  if (button.getAttribute('aria-pressed') !== String(words.pinned)) {
    button.setAttribute('aria-pressed', String(words.pinned));
    button.replaceChildren(pinGlyph(doc, 16, words.pinned, 1.7));
  }
  if (button.getAttribute('aria-label') !== words.label) {
    button.setAttribute('aria-label', words.label);
    button.title = words.label;
  }
  dressLook(button);
}

/**
 * The disc's place in its row, read once as it is shown: on the second line, left of the badge (or at the right edge),
 * not above the bottom of the time's text, inside the row.
 */
export function placeRowButton(button: HTMLButtonElement, group: Element): void {
  const box = group.getBoundingClientRect();
  const line = group.querySelector(PREVIEW)?.parentElement ?? null;
  const lineBox = line?.getBoundingClientRect() ?? null;
  let top = lineBox === null || lineBox.height === 0 ? (box.height - SIZE) / 2 : lineBox.top + lineBox.height / 2 - box.top - SIZE / 2;
  // Never over the time: the disc starts under its box, so a click anywhere on the time still opens the chat.
  const time = group.querySelector(TIME)?.getBoundingClientRect() ?? null;
  if (time !== null && time.height > 0) top = Math.max(top, time.bottom - box.top + 1);
  top = Math.max(0, Math.min(top, box.height - SIZE - 1));
  const badges = group.querySelector(BADGES);
  const badgeBox = badges?.getBoundingClientRect() ?? null;
  const right = badgeBox !== null && badgeBox.width > 0 ? box.right - badgeBox.left + GAP_PX : EDGE_PX;
  put(button, 'top', `${Math.round(top)}px`);
  put(button, 'right', `${Math.round(right)}px`);
}

export function showRowButton(button: HTMLButtonElement, on: boolean): void {
  put(button, 'opacity', on ? '1' : '0');
  put(button, 'pointerEvents', on ? 'auto' : 'none');
}
