// A batch of a list (contracts 1.32.0, vm/batch) as both list windows draw it: a check box at the start of a row,
// «Отметить всех» in the column header, the bar over the list once someone is ticked — «Выбрано: 5 ·
// Сгенерировать для 5 · Снять выбор», then «Готово 3 из 5 · Остановить / Очистить» —, and under a row in a batch one
// line: how its generation went, and the text that came out. Nothing here sends: the person opens a row and sends
// on its card, part by part.

import { type ComponentChildren, type JSX } from 'preact';

import { type BatchList, type BatchRowState, type BatchRowVM, type BatchVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, useDispatch, useI18n } from '../kit';

const STATE_KEYS = {
  queued: 'batch.state.queued',
  generating: 'batch.state.generating',
  ready: 'batch.state.ready',
  sent: 'batch.state.sent',
  failed: 'batch.state.failed',
} as const satisfies Record<BatchRowState, string>;

/** A row in a batch draws its line: the list gives it the room. */
export const inBatch = (row: { readonly batch?: BatchRowVM }): boolean => (row.batch?.state ?? null) !== null;

/** The check box at the start of a row; its click never opens the fan. */
export function BatchCheck({ list, handle, row, name }: { readonly list: BatchList; readonly handle: string; readonly row: BatchRowVM; readonly name: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const busy = row.state === 'queued' || row.state === 'generating';
  // A fan a batch cannot greet now (greeted, held, not checked yet): the place stays, the box does not.
  if (!row.pickable && !row.picked && !busy) return <span class="cg-bt__check" aria-hidden="true" />;
  return (
    <button
      type="button"
      class="cg-bt__check"
      role="checkbox"
      aria-checked={row.picked || busy ? 'true' : 'false'}
      aria-label={`${i18n.t('batch.pick')}: ${name}`}
      tabIndex={-1}
      {...(busy ? { 'aria-disabled': 'true' } : {})}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) void dispatch({ type: 'SetBatchPick', list, targetHandles: [handle], picked: !row.picked });
      }}
    >
      <CheckGlyph on={row.picked || busy} />
    </button>
  );
}

/** «Отметить всех в списке»: ticks the rows shown (the list keeps at most `max`), or unticks them. */
export function BatchCheckAll({ list, handles, batch }: { readonly list: BatchList; readonly handles: readonly string[]; readonly batch: BatchVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (handles.length === 0) return null;
  const on = batch.picked > 0;
  return (
    <button
      type="button"
      class="cg-bt__check"
      role="checkbox"
      aria-checked={on ? 'true' : 'false'}
      aria-label={i18n.t('batch.pickAll')}
      onClick={() => void dispatch({ type: 'SetBatchPick', list, targetHandles: handles.slice(0, 1000), picked: !on })}
    >
      <CheckGlyph on={on} />
    </button>
  );
}

/** The bar over the list while someone is ticked or a batch has rows; nothing — when neither. */
export function BatchBar({ list, batch }: { readonly list: BatchList; readonly batch: BatchVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const total = batch.queued + batch.generating + batch.ready + batch.sent + batch.failed;
  if (batch.picked === 0 && total === 0) return null;
  const running = batch.queued + batch.generating > 0;
  const finished = batch.ready + batch.sent;
  return (
    <div class="cg-bt" role="group" aria-label={i18n.t('batch.pickAll')} data-cg-batch={running ? 'running' : batch.picked > 0 ? 'picked' : 'done'}>
      {batch.picked === 0 ? null : (
        <>
          <span class="cg-bt__n">{i18n.t('batch.picked', { n: batch.picked })}</span>
          <Button
            label={i18n.t('batch.generate', { n: batch.picked })}
            variant="line"
            size="sm"
            class="cg-bt__go"
            reason={batch.reason === null ? null : i18n.text(batch.reason)}
            tooltip={i18n.t('batch.generateTooltip')}
            onClick={() => void dispatch({ type: 'GenerateBatch', list })}
          />
          <Button label={i18n.t('batch.unpick')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list })} />
        </>
      )}
      <span class="cg-sp__grow" />
      {total === 0 ? null : (
        <span class="cg-bt__sum" role="status">
          {i18n.t('batch.progress', { done: finished, total })}
          {batch.failed === 0 ? null : ` · ${i18n.t('batch.failedCount', { n: batch.failed })}`}
          {running || finished === 0 ? null : ` · ${i18n.t('batch.hint')}`}
        </span>
      )}
      {running ? <Button label={i18n.t('batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatch', list })} /> : null}
      {!running && total > 0 && batch.picked === 0 ? <Button label={i18n.t('batch.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list })} /> : null}
    </div>
  );
}

/** The line under a row in a batch: its state in words, then the text, or the failure's title with its code. */
export function BatchLine({ row, failureTitle, end }: { readonly row: BatchRowVM; readonly failureTitle?: (code: string) => string; readonly end?: ComponentChildren }): JSX.Element | null {
  const i18n = useI18n();
  if (row.state === null) return null;
  const code = row.failure?.code ?? null;
  const title = row.failure?.title ?? null;
  const why = code === null ? null : (failureTitle?.(code) ?? (title === null ? null : i18n.text(title)));
  return (
    <span class={`cg-bt__line is-${row.state}`} data-cg-batch-row={row.state} {...(code === null ? {} : { 'data-cg-code': code })}>
      <b>{i18n.t(STATE_KEYS[row.state])}</b>
      {row.text === null ? null : <span class="cg-bt__text">{row.text}</span>}
      {code === null ? null : <span class="cg-bt__text">{why === null ? code : `${why} · ${code}`}</span>}
      {end}
    </span>
  );
}

export const BATCH_CSS = `
.cg-bt {
  flex: none; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 12px 4px 20px;
  border-top: 1px solid var(--cg-rule); border-bottom: 1px solid var(--cg-rule); background: var(--cg-sunk); min-width: 0;
}
.cg-bt__n { color: var(--cg-ink-strong); font-weight: 500; white-space: nowrap; }
.cg-bt__sum { color: var(--cg-ink-2); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cg-bt__check {
  flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-right: 8px;
  border-radius: var(--cg-r-sm); color: var(--cg-ink-faint);
}
.cg-bt__check:hover, .cg-bt__check[aria-checked="true"] { color: var(--cg-ink-strong); }
.cg-bt__check[aria-disabled="true"] { color: var(--cg-ink-muted); cursor: default; }
.cg-bt__line {
  grid-column: 1 / -1; display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-left: 28px;
  font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap;
}
.cg-bt__line > b { flex: none; font-weight: 500; color: var(--cg-ink-2); }
.cg-bt__line.is-ready > b, .cg-bt__line.is-sent > b { color: var(--cg-ink-strong); }
.cg-bt__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--cg-ink-2); }
`;
