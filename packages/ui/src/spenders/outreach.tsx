// «Рассылка» of the Spenders window (Fansly): the head's button that shows the bar; the bar — the common text after
// each fan's personal line and the page's own «Copied …» items, ticked to go with every message; and at the end of a
// row's batch line its «Отправить» — one click, one fan (X8: no key, no «send all»), then how it went in words.

import { type JSX } from 'preact';

import { type OutreachRowVM, type OutreachVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, TextField, useDispatch, useI18n } from '../kit';

const TEXT_MAX = 5_000;

const STATE_KEYS = {
  sending: 'outreach.state.sending',
  sent: 'outreach.state.sent',
  uncertain: 'outreach.state.uncertain',
  failed: 'outreach.state.failed',
} as const satisfies Record<Exclude<OutreachRowVM['state'], 'ready'>, string>;

/** «Рассылка» in the window's head: shows or hides the bar. */
export function OutreachToggle({ outreach }: { readonly outreach: OutreachVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <Button
      label={i18n.t('outreach.button')}
      variant="quiet"
      size="sm"
      class="cg-or__toggle"
      pressed={outreach.open}
      tooltip={i18n.t('outreach.buttonTooltip')}
      onClick={() => void dispatch({ type: 'SetOutreach', open: !outreach.open })}
    />
  );
}

/** The bar under the window's chips while the outreach is open. */
export function OutreachBar({ outreach }: { readonly outreach: OutreachVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const media = outreach.items.some((item) => item.contentType === 1);
  return (
    <section class="cg-or" aria-label={i18n.t('outreach.title')} data-cg-outreach="open">
      <div class="cg-or__head">
        <b class="cg-or__title">{i18n.t('outreach.title')}</b>
        {outreach.sent === 0 ? null : <span class="cg-or__sent cg-num">{i18n.t('outreach.sent', { n: outreach.sent })}</span>}
        <span class="cg-sp__grow" />
        <Button label={i18n.t('outreach.close')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'SetOutreach', open: false })} />
      </div>
      <div class="cg-or__body">
        <label class="cg-or__text">
          <span class="cg-or__label">{i18n.t('outreach.text')}</span>
          <TextField
            value={outreach.text}
            label={i18n.t('outreach.text')}
            placeholder={i18n.t('outreach.textPlaceholder')}
            multiline
            minHeight={56}
            maxHeight={140}
            maxLength={TEXT_MAX}
            onValue={(text) => void dispatch({ type: 'SetOutreach', text })}
          />
        </label>
        <div class="cg-or__items">
          <span class="cg-or__label">
            {i18n.t('outreach.items')}
            <Button label={i18n.t('outreach.refresh')} variant="quiet" size="sm" class="cg-or__refresh" onClick={() => void dispatch({ type: 'SetOutreach', refresh: true })} />
          </span>
          {outreach.items.length === 0 ? <span class="cg-or__note">{i18n.t('outreach.noItems')}</span> : null}
          {outreach.items.map((item) => (
            <button
              key={`${item.contentType}:${item.contentId}`}
              type="button"
              role="checkbox"
              class="cg-or__item"
              aria-checked={item.picked ? 'true' : 'false'}
              data-cg-copied={item.contentType === 2 ? 'bundle' : 'media'}
              onClick={() => void dispatch({ type: 'SetOutreach', item: { contentType: item.contentType, contentId: item.contentId, picked: !item.picked } })}
            >
              <CheckGlyph on={item.picked} />
              <span>{i18n.t(item.contentType === 2 ? 'outreach.item.bundle' : 'outreach.item.media')}</span>
              <span class="cg-or__id cg-num">({item.contentId})</span>
            </button>
          ))}
          {media ? <span class="cg-or__note">{i18n.t('outreach.mediaHint')}</span> : null}
        </div>
      </div>
      <p class="cg-or__hint">{i18n.t('outreach.hint')}</p>
    </section>
  );
}

/** The end of a row's batch line: «Отправить» while the fan's message may go, then how it went. */
export function OutreachSend({ handle, row }: { readonly handle: string; readonly row: OutreachRowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (row.state === 'ready' || (row.state === 'failed' && row.can)) {
    return (
      <span class="cg-or__end" data-cg-outreach-row={row.state} {...(row.code === null ? {} : { 'data-cg-code': row.code })}>
        {row.state === 'failed' ? <span class="cg-or__state is-failed">{`${i18n.t('outreach.state.failed')}${row.code === null ? '' : ` · ${row.code}`}`}</span> : null}
        <Button
          label={i18n.t('outreach.send')}
          variant="send"
          size="sm"
          class="cg-or__send"
          tabIndex={-1}
          tooltip={i18n.t('outreach.sendTooltip')}
          reason={row.can ? null : i18n.t('newcomers.row.sendPaused')}
          onClick={(event) => {
            event.stopPropagation();
            if (row.can) void dispatch({ type: 'SendOutreach', targetHandle: handle });
          }}
        />
      </span>
    );
  }
  return (
    <span class="cg-or__end" data-cg-outreach-row={row.state} {...(row.code === null ? {} : { 'data-cg-code': row.code })}>
      <span class={`cg-or__state is-${row.state}`} role="status">
        {i18n.t(STATE_KEYS[row.state])}
        {row.code === null || row.state === 'sent' ? null : ` · ${row.code}`}
      </span>
    </span>
  );
}

export const OUTREACH_CSS = `
.cg-or { flex: none; padding: 10px 16px 8px; border-bottom: 1px solid var(--cg-rule); background: var(--cg-sunk); }
.cg-or__head { display: flex; align-items: center; gap: 12px; min-height: 28px; }
.cg-or__title { font-weight: 600; color: var(--cg-ink-strong); }
.cg-or__sent { color: var(--cg-ink-2); font-size: var(--cg-text-sm); }
.cg-or__body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 6px; }
.cg-or__text, .cg-or__items { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cg-or__label { display: flex; align-items: center; gap: 8px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-or__label .cg-or__refresh { height: 22px; padding: 0 6px; }
.cg-or__text .cg-field { width: 100%; box-sizing: border-box; font-family: var(--cg-serif); }
.cg-or__item {
  display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; border-radius: var(--cg-r-sm);
  color: var(--cg-ink-2); text-align: left; background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
}
.cg-or__item[aria-checked="true"] { color: var(--cg-ink-strong); box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
.cg-or__id { color: var(--cg-ink-muted); }
.cg-or__note { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 1.35; }
.cg-or__hint { margin: 8px 0 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-or__end { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 8px; padding-right: 12px; }
.cg-spw .cg-or__send.cg-btn { height: 18px; padding: 0 10px; font-size: var(--cg-text-xs); border-radius: var(--cg-r-sm); }
.cg-or__state { color: var(--cg-ink-2); }
.cg-or__state.is-sent { color: var(--cg-ink-strong); font-weight: 500; }
.cg-or__state.is-failed, .cg-or__state.is-uncertain { color: var(--cg-bad-ink); }
@media (max-width: 900px) { .cg-or__body { grid-template-columns: minmax(0, 1fr); } }
`;
