// Our own icon set (ui-design §2.10): a 16 px grid, `currentColor` strokes of
// 1.6 with round caps and joins; the goose mark is one silhouette in the ink
// colour with the eye in the surface colour. Nothing from OnlyMonster.

import { type JSX } from 'preact';

const PATHS = {
  copy: (
    <>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6" />
      <path d="M10.5 5.5V4.2A1.2 1.2 0 0 0 9.3 3H4.2A1.2 1.2 0 0 0 3 4.2v5.1a1.2 1.2 0 0 0 1.2 1.2h1.3" />
    </>
  ),
  check: <path d="M3.2 8.4l3 2.9L12.8 4.8" />,
  /** Two checks: the fan read our message (the preview's feed). */
  checks: <path d="M1.4 8.6l2.8 2.7L10.4 5M7.6 11.1l.2.2L14.6 5" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.5 10.5l3 3" />
    </>
  ),
  expand: <path d="M9.5 3h3.5v3.5M13 3L8.8 7.2M6.5 13H3V9.5M3 13l4.2-4.2" />,
  collapse: <path d="M13 7H9.5V3.5M9.5 7L13.5 3M3 9h3.5v3.5M6.5 9l-4 4" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.3v3.4M8 5.2v.1" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2.5 8s2-3.8 5.5-3.8S13.5 8 13.5 8s-2 3.8-5.5 3.8S2.5 8 2.5 8z" />
      <circle cx="8" cy="8" r="1.7" />
      <path d="M3 13L13 3" />
    </>
  ),
  refresh: (
    <>
      <path d="M12.8 6.2A5 5 0 0 0 3.6 5.4M3.2 9.8a5 5 0 0 0 9.2.8" />
      <path d="M3.4 3v2.6H6M12.6 13v-2.6H10" />
    </>
  ),
  chevronDown: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  /** The previous fan of the Spenders preview (X65); its twin, the next one, is `chevronDown`. */
  chevronUp: <path d="M4.5 9.5L8 6l3.5 3.5" />,
  /** The Spenders statistics' rail («open») and its column's «collapse». */
  chevronLeft: <path d="M9.5 4.5L6 8l3.5 3.5" />,
  chevronRight: <path d="M6.5 4.5L10 8l-3.5 3.5" />,
  /** Review — the conversation's score: a gauge. */
  gauge: (
    <>
      <path d="M2.4 10.8a5.6 5.6 0 0 1 11.2 0" />
      <path d="M8 10.8l2.7-3.4M4.4 12.6h7.2" />
    </>
  ),
  /** 2026-10-27: how far back Coach reads — a bracket that reaches up the chat's lines. */
  depth: (
    <>
      <path d="M3 3.5v9M3 3.5h1.6M3 12.5h1.6" />
      <path d="M6.5 5h6.5M6.5 8h4.5M6.5 11h6" />
    </>
  ),
  /** Recap — the fan's dossier: a card with a face and lines. */
  dossier: (
    <>
      <rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.6" />
      <circle cx="5.9" cy="7.1" r="1.3" />
      <path d="M4 10.4c.4-.9 1-1.3 1.9-1.3s1.5.4 1.9 1.3M9.6 6.6h2.4M9.6 9.2h2.4" />
    </>
  ),
  /** Coach — advice about the fan: a light bulb. */
  bulb: (
    <>
      <path d="M8 2.2a4 4 0 0 0-2.5 7.1c.5.4.8 1 .8 1.6v.4h3.4v-.4c0-.6.3-1.2.8-1.6A4 4 0 0 0 8 2.2z" />
      <path d="M6.4 13.8h3.2" />
    </>
  ),
  /** Spenders (2026-10-27): a coin with the dollar, the old Fansly extension's «$». */
  coin: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M9.9 6.1c-.3-.6-1-1-1.9-1-1 0-1.8.5-1.8 1.3 0 1.8 3.8 1 3.8 3.1 0 .8-.8 1.4-2 1.4-.9 0-1.7-.4-2-1.1M8 4v1.1M8 10.9V12" />
    </>
  ),
  /** Media of the vault (X53): a picture in a frame. */
  media: (
    <>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.6" />
      <circle cx="5.8" cy="6.3" r="1.2" />
      <path d="M2.6 11.4l3.3-3 2.4 2.1 1.9-1.6 3.2 2.8" />
    </>
  ),
  /** A video's mark on a thumbnail. */
  play: <path d="M5.8 4.4v7.2L11.6 8z" />,
  /** «Новые» (2026-10-27): a fan with the spark of the new. */
  userNew: (
    <>
      <circle cx="6.4" cy="5.6" r="2.7" />
      <path d="M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1" />
      <path d="M12.6 1.4l.78 2.02 2.02.78-2.02.78-.78 2.02-.78-2.02-2.02-.78 2.02-.78z" fill="currentColor" stroke="none" />
    </>
  ),
  /** «Онлайн» (1.65.0; 2026-10-27 the fan of «Новые»): a fan with the dot of presence. */
  online: (
    <>
      <circle cx="6.4" cy="5.6" r="2.7" />
      <path d="M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1" />
      <circle cx="12.6" cy="4.3" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  /** Voice (1.47.0): a microphone on its stand. */
  mic: (
    <>
      <rect x="5.7" y="1.9" width="4.6" height="7.6" rx="2.3" />
      <path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.1M5.9 14.3h4.2" />
    </>
  ),
  /** A take that plays (1.47.0): «Пауза». */
  pause: <path d="M5.6 4.2v7.6M10.4 4.2v7.6" />,
  /** «Рассылка» (1.63.0): an envelope — its button in Spenders and its chip in the page's corner. */
  /** FBuddy's spending tier of a fan («Онлайн», 2026-10-28): a gem. */
  gem: (
    <>
      <path d="M4.3 2.6h7.4l2.8 3.6L8 13.6 1.5 6.2z" />
      <path d="M1.5 6.2h13M6.6 2.6L5.4 6.2 8 13.6l2.6-7.4-1.2-3.6" />
    </>
  ),
  /** Fansly's blue card «Recent Spender» («Онлайн», 2026-10-28): a bank card. */
  card: (
    <>
      <rect x="1.8" y="3.6" width="12.4" height="8.8" rx="1.6" />
      <path d="M1.8 6.6h12.4M4.4 9.9h2.6" />
    </>
  ),
  /** FBuddy's «Basic»: spent nothing anywhere — a banknote crossed. */
  noMoney: (
    <>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1.4" />
      <path d="M6.6 6.6l2.8 2.8M9.4 6.6L6.6 9.4" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="3.6" width="12" height="8.8" rx="1.6" />
      <path d="M2.6 4.6L8 8.6l5.4-4" />
    </>
  ),
  /** «Править» of a version (1.63.0): a pencil. */
  pencil: <path d="M10.6 2.9l2.5 2.5-7.3 7.3-3.1.6.6-3.1zM9.2 4.3l2.5 2.5" />,
  /** «Дальше: …» (1.63.0): an arrow to the right. */
  arrowRight: <path d="M3 8h9.6M8.9 4.3L12.6 8l-3.7 3.7" />,
  /** «Где показывать» of «Заметки» (2026-10-26): three dots, a menu of the panel's places. */
  more: (
    <>
      <circle cx="3.6" cy="8" r=".55" />
      <circle cx="8" cy="8" r=".55" />
      <circle cx="12.4" cy="8" r=".55" />
    </>
  ),
  /** «Удалить» of a note (2026-10-26): a bin. */
  trash: <path d="M2.8 4.4h10.4M6.2 4.4V3.2c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.2M4.3 4.4l.6 8.1c.1.6.5 1 1.1 1h4c.6 0 1-.4 1.1-1l.6-8.1M6.8 7v4M9.2 7v4" />,
  // 2026-10-28: the Recap window — its kicker, its facts and the sections of the hub's fan profile.
  /** Recap as a document: an open book. */
  book: <path d="M8 4.3C6.7 3.4 4.8 3 2.5 3.1v9.3c2.3-.1 4.2.3 5.5 1.2 1.3-.9 3.2-1.3 5.5-1.2V3.1C11.2 3 9.3 3.4 8 4.3zM8 4.3v9.2" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5.1v3.1l2.1 1.3" />
    </>
  ),
  /** Who reads the Recap: the features stacked on it. */
  layers: <path d="M8 2.6l5.6 2.8L8 8.2 2.4 5.4zM2.4 8.2L8 11l5.6-2.8M2.4 10.9L8 13.7l5.6-2.8" />,
  arrowUp: <path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />,
  /** A section the hub's format does not name: lines of text. */
  lines: <path d="M3 4.5h10M3 8h10M3 11.5h6.5" />,
  /** «Психологический портрет». */
  heart: <path d="M8 13.5S2.5 10.4 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4c0 4-5.5 7.1-5.5 7.1z" />,
  /** «Стадия и траектория». */
  trend: <path d="M2.5 12.5L6 8.5l2.6 2.2 4.9-6.2M10.4 4.5h3.1v3.1" />,
  /** «Как общается». */
  bubble: <path d="M2.5 4.2c0-.9.7-1.7 1.7-1.7h7.6c.9 0 1.7.8 1.7 1.7v4.6c0 .9-.8 1.7-1.7 1.7H7.3L4.6 13v-2.5h-.4c-1 0-1.7-.8-1.7-1.7z" />,
  /** «Деньги», «Траты». */
  cash: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.6" />
      <circle cx="8" cy="8" r="1.8" />
      <path d="M4 6.5v3M12 6.5v3" />
    </>
  ),
  /** «Незакрытое», «Открытые нити»: a ring left open. */
  loop: (
    <>
      <path d="M12.9 9.2A5 5 0 1 1 9.3 3.2" />
      <circle cx="12.3" cy="4.5" r="1.2" />
    </>
  ),
  /** «Стратегия». */
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="8" cy="8" r=".5" />
    </>
  ),
  /** «Кто». */
  person: (
    <>
      <circle cx="8" cy="5.6" r="2.7" />
      <path d="M2.8 13.6a5.2 5.2 0 0 1 10.4 0" />
    </>
  ),
  /** «Триггеры». */
  bolt: <path d="M8.6 1.8L3.8 9h3.6l-.6 5.2L12.2 7H8.4z" />,
  /** «Границы». */
  shield: <path d="M8 1.9l5 1.9v3.8c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5V3.8z" />,
  /** «Скачать лог» (2026-10-21): an arrow down into a tray. */
  download: (
    <>
      <path d="M8 2.6v7.2M4.9 6.9L8 10l3.1-3.1" />
      <path d="M2.8 10.6v1.6c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2v-1.6" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  readonly name: IconName;
  /** 16 (default), 14 (toasts, preview rows), 12–13 (stage line, «вставлено», lock). */
  readonly size?: 12 | 13 | 14 | 16;
  readonly class?: string;
}

