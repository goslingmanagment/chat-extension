// Our errors (ui-design §1 п. 10, §4.8, §4.10, §4.3; architecture.md §9.5;
// ER-005…ER-007, ER-011): the first line of every error is
// «ChatGoose · CG-…», so it is clear whose error it is. The card: a red dot
// for a failed operation, a ring for a state; title, explanation, the
// technical line (≤ 400 characters, monospace) and the recovery actions. A
// retry deadline is fixed once (`retryAt`) and counted from it; «Повторить»
// stays off until then and is only ever pressed by a person. The banner is
// the one-line status row of the dock.

import { type ComponentChildren, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { type CgErrorView } from '@cg/contracts/errors';
import { type ActionButtonVM } from '@cg/contracts/vm';

import { useAnnounce, useI18n, useKit } from '../context';
import { ActionButton, Button } from './Button';
import { Dot } from './Indicators';
import { useCountdownText } from './Values';

export type ErrorTone = 'failure' | 'state';

/**
 * The technical line's limit, the contract's CG_DETAIL_MAX_CHARS (pinned by a
 * test): read from there it would carry the error schemas, and zod with them,
 * into the first dock chunk (§11).
 */
export const DETAIL_MAX_CHARS = 400;

/** «ChatGoose · CG-QUOTA-DAILY». */
export function CodeLine({ code, dot, class: extra }: { readonly code: string; readonly dot?: 'danger' | 'ring' | null; readonly class?: string }): JSX.Element {
  const i18n = useI18n();
  return (
    <span class={`cg-codeline${extra === undefined ? '' : ` ${extra}`}`}>
      {dot === null || dot === undefined ? null : <Dot kind={dot} />}
      {i18n.t('common.errorSource', { code })}
    </span>
  );
}

/** «Скопировать код» through ClipboardPort; says «Скопировано» for 2 s. */
export function CopyCodeButton({ code }: { readonly code: string }): JSX.Element {
  const i18n = useI18n();
  const { deps, report, surface } = useKit();
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <Button
      label={copied ? i18n.t('common.copied') : i18n.t('common.copyCode')}
      variant="quiet"
      onClick={() => {
        // A port that rejects instead of answering {ok:false} is reported the same way, never left unhandled.
        void deps.clipboard.writeText(code).then(
          (result) => {
            if (result.ok) {
              setCopied(true);
              announce(i18n.t('common.copied'));
            } else {
              report({ kind: 'clipboard', surface, code: result.code, name: 'ClipboardError' });
            }
          },
          (error: unknown) => report({ kind: 'clipboard', surface, code: 'CG-CLIPBOARD', name: error instanceof Error ? error.name : typeof error }),
        );
      }}
    />
  );
}

/** The technical line as shown: nothing when empty, cut at DETAIL_MAX_CHARS with «…». */
export function technicalLine(detail: string | undefined): string | null {
  if (detail === undefined || detail.trim() === '') return null;
  return detail.length > DETAIL_MAX_CHARS ? `${detail.slice(0, DETAIL_MAX_CHARS - 1)}…` : detail;
}

export interface ErrorCardProps {
  readonly error: CgErrorView;
  /** Red dot — our operation failed; ring — a state, not a failure (ui-design §4.8). */
  readonly tone: ErrorTone;
  /** Recovery buttons the controller built from the registry entry. */
  readonly actions?: readonly ActionButtonVM[];
  /** Extra local buttons (the error boundary's «Перезагрузить панель»). */
  readonly children?: ComponentChildren;
  /** «Скопировать код» (default on; off where the clipboard itself failed). */
  readonly copyCode?: boolean;
  /**
   * How `retryAt` is shown: `reset` — «До обновления 17 ч 39 мин» (the quota);
   * `retry` — «через 24 с» next to «Повторить» kept off until then. Default by code.
   */
  readonly countdown?: 'reset' | 'retry' | 'none';
  /** Inside a part: no gutter, the dot inside the code line (§4.3). */
  readonly inline?: boolean;
  /** `role="alert"` when it appears (default on). */
  readonly alert?: boolean;
}

