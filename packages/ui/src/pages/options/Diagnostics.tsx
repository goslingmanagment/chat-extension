// «Диагностика» (architecture.md §9.2, §9.9; LG-020…LG-025, ST-110): the
// diagnostics file, how much our own caches and logs take, «Очистить
// локальные данные» with a confirmation, today's error counters and, in
// debug mode, the journals. Nothing here holds a conversation or a prompt.

import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type AiSpendRowVM, type AiSpendVM, type DiagnosticsBodyVM, type JournalKind } from '@cg/contracts/vm';

import { Button, useI18n } from '../../kit';
import { Card, Opt, useAct, usePageServices } from '../shared';

export const JOURNAL_NAME_KEYS: Readonly<Record<JournalKind, I18nKey>> = {
  operations: 'journal.kind.operations',
  'hub-calls': 'journal.kind.hubCalls',
  'send-attempts': 'journal.kind.sendAttempts',
  'newcomers-check': 'journal.kind.newcomersCheck',
};

/**
 * «Расходы AI по функциям» (DB-022, 1.20.0): this browser's journal, today and 7 days, in debug mode only — numbers,
 * never a text. «Только этот браузер»: the hint says it is not the person's whole spend.
 */
function AiSpend({ spend }: { readonly spend: AiSpendVM }): JSX.Element {
  const i18n = useI18n();
  const name = (row: AiSpendRowVM): string => (typeof row.feature === 'string' ? row.feature : i18n.text(row.feature));
  const cells = (row: AiSpendRowVM): JSX.Element[] => [
    <td key="runs" class="cg-num">{row.runs}</td>,
    <td key="inserts" class="cg-num">{row.inserts}</td>,
    <td key="tokens" class="cg-num">{row.tokens}</td>,
    <td key="cache" class="cg-num">{row.cache ?? '—'}</td>,
    <td key="cost" class="cg-num">{row.cost}</td>,
  ];
  return (
    <Opt label={i18n.t('settings.diagnostics.aiSpend')} hint={i18n.t('settings.diagnostics.aiSpendHint')} anchor="ai-spend">
      {spend.periods.map((period, index) => (
        <table key={index} class="pg-table pg-spend" data-pg-spend={index === 0 ? 'today' : 'week'} aria-label={`${i18n.t('settings.diagnostics.aiSpend')}: ${i18n.text(period.label)}`}>
          <thead>
            <tr class="pg-table__group">
              <th colSpan={6}>{i18n.text(period.label)}</th>
            </tr>
            <tr>
              <th>{i18n.t('settings.diagnostics.aiSpend.feature')}</th>
              <th>{i18n.t('settings.diagnostics.aiSpend.runs')}</th>
              <th>{i18n.t('settings.diagnostics.aiSpend.inserts')}</th>
              <th>{i18n.t('settings.diagnostics.aiSpend.tokens')}</th>
              <th>{i18n.t('settings.diagnostics.aiSpend.cache')}</th>
              <th>{i18n.t('settings.diagnostics.aiSpend.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {period.rows.length === 0 ? (
              <tr>
                <td colSpan={6} class="pg-muted">
                  {i18n.t('settings.diagnostics.aiSpend.none')}
                </td>
              </tr>
            ) : (
              [
                ...period.rows.map((row) => (
                  <tr key={name(row)}>
                    <td>{name(row)}</td>
                    {cells(row)}
                  </tr>
                )),
                <tr key="total">
                  <td class="pg-strong">{name(period.total)}</td>
                  {cells(period.total)}
                </tr>,
              ]
            )}
          </tbody>
        </table>
      ))}
    </Opt>
  );
}

export function DiagnosticsSection({ body }: { readonly body: DiagnosticsBodyVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const services = usePageServices();
  const size = (kb: number | null): string => {
    if (kb === null) return i18n.t('common.unknown');
    return kb >= 1024 ? i18n.t('settings.diagnostics.mb', { n: (kb / 1024).toFixed(1) }) : i18n.t('settings.diagnostics.kb', { n: kb });
  };
  return (
    <Card>
        <Opt label={i18n.t('settings.diagnostics.exportLabel')} hint={i18n.t('settings.diagnostics.exportHint')}>
          <span class="pg-line">
            <Button label={i18n.text(body.export.label)} variant="line" onClick={() => void act(body.export.action, { success: i18n.t('settings.diagnostics.exported') })} />
            <Button label={i18n.t('settings.status.copyReport')} variant="plain" icon="copy" onClick={() => void act({ type: 'CopyReport', scope: 'status' }, { success: i18n.t('common.copied') })} />
          </span>
        </Opt>
        <Opt label={i18n.t('settings.diagnostics.sizeLabel')} hint={i18n.t('settings.diagnostics.sizeHint')} anchor="storage">
          <span class="pg-line">
            <span class="pg-value">{i18n.t('settings.diagnostics.caches', { size: size(body.cachesKB) })}</span>
            <span class="pg-value">{i18n.t('settings.diagnostics.logs', { size: size(body.logsKB) })}</span>
          </span>
          <div class="pg-line" style={{ marginTop: '8px' }}>
            <Button
              label={i18n.text(body.clear.label)}
              variant="line"
              onClick={() => {
                // The dialog first (§9.9 «с подтверждением»); the action itself carries `confirmed`.
                void services
                  .confirm({
                    title: { key: 'settings.diagnostics.clearTitle' },
                    body: { key: 'settings.diagnostics.clearConfirm' },
                    confirm: { key: 'settings.diagnostics.clear' },
                    cancel: { key: 'common.cancel' },
                    tone: 'destructive',
                  })
                  .then((answer) => (answer === 'confirm' ? act(body.clear.action, { success: i18n.t('settings.diagnostics.cleared') }) : null));
              }}
            />
          </div>
        </Opt>
        <Opt label={i18n.t('settings.diagnostics.counters')}>
          {body.counters.length === 0 ? (
            <span class="pg-muted">{i18n.t('settings.diagnostics.countersNone')}</span>
          ) : (
            <span class="pg-line">
              {body.counters.map((entry) => (
                <span key={entry.code} class="pg-chip">
                  {entry.code} ×{entry.count}
                </span>
              ))}
            </span>
          )}
        </Opt>
        <Opt label={i18n.t('settings.diagnostics.journals')} hint={i18n.t('settings.diagnostics.journalsHint')}>
          {body.journals === null ? (
            <span class="pg-muted">{i18n.t('settings.diagnostics.journalsOff')}</span>
          ) : (
            <span class="pg-line">
              {body.journals.map((entry) => (
                <Button key={entry.journal} label={i18n.t(JOURNAL_NAME_KEYS[entry.journal])} variant="line" onClick={() => void act(entry.open)} />
              ))}
            </span>
          )}
        </Opt>
        {body.aiSpend === undefined || body.aiSpend === null ? null : <AiSpend spend={body.aiSpend} />}
    </Card>
  );
}
