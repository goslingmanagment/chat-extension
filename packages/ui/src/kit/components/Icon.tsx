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
  /** Spenders: a banknote. */
  bill: (
    <>
      <rect x="1.8" y="4.2" width="12.4" height="7.6" rx="1.4" />
      <circle cx="8" cy="8" r="1.7" />
      <path d="M4.3 6.5v.01M11.7 9.5v.01" />
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
  /** «Новые»: a fan with a plus. */
  userPlus: (
    <>
      <circle cx="6.4" cy="5.6" r="2.6" />
      <path d="M2 13.2c.5-2.4 2.2-3.8 4.4-3.8s3.9 1.4 4.4 3.8M12.6 4.8v4.4M10.4 7h4.4" />
    </>
  ),
  /** «Онлайн» (1.65.0): a fan with the green dot of presence. */
  online: (
    <>
      <circle cx="6.4" cy="5.6" r="2.6" />
      <path d="M2 13.2c.5-2.4 2.2-3.8 4.4-3.8s3.9 1.4 4.4 3.8" />
      <circle cx="12.4" cy="5.8" r="1.7" fill="currentColor" stroke="none" />
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
