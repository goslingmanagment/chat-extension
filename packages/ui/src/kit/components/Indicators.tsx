// Small indicators (ui-design §1 п. 4, §2.9, §4.8, §4.13): the 10 px inline
// spinner, the stream caret, status dots and the «Recap готов» badge. Blue
// appears only in the closed list of §1 п. 4: an accent dot must name its
// place (`use`), so a new blue spot is a type error, not a review finding.

import { type JSX } from 'preact';

export function Spinner({ label }: { readonly label?: string }): JSX.Element {
  return label === undefined ? <span class="cg-spin" aria-hidden="true" /> : <span class="cg-spin" role="img" aria-label={label} />;
}

/** The blinking caret after the streamed preview text (2 × 16 px). */
export function Caret(): JSX.Element {
  return <span class="cg-caret" aria-hidden="true" />;
}

/**
 * The only places the host's blue may mark a state (ui-design §1 п. 4, §11
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
 * - `accent`: blue, only for an AccentUse.
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

/** The 6 px «Recap готов» point at the top right of a strip button (§4.1). */
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
  display: inline-block; width: 2px; height: 16px; margin-left: 1px; vertical-align: -3px;
  background: var(--cg-ink); animation: cg-blink 1s steps(1) infinite;
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
.cg-badge { position: absolute; top: 4px; right: 1px; width: 6px; height: 6px; border-radius: var(--cg-r-pill); background: var(--cg-accent); }
@media (prefers-reduced-motion: reduce) {
  .cg-spin, .cg-caret, .cg-dot--pulse { animation: none; }
}
`;
