// The stage line of a running generation (ui-design §4.4; architecture.md
// §7): stages already passed — muted with a check and without «…», the
// current one — strong with «…», future ones are not shown; on a narrow dock
// only the current one. The m:ss timer counts from the click
// (ResultVM.startedAt). The one transparent retry after a 503 replaces the
// stages with «Сервис недоступен, повтор через 5 с…» counting to `retryAt`.

import { type JSX } from 'preact';

import { type PhaseVM } from '@cg/contracts/vm';

import { useHints, useI18n, useNowFn } from '../context';
import { useCountdown } from '../clock';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';
import { ElapsedTimer } from './Values';

const ELLIPSIS = /\s*(…|\.\.\.)\s*$/;

export function StageLine({ phase, startedAt }: { readonly phase: PhaseVM; readonly startedAt: number }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const now = useNowFn();
  const remaining = useCountdown(phase.retryAt, now);
  const timerTip = useTooltip(hints ? i18n.t('result.timerTooltip') : null);
  const retrying = phase.retryAt !== null && remaining > 0;
  return (
    <>
      <span class="cg-stages">
        {retrying ? (
          <span class="cg-stage is-now">{i18n.t('result.stage.retry503', { n: Math.ceil(remaining / 1000) })}</span>
        ) : (
          phase.stages.map((stage) =>
            stage.state === 'current' ? (
              <span key={stage.id} class="cg-stage is-now" data-cg-stage={stage.id}>
                {i18n.text(stage.label)}
              </span>
            ) : (
              <span key={stage.id} class="cg-stage" data-cg-stage={stage.id}>
                <Icon name="check" size={12} />
                {i18n.text(stage.label).replace(ELLIPSIS, '')}
              </span>
            ),
          )
        )}
      </span>
      <span class="cg-timer" {...timerTip.props}>
        <ElapsedTimer since={startedAt} />
      </span>
      {timerTip.description}
    </>
  );
}

export const STAGE_CSS = `
.cg-stages { display: flex; align-items: center; gap: 12px; min-width: 0; overflow: hidden; font-size: var(--cg-text-sm); line-height: 18px; white-space: nowrap; }
.cg-stage { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); }
.cg-stage.is-now { color: var(--cg-ink-strong); font-weight: 500; }
.cg-timer { font-family: var(--cg-mono); font-size: var(--cg-text-xs); color: var(--cg-ink-2); font-variant-numeric: tabular-nums; padding: 0 6px; white-space: nowrap; }
@container cg (max-width: 600px) { .cg-stage:not(.is-now) { display: none; } }
`;