export function Icon({ name, size = 16, class: extra }: IconProps): JSX.Element {
  return (
    <svg class={`cg-ico${extra === undefined ? '' : ` ${extra}`}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** The ChatGoose mark: 20 px in the dock, 22 in the popup, 24 in the settings. */
export function GooseMark({ size = 20, class: extra }: { readonly size?: 20 | 22 | 24; readonly class?: string }): JSX.Element {
  return (
    <svg class={`cg-goose${extra === undefined ? '' : ` ${extra}`}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M1.5 8.8C3 10.3 5.8 11.1 8.4 11.1C10 11.1 11.2 10.3 11.6 8.9C11.9 7.6 12 6.2 12.1 5C12.2 3.4 13.1 2.2 14.6 2.2C15.6 2.2 16.4 2.8 16.7 3.6L19 4.5L16.7 5.3C16.3 5.8 15.6 6 14.9 5.9C14.6 7.2 14.5 8.6 14.5 10C14.5 14.2 11.6 16.8 7.8 16.8C4.4 16.8 2 14.4 1.7 11.2Z" />
      <circle class="cg-goose__eye" cx="14.5" cy="3.6" r=".65" />
    </svg>
  );
}

/**
 * The Split / settings check box glyph: filled square with a check when on, an outline when off (§2.10); `mixed` —
 * filled with a dash (a column's «select all» over a list partly ticked).
 */
export function CheckGlyph({ on, mixed = false, size = 12 }: { readonly on: boolean; readonly mixed?: boolean; readonly size?: 12 | 14 }): JSX.Element {
  return (
    <svg class="cg-cb" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {on || mixed ? (
        <>
          <rect width="12" height="12" rx="3" fill="currentColor" />
          <path class="cg-cb__tick" d={mixed && !on ? 'M3.5 6h5' : 'M3.2 6.2l1.9 1.8 3.8-4'} fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </>
      ) : (
        <rect x=".7" y=".7" width="10.6" height="10.6" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      )}
    </svg>
  );
}

export const ICON_CSS = `
.cg-ico { flex: none; display: block; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.cg-goose { flex: none; display: block; fill: currentColor; }
.cg-goose .cg-goose__eye { fill: var(--cg-surface); }
.cg-cb { flex: none; display: block; }
.cg-cb__tick { stroke: var(--cg-surface); }
`;
