// «Статус» (ui-design §4.24, final-21a; ST-020…ST-038): the readiness line,
// «Проверить всё» and the report for the team lead, then one row per thing a
// shift depends on — a dot, the name, the value with its note, and the one
// button that leads to where it is fixed.

import { type JSX } from 'preact';

import { type StatusBodyVM, type StatusRowVM } from '@cg/contracts/vm';

import { Button, useI18n } from '../../kit';
import { LevelDot, useAct, useText } from '../shared';

function Row({ row }: { readonly row: StatusRowVM }): JSX.Element {
  const i18n = useI18n();
  const text = useText();
  const act = useAct();
  const action = row.action;
  const copies = action?.action.type === 'CopyReport';
  return (
    <div class="pg-row" data-pg-row={row.id} data-pg-anchor={row.id} data-pg-level={row.level}>
      <LevelDot level={row.level} />
      <span class="pg-row__k">{text(row.title)}</span>
      <span class="pg-row__v">
        {text(row.value)}
        {row.note === null ? null : <small>{text(row.note)}</small>}
      </span>
      <span class="pg-row__a">
        {action === null ? null : (
          <Button
            label={i18n.text(action.label)}
            variant="quiet"
            reason={action.enabled ? null : action.reason === null ? i18n.t('common.unknown') : i18n.text(action.reason.text)}
            onClick={() => void act(action.action, copies ? { success: i18n.t('common.copied') } : {})}
          />
        )}
      </span>
    </div>
  );
}

export function StatusSection({ body }: { readonly body: StatusBodyVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const { readiness } = body;
  const head = readiness.s === 'ready' ? i18n.t('settings.status.ready') : readiness.s === 'unknown' ? i18n.t('settings.status.unknown') : i18n.plural('settings.status.needActions', readiness.count);
  const warnings = readiness.s === 'unknown' ? [] : readiness.warnings;
  // «одно предупреждение: мало квоты AI» (ui-design §4.24); several — counted.
  const warningsText = warnings.map((warning) => i18n.text(warning)).join(', ');
  const warningsLine = warnings.length === 1 ? i18n.t('settings.status.warningOne', { text: warningsText }) : i18n.plural('settings.status.warnings', warnings.length, { text: warningsText });
  const recheck = body.recheck;
  const waiting = !recheck.enabled;
  return (
    <>
      <div class="pg-sum" data-pg-readiness={readiness.s}>
        <b>{head}</b>
        {warnings.length === 0 ? null : <span>{warningsLine}</span>}
        <span class="pg-acts">
          <Button
            label={i18n.text(recheck.label)}
            variant="line"
            icon="refresh"
            tooltip={i18n.t('settings.status.checkAllTooltip')}
            reason={waiting ? i18n.t('settings.status.checkAllTooltip') : null}
            onClick={() => void act(recheck.action)}
          />
          <Button label={i18n.text(body.copyReport.label)} variant="line" icon="copy" onClick={() => void act(body.copyReport.action, { success: i18n.t('common.copied') })} />
        </span>
      </div>
      {body.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
      <p class="pg-note">{i18n.text(body.note)}</p>
    </>
  );
}

/** The lead under the title: when the page last checked. */
export function statusLead(i18n: ReturnType<typeof useI18n>, body: StatusBodyVM | null): string {
  if (body === null || body.lastCheckedAt === null) return i18n.t('settings.status.leadPending');
  return i18n.t('settings.status.lead', { time: { time: body.lastCheckedAt } });
}
