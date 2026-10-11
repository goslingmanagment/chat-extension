// Small indicators (ui-design §1 п. 4, §2.9, §4.8, §4.13): the 10 px inline
// spinner, the stream caret, status dots and the «Recap готов» badge. The
// accent dot appears only in the closed list of §1 п. 4: it must name its
// place (`use`), so a new accent spot is a type error, not a review finding.

import { type JSX } from 'preact';

export function Spinner({ label }: { readonly label?: string }): JSX.Element {
  return label === undefined ? <span class="cg-spin" aria-hidden="true" /> : <span class="cg-spin" role="img" aria-label={label} />;
}

/** The blinking terracotta block after the streamed text (7 × 14 px): the family's «AI is typing». */
export function Caret(): JSX.Element {
  return <span class="cg-caret" aria-hidden="true" />;
}

/**
 * The only places the accent may mark a state as a dot (ui-design §1 п. 4, §11
 * п. 5): all are states of OUR result, never an attribute of a fan.
 */
export const ACCENT_USES = [
  /** «Фан написал новое» in the dock (final-3c). */
  'result-stale',
  /** «Фан написал новое после ответа» in the preview's archive line (final-11g). */
  'preview-fan-wrote',
  /** «Удержано: фан написал новое» in a send row (final-11g). */
  'send-held-stale',
  /** «архив отстаёт от чата» in Recap facts and the Coach freshness line (final-18b, final-17b). */
  'archive-lag',
  /** «Recap готов» on Recap or «Ещё» (final-1b). */
  'recap-ready',
] as const;
export type AccentUse = (typeof ACCENT_USES)[number];

/**
 * - `danger` red: our operation failed (always next to «ChatGoose · CG-…» or a refusal text);
 * - `ring`: a state, not a failure (quota 0, a lease, «queued»);
 * - `ink`: a neutral fact («Неизвестно, ушло ли»);
 * - `pulse`: «Принято ChatSpace, ждём подтверждения»;
 * - `accent`: the terracotta accent, only for an AccentUse.
 */
export type DotProps =
  | { readonly kind: 'danger' | 'ring' | 'ink' | 'pulse'; readonly size?: 6 | 7 }
  | { readonly kind: 'accent'; readonly use: AccentUse; readonly size?: 6 | 7 };

export function Dot(props: DotProps): JSX.Element {
  const size = props.size ?? 7;
  return (
    <span
      class={`cg-dot cg-dot--${props.kind}${size === 6 ? ' cg-dot--6' : ''}`}
      aria-hidden="true"
      {...(props.kind === 'accent' ? { 'data-accent-use': props.use } : {})}
    />
  );
}

/** The 7 px «Recap готов» point at the top right corner of a bar chip (§4.1, UI-010). */
export function ReadyBadge(): JSX.Element {
  return <span class="cg-badge" data-accent-use={'recap-ready' satisfies AccentUse} aria-hidden="true" />;
}

export const INDICATORS_CSS = `
.cg-spin {
  display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 99px;
  border: 1.5px solid var(--cg-rule-3); border-top-color: var(--cg-ink-2);
  animation: cg-rot 0.9s linear infinite;
}
@keyframes cg-rot { to { transform: rotate(360deg); } }
.cg-caret {
  display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: -2px;
  background: var(--cg-clay); animation: cg-blink 1s steps(1) infinite;
}
@keyframes cg-blink { 50% { opacity: 0; } }
.cg-dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: var(--cg-r-pill); }
.cg-dot--6 { width: 6px; height: 6px; }
.cg-dot--danger { background: var(--cg-danger); }
.cg-dot--accent { background: var(--cg-accent); }
.cg-dot--ink { background: var(--cg-ink-2); }
.cg-dot--ring { box-shadow: inset 0 0 0 1.5px var(--cg-ink-muted); }
.cg-dot--pulse { background: var(--cg-ink-muted); animation: cg-pulse 1.4s ease-in-out infinite; }
@keyframes cg-pulse { 50% { opacity: 0.25; } }
.cg-badge { position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: var(--cg-r-pill); background: var(--cg-accent); box-shadow: 0 0 0 2px var(--cg-raised); transition: opacity 120ms var(--cg-ease); }
@media (prefers-reduced-motion: reduce) {
  .cg-spin, .cg-caret, .cg-dot--pulse { animation: none; }
}
`;
