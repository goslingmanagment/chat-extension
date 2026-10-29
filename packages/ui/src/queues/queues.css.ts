// The look of «Очереди» (2026-10-29, the owner's prototype): «Онлайн»'s window and card as they are, and what the window
// adds in the family's tokens: the queues' chips under the head (the chosen one in clay, «постоянная», «только моя»,
// «пауза», a day's portion done in green), the line of the goal and who is in the queue, the foot's day and
// «Отправить всем». Green is only presence, answers and a portion done; blue only «Отправить».
// A note here is a JS comment: a CSS one would ship in the window's chunk, prose for nobody.

import { type StyleSource } from '../kit';

export const QUEUES_CSS = `
.qu .cg-nw__title { display: flex; align-items: center; gap: 10px; }
.qu .cg-nw__title::before {
  content: ""; flex: none; width: 18px; height: 18px; margin-top: 2px; background: var(--cg-clay);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M6.2 4.2h7.6M6.2 8h7.6M6.2 11.8h7.6'/%3E%3Ccircle cx='2.9' cy='4.2' r='1.1' fill='black' stroke='none'/%3E%3Ccircle cx='2.9' cy='8' r='.75'/%3E%3Ccircle cx='2.9' cy='11.8' r='.75'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M6.2 4.2h7.6M6.2 8h7.6M6.2 11.8h7.6'/%3E%3Ccircle cx='2.9' cy='4.2' r='1.1' fill='black' stroke='none'/%3E%3Ccircle cx='2.9' cy='8' r='.75'/%3E%3Ccircle cx='2.9' cy='11.8' r='.75'/%3E%3C/svg%3E") center / contain no-repeat;
}
.qu .ol-why .cg-ico { color: var(--cg-clay-ink); }

${/* The page's queues: a row of chips, a second row when there are many (none is hidden). */ ''}
.qu-chips { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 22px; border-bottom: 1px solid var(--cg-rule); }
.qu-chip {
  flex: none; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border: 0; border-radius: var(--cg-r-pill);
  background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); font: inherit; font-size: var(--cg-text-md); white-space: nowrap; cursor: pointer;
}
.qu-chip:hover { background: var(--cg-hover); }
.qu-chip:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.qu-chip.is-on { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.qu-chip.is-on .qu-chip__name { font-weight: 600; }
.qu-chip__n { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.qu-chip.is-on .qu-chip__n { color: var(--cg-clay-ink); }
.qu-chip__n.is-done, .qu-chip.is-on .qu-chip__n.is-done { color: var(--cg-good-ink); font-weight: 600; }
.qu-chip__tag { padding: 1px 7px; border-radius: var(--cg-r-pill); background: var(--cg-chip); font-size: var(--cg-text-2xs); line-height: 16px; color: var(--cg-ink-muted); }
.qu-chip__tag.is-paused { background: var(--cg-amber-bg); color: var(--cg-amber-ink); }
.qu-chip__tag.is-mine { background: var(--cg-good-bg); color: var(--cg-good-ink); }
.qu-chip.is-paused .qu-chip__name { color: var(--cg-ink-muted); }

${/* «Пропустить ▾» opens upward over the conversation: the text's zone does not cut it while it is open. */ ''}
.qu .cg-ow__dzone:has(.cg-menu) { overflow: visible; }

${/* The chosen queue: its goal and who is in it on the left, how it writes and who asked on the right. */ ''}
.qu-line { flex: none; display: flex; align-items: flex-start; gap: 24px; padding: 8px 22px 9px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.qu-line__l { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qu-line__goal { color: var(--cg-ink-2); }
.qu-line__goal b, .qu-line__who b { color: var(--cg-ink-strong); font-weight: 600; }
.qu-line__who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qu-line__r { flex: none; display: flex; flex-direction: column; gap: 2px; align-items: flex-end; text-align: right; white-space: nowrap; }
.qu-line__r > :first-child { color: var(--cg-ink-2); }

${/* The list and its foot. */ ''}
.qu .cg-ow__group > span { color: var(--cg-ink-muted); }
.qu .ol-empty { display: flex; align-items: center; justify-content: center; gap: 6px; }
.qu-day { flex-wrap: nowrap; }
.qu-day__rest { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cg-ink-muted); }
.qu-hint { flex: 1; min-width: 0; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qu .qu-all { flex: none; }
.qu-me { color: var(--cg-ink-muted); }
`;

export const QUEUES_STYLES: StyleSource = { id: 'cg-queues', css: QUEUES_CSS };