export function ErrorCard(props: ErrorCardProps): JSX.Element {
  const i18n = useI18n();
  const { error } = props;
  const countdownStyle = props.countdown ?? (error.code === 'CG-QUOTA-DAILY' ? 'reset' : 'retry');
  const retryAt = countdownStyle === 'none' ? null : (error.retryAt ?? null);
  const { text: left, remaining } = useCountdownText(retryAt);
  const waiting = retryAt !== null && remaining > 0;
  const tech = technicalLine(error.detail);
  const dot = props.tone === 'failure' ? 'danger' : 'ring';
  const actions = props.actions ?? [];
  // A «wait-until» button turns on by itself at the fixed deadline; the press stays the person's.
  const shown = actions.map((vm) => (vm.reason?.id === 'wait-until' && retryAt !== null && !waiting ? { ...vm, enabled: true, reason: null } : vm));
  const waitingRetry = waiting && countdownStyle === 'retry' && actions.some((vm) => vm.reason?.id === 'wait-until' || !vm.enabled);
  const body = (
    <>
      {props.inline === true ? <CodeLine code={error.code} dot={dot} class="cg-card__code" /> : <CodeLine code={error.code} class="cg-card__code" />}
      <div class="cg-card__title">{error.title}</div>
      <div class="cg-card__text">{error.body}</div>
      {tech === null ? null : <div class="cg-card__tech">{tech}</div>}
      <div class="cg-card__acts">
        {shown.map((vm, index) => (
          <ActionButton key={index} vm={vm} variant={index === 0 ? 'line' : 'plain'} />
        ))}
        {waitingRetry ? <span class="cg-count">{i18n.t('cg.retryIn', { n: Math.ceil(remaining / 1000) })}</span> : null}
        {waiting && countdownStyle === 'reset' ? <span class="cg-count">{i18n.t('cg.quotaDaily.countdown', { hms: left })}</span> : null}
        {props.children}
        {props.copyCode === false ? null : <CopyCodeButton code={error.code} />}
      </div>
    </>
  );
  const role = props.alert === false ? {} : { role: 'alert' as const };
  if (props.inline === true) {
    return (
      <div class="cg-card cg-card--inline" {...role} data-cg-code={error.code}>
        {body}
      </div>
    );
  }
  return (
    <div class="cg-card" {...role} data-cg-code={error.code}>
      <span class="cg-gut">
        <Dot kind={dot} />
      </span>
      <div class="cg-card__main">{body}</div>
    </div>
  );
}

export interface StatusBannerProps {
  readonly error: CgErrorView;
  /** Red for a failure (hub down), a ring for a state; null for none. */
  readonly dot: 'danger' | 'ring' | null;
  /** The one line button on the right. */
  readonly action?: ActionButtonVM | null;
  readonly children?: ComponentChildren;
}

/** The dock's status row (ui-design §4.10): code, **title.** explanation, one line button. */
export function StatusBanner(props: StatusBannerProps): JSX.Element {
  const { error } = props;
  const title = /[.!?…]$/.test(error.title) ? error.title : `${error.title}.`;
  return (
    <div class="cg-banner" role="status" data-cg-code={error.code}>
      <span class="cg-gut">{props.dot === null ? null : <Dot kind={props.dot} />}</span>
      <div class="cg-banner__text">
        <CodeLine code={error.code} class="cg-code" /> <b>{title}</b> {error.body}
      </div>
      {props.action === null || props.action === undefined ? null : <ActionButton vm={props.action} variant="line" />}
      {props.children}
    </div>
  );
}

export const ERROR_CSS = `
.cg-gut { width: calc(var(--cg-gutter) - 1px); flex: none; display: inline-flex; justify-content: center; align-items: center; color: var(--cg-ink-muted); }
.cg-codeline { display: inline-flex; align-items: center; gap: 6px; }
.cg-card { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 10px 10px 10px 0; font-size: var(--cg-text-base); line-height: 18px; }
.cg-card > .cg-gut { height: 18px; }
.cg-card__main { min-width: 0; }
.cg-card__code { display: flex; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0.01em; }
.cg-card__title { font-weight: 600; color: var(--cg-ink-strong); line-height: 20px; }
.cg-card__text { color: var(--cg-ink-2); margin-top: 1px; }
.cg-card__tech { margin-top: 6px; font-family: var(--cg-mono); font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-muted); overflow-wrap: anywhere; }
.cg-card__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 8px 0 0 -8px; }
.cg-card__acts:empty { display: none; }
.cg-card--inline { display: block; padding: 0; min-width: 0; }
.cg-count { color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; padding: 0 6px; white-space: nowrap; }
.cg-banner {
  display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) auto; align-items: center;
  min-height: 36px; padding: 6px 4px 6px 0; font-size: var(--cg-text-sm2); line-height: 18px;
}
.cg-banner > .cg-gut { align-self: start; height: 18px; }
.cg-banner__text { color: var(--cg-ink-2); min-width: 0; }
.cg-banner__text b { font-weight: 600; color: var(--cg-ink); }
.cg-banner__text .cg-code { margin-right: 6px; font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0.01em; white-space: nowrap; }
@container cg (max-width: 420px) {
  .cg-banner { grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); row-gap: 6px; }
  .cg-banner > .cg-btn { grid-column: 2; justify-self: start; margin-left: -8px; }
  .cg-banner__text .cg-code { display: flex; white-space: normal; }
}
`;
