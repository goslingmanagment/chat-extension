// «Статус» (ui-design §4.24; ST-020…ST-038): the verdict first, on the
// brand's stage (X32) — the pond and its goslings when the shift can start,
// the gosling's yellow and the goose looking back when something waits —
// with «Проверить всё» and the report for the team lead; then, on one card,
// a row per thing a shift depends on: a dot, the name, the value with its
// note, and the one button that leads to where it is fixed.

import { type ComponentChildren, type JSX } from 'preact';

import { type StatusBodyVM, type StatusRowId, type StatusRowVM } from '@cg/contracts/vm';

import { Button, useI18n } from '../../kit';
import { LostArt, TrioArt } from '../brand/art';
import { Card, Columns, LevelDot, useAct, useText } from '../shared';

/** A row's own name in the page: its id, a site's row its site (one row per site, R20 F7). */
const rowKey = (row: StatusRowVM): string => row.host ?? row.id;

function Row({ row }: { readonly row: StatusRowVM }): JSX.Element {
  const i18n = useI18n();
  const text = useText();
  const act = useAct();
  const action = row.action;
  const copies = action?.action.type === 'CopyReport';
  return (
    <div class="pg-row" data-pg-row={rowKey(row)} data-pg-anchor={row.id} data-pg-level={row.level}>
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

/** What a shift stands on: the main column. */
const SHIFT_ROWS: ReadonlySet<StatusRowId> = new Set(['host', 'hub', 'account', 'binding', 'persona', 'quota']);
/** What the team lead asks for: the quiet column's first card. */
const SUPPORT_ROWS: ReadonlySet<StatusRowId> = new Set(['extension', 'last-error', 'support']);

export function StatusSection({ body, checklist }: { readonly body: StatusBodyVM; readonly checklist?: ComponentChildren }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const { readiness } = body;
  const head = readiness.s === 'ready' ? i18n.t('settings.status.ready') : readiness.s === 'unknown' ? i18n.t('settings.status.unknown') : i18n.plural('settings.status.needActions', readiness.count);
  const warnings = readiness.s === 'unknown' ? [] : readiness.warnings;
  // «одно предупреждение: мало квоты AI» (ui-design §4.24); several — counted.
  const warningsText = warnings.map((warning) => i18n.text(warning)).join(', ');
  const warningsLine = warnings.length === 1 ? i18n.t('settings.status.warningOne', { text: warningsText }) : i18n.plural('settings.status.warnings', warnings.length, { text: warningsText });
  const recheck = body.recheck;
  // A service row that needs the person joins the main column: what is wrong is never in the quiet one.
  const shift = body.rows.filter((row) => SHIFT_ROWS.has(row.id) || (!SUPPORT_ROWS.has(row.id) && (row.level === 'warn' || row.level === 'error')));
  const support = body.rows.filter((row) => SUPPORT_ROWS.has(row.id));
  const service = body.rows.filter((row) => !shift.includes(row) && !support.includes(row));
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
            class="pg-primary"
            icon="refresh"
            tooltip={i18n.t('settings.status.checkAllTooltip')}
            reason={waiting ? i18n.t('settings.status.checkAllTooltip') : null}
            onClick={() => void act(recheck.action)}
          />
          <Button label={i18n.text(body.copyReport.label)} variant="line" icon="copy" onClick={() => void act(body.copyReport.action, { success: i18n.t('common.copied') })} />
        </span>
        {readiness.s === 'ready' ? <TrioArt class="pg-art" /> : readiness.s === 'actions-needed' ? <LostArt class="pg-art pg-art--lost" /> : null}
      </div>
      {checklist}
      <Columns
        main={
          <section class="pg-card" aria-label={i18n.t('settings.section.status')}>
            {shift.map((row) => (
              <Row key={rowKey(row)} row={row} />
            ))}
          </section>
        }
        aside={
          <>
            <Card>
              {support.map((row) => (
                <Row key={rowKey(row)} row={row} />
              ))}
              <p class="pg-note">{i18n.text(body.note)}</p>
            </Card>
            {service.length === 0 ? null : (
              <section class="pg-card pg-card--rows">
                {service.map((row) => (
                  <Row key={rowKey(row)} row={row} />
                ))}
              </section>
            )}
          </>
        }
      />
    </>
  );
}

/** The lead under the title: when the page last checked. */
export function statusLead(i18n: ReturnType<typeof useI18n>, body: StatusBodyVM | null): string {
  if (body === null || body.lastCheckedAt === null) return i18n.t('settings.status.leadPending');
  return i18n.t('settings.status.lead', { time: { time: body.lastCheckedAt } });
}
