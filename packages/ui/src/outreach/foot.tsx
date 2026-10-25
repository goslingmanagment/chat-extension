// The foot of the list of «Рассылка» (the batch's foot of «Новые»): before the versions — «Выбрано 8 · Снять выбор ·
// [Написать 8 версий]»; while Fix writes them — how far it got and «Остановить»; stopped — «Дописать N»; written —
// «Готово 7 · Очистить»; once versions go — «Отправлено 2 из 7 · не вышло 1 · неизвестно 1 · +$25», «Итог» at the end,
// and «Текст изменился · Переписать 3» when the common text moved after the versions. Never «send all» (X8).

import { type JSX } from 'preact';

import { type OutreachWindowVM } from '@cg/contracts/vm';

import { Button, Spinner, useDispatch, useI18n } from '../kit';

export function Foot({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { batch, totals, audience } = vm;
  if (vm.view.s === 'loading' || vm.view.s === 'error' || vm.view.s === 'forbidden') return null;
  const writing = batch.queued + batch.generating > 0;
  const went = totals.sent + totals.failed + totals.uncertain > 0 || vm.rows.some((row) => row.state === 'sending' || row.state === 'accepted');
  const lines: JSX.Element[] = [];

  if (!audience.locked) {
    const n = audience.count;
    const why = vm.text.trim() === '' ? i18n.t('outreach.foot.needText') : n === 0 ? i18n.t('outreach.foot.needFans') : batch.reason === null ? null : i18n.text(batch.reason);
    lines.push(
      <div key="pick" class="cg-nw__bline">
        <span class="cg-nw__bn">{i18n.t('outreach.foot.picked', { n })}</span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t(n > 0 ? 'outreach.foot.unpick' : 'outreach.foot.pickAll')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'SetOutreach', tickAll: n === 0 })} />
        <Button
          label={i18n.plural('outreach.foot.write', n)}
          variant="line"
          size="sm"
          class="cg-ow__main"
          reason={why}
          tooltip={i18n.t('outreach.foot.writeTooltip')}
          onClick={() => void dispatch({ type: 'GenerateBatch', list: 'outreach' })}
        />
      </div>,
    );
  } else if (writing) {
    lines.push(
      <div key="writing" class="cg-nw__bline">
        <span class="cg-nw__bst" role="status">
          <Spinner />
          {i18n.t('outreach.foot.writing', { done: totals.written, total: totals.total })}
        </span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t('batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatch', list: 'outreach' })} />
      </div>,
    );
  } else if (totals.stopped > 0) {
    lines.push(
      <div key="stopped" class="cg-nw__bline">
        <span class="cg-nw__bst">{i18n.t('outreach.foot.stopped', { done: totals.written, total: totals.total })}</span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t('outreach.foot.resume', { n: totals.stopped })} variant="line" size="sm" class="cg-ow__main" onClick={() => void dispatch({ type: 'GenerateBatch', list: 'outreach' })} />
      </div>,
    );
  } else if (!went) {
    lines.push(
      <div key="ready" class="cg-nw__bline">
        <span class="cg-nw__bn">{i18n.t('outreach.foot.ready', { n: totals.ready })}</span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t('batch.clear')} variant="quiet" size="sm" tooltip={i18n.t('outreach.foot.clearTooltip')} onClick={() => void dispatch({ type: 'ClearBatch', list: 'outreach' })} />
      </div>,
    );
  } else {
    const parts = [totals.failed > 0 ? i18n.t('outreach.foot.failed', { n: totals.failed }) : null, totals.uncertain > 0 ? i18n.t('outreach.foot.uncertain', { n: totals.uncertain }) : null, totals.replied > 0 ? i18n.t('outreach.foot.replied', { n: totals.replied }) : null].filter((part): part is string => part !== null);
    const ended = totals.sent + totals.uncertain > 0;
    const unsent = totals.ready + totals.failed + totals.stopped > 0;
    lines.push(
      <div key="went" class="cg-nw__bline">
        <span class="cg-nw__bst" role="status">
          <span>
            <span class="cg-nw__bn">{i18n.t('outreach.foot.sent', { n: totals.sent, total: totals.total })}</span>
            {parts.length === 0 ? null : ` · ${parts.join(' · ')}`}
            {totals.boughtMills === null ? null : (
              <>
                {' · '}
                <span class="cg-ow__money">{i18n.formatMoneyMills(totals.boughtMills, { sign: 'plus' })}</span>
              </>
            )}
          </span>
        </span>
        <span class="cg-nw__grow" />
        {ended ? <Button label={i18n.t('outreach.foot.summary')} variant="quiet" size="sm" pressed={vm.pane === 'summary' && vm.card === null} onClick={() => void dispatch({ type: 'SetOutreach', pane: 'summary' })} /> : null}
        {unsent ? <Button label={i18n.t('batch.clear')} variant="quiet" size="sm" tooltip={i18n.t('outreach.foot.clearSentTooltip')} onClick={() => void dispatch({ type: 'ClearBatch', list: 'outreach' })} /> : null}
      </div>,
    );
  }
  if (vm.stale > 0 && !writing) {
    lines.push(
      <div key="stale" class="cg-nw__bline is-changed">
        <span>{i18n.t('outreach.foot.changed')} ·</span>
        <Button label={i18n.t('outreach.foot.rewrite', { n: vm.stale })} variant="quiet" size="sm" class="cg-ow__strong" tooltip={i18n.t('outreach.foot.rewriteTooltip')} onClick={() => void dispatch({ type: 'GenerateBatch', list: 'outreach' })} />
      </div>,
    );
  }
  return (
    <div class="cg-nw__batch cg-ow__foot" role="group" aria-label={i18n.t('outreach.foot.label')} data-cg-batch={writing ? 'running' : audience.locked ? 'done' : 'picked'}>
      {lines}
    </div>
  );
}
