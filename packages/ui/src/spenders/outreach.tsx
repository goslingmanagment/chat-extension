// «Рассылка» of the Spenders window (Fansly): the head's button that shows the bar; the bar — the common text after
// each fan's personal line and the page's own «Copied …» items, ticked to go with every message; and in a row's action
// cell its «Отправить» — one click, one fan (X8: no key, no «send all»), then how it went in words. The family's
// language (ui-design §1): the items are chosen in a groove, the personal line is a draft (the batch line under the
// row, serif), blue is «Отправить» alone, a failure is a red dot with its words and code.

import { type JSX } from 'preact';

import { type OutreachRowVM, type OutreachVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, Icon, TextField, useDispatch, useI18n, useTooltip } from '../kit';

const TEXT_MAX = 5_000;

/** The id's tail as the person tells two items apart; the whole id is in the item's tooltip. */
const tail = (id: string): string => `··${id.slice(-4)}`;

/** «Рассылка» in the window's head: shows or hides the bar; pressed while it is shown. */
export function OutreachToggle({ outreach }: { readonly outreach: OutreachVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <Button
      label={outreach.sent === 0 ? i18n.t('outreach.button') : `${i18n.t('outreach.button')} · ${i18n.t('outreach.sent', { n: outreach.sent })}`}
      variant="quiet"
      size="sm"
      class="cg-or__toggle"
      pressed={outreach.open}
      tooltip={i18n.t('outreach.buttonTooltip')}
      onClick={() => void dispatch({ type: 'SetOutreach', open: !outreach.open })}
    />
  );
}

function Item({ item }: { readonly item: OutreachVM['items'][number] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const kind = i18n.t(item.contentType === 2 ? 'outreach.item.bundle' : 'outreach.item.media');
  const tip = useTooltip(i18n.t('outreach.itemTooltip', { kind, id: item.contentId }));
  return (
    <button
      type="button"
      role="checkbox"
      class="cg-or__item"
      aria-checked={item.picked ? 'true' : 'false'}
      aria-label={`${kind} ${item.contentId}`}
      data-cg-copied={item.contentType === 2 ? 'bundle' : 'media'}
      {...tip.props}
      onClick={() => void dispatch({ type: 'SetOutreach', item: { contentType: item.contentType, contentId: item.contentId, picked: !item.picked } })}
    >
      <CheckGlyph on={item.picked} />
      <span>{kind}</span>
      <span class="cg-or__id cg-num">{tail(item.contentId)}</span>
      {tip.description}
    </button>
  );
}

/** The bar under the window's chips while the outreach is open. */
export function OutreachBar({ outreach, started }: { readonly outreach: OutreachVM; readonly started: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const media = outreach.items.some((item) => item.contentType === 1);
  const adapt = outreach.adapt === true;
  const adaptTip = useTooltip(i18n.t('outreach.adaptTooltip'));
  return (
    <section class="cg-or" aria-label={i18n.t('outreach.title')} data-cg-outreach="open" data-cg-adapt={adapt ? 'on' : 'off'}>
      <div class="cg-or__col">
        <span class="cg-or__label">
          {i18n.t(adapt ? 'outreach.textAdapt' : 'outreach.text')}
          {/* «Подстроить под фана»: only where the hub can rewrite a mass message for one fan. */}
          {outreach.adapt === null ? null : (
            <button
              type="button"
              role="switch"
              class="cg-or__adapt"
              aria-checked={adapt ? 'true' : 'false'}
              {...adaptTip.props}
              onClick={() => void dispatch({ type: 'SetOutreach', adapt: !adapt })}
            >
              <CheckGlyph on={adapt} />
              {i18n.t('outreach.adapt')}
              {adaptTip.description}
            </button>
          )}
        </span>
        <TextField
          value={outreach.text}
          label={i18n.t(adapt ? 'outreach.textAdapt' : 'outreach.text')}
          placeholder={i18n.t(adapt ? 'outreach.textAdaptPlaceholder' : 'outreach.textPlaceholder')}
          multiline
          minHeight={64}
          maxHeight={140}
          maxLength={TEXT_MAX}
          class="cg-or__field"
          onValue={(text) => void dispatch({ type: 'SetOutreach', text })}
        />
      </div>
      <div class="cg-or__col">
        <span class="cg-or__label">
          {i18n.t('outreach.items')}
          <Button label={i18n.t('outreach.refresh')} icon="refresh" iconOnly variant="quiet" size="sm" class="cg-or__icon" onClick={() => void dispatch({ type: 'SetOutreach', refresh: true })} />
        </span>
        {outreach.items.length === 0 ? (
          <span class="cg-or__note">{i18n.t('outreach.noItems')}</span>
        ) : (
          <div class="cg-or__items" role="group" aria-label={i18n.t('outreach.items')}>
            {outreach.items.map((item) => (
              <Item key={`${item.contentType}:${item.contentId}`} item={item} />
            ))}
          </div>
        )}
        {media ? <span class="cg-or__note">{i18n.t('outreach.mediaHint')}</span> : null}
        {/* How it goes, until a batch wrote the lines: then the batch's own line says what is left. */}
        {started ? null : <span class="cg-or__note">{i18n.t(adapt ? 'outreach.hintAdapt' : 'outreach.hint')}</span>}
      </div>
      <Button label={i18n.t('outreach.close')} icon="x" iconOnly variant="quiet" size="sm" class="cg-or__close cg-or__icon" onClick={() => void dispatch({ type: 'SetOutreach', open: false })} />
    </section>
  );
}

/**
 * What goes after the row's line: «+ общий текст и 2 вложения»; with «Подстроить под фана» the line is the fan's whole
 * version, so only «+ 2 вложения»; null — nothing but the line.
 */
export function useOutreachAdds(outreach: OutreachVM | undefined): string | null {
  const i18n = useI18n();
  if (outreach === undefined) return null;
  const items = outreach.items.filter((item) => item.picked).length;
  const text = outreach.adapt !== true && outreach.text.trim() !== '';
  const parts = [text ? i18n.t('outreach.plusText') : null, items === 0 ? null : i18n.plural('outreach.plusItems', items)].filter((part) => part !== null);
  return parts.length === 0 ? null : i18n.t('outreach.plus', { what: parts.join(` ${i18n.t('outreach.and')} `) });
}

/** The row's action cell in the outreach: «Отправить» while the fan's message may go, then how it went. */
export function OutreachSend({ handle, row }: { readonly handle: string; readonly row: OutreachRowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const why = row.state === 'uncertain' ? i18n.t('outreach.state.uncertain') : row.state === 'failed' && row.code !== null ? `${i18n.t('outreach.state.failed')} · ${row.code}` : null;
  const tip = useTooltip(why);
  const send = row.state === 'ready' || row.state === 'failed';
  return (
    <span role="cell" class="cg-bd__act cg-or__act" data-cg-outreach-row={row.state} {...(row.code === null ? {} : { 'data-cg-code': row.code })}>
      {row.state === 'sent' ? (
        <span class="cg-or__state is-sent" role="status">
          <Icon name="check" />
          {i18n.t('outreach.state.sent').replace(/^✓\s*/, '')}
        </span>
      ) : null}
      {row.state === 'uncertain' || row.state === 'failed' ? (
        <span class={`cg-or__state is-${row.state}`} role="status" {...tip.props}>
          <span class="cg-or__dot" aria-hidden="true" />
          {row.state === 'uncertain' ? i18n.t('outreach.state.uncertainShort') : i18n.t('outreach.state.failed')}
          {tip.description}
        </span>
      ) : null}
      {send ? (
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
      ) : null}
      {row.state === 'sending' ? <Button label={i18n.t('outreach.state.sending')} variant="send" size="sm" class="cg-or__send" busy tabIndex={-1} /> : null}
    </span>
  );
}

export const OUTREACH_CSS = `
.cg-or {
  flex: none; position: relative; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 20px;
  padding: 12px 48px 12px 16px; border-bottom: 1px solid var(--cg-rule); background: var(--cg-sunk);
}
.cg-or__col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cg-or__label { display: flex; align-items: center; gap: 4px; min-height: 20px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 500; }
.cg-spw .cg-or__icon.cg-btn { width: 22px; height: 22px; padding: 0; justify-content: center; color: var(--cg-ink-muted); }
.cg-spw .cg-or__icon.cg-btn:hover { background: var(--cg-surface); color: var(--cg-ink-strong); }
.cg-or__close { position: absolute; top: 10px; right: 12px; }
.cg-or .cg-or__field { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-surface); line-height: 1.4; }
.cg-or__items {
  display: flex; flex-wrap: wrap; gap: 2px; align-self: flex-start; padding: 2px; border-radius: var(--cg-r-md);
  background: var(--cg-groove, var(--cg-surface)); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
}
.cg-or__item {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 8px; border-radius: var(--cg-r-sm);
  color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); white-space: nowrap;
}
.cg-or__item:hover { color: var(--cg-ink-strong); }
.cg-or__item[aria-checked="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); box-shadow: 0 0 0 1px var(--cg-rule-2); }
.cg-or__item .cg-ico { width: 12px; height: 12px; }
.cg-or__id { color: var(--cg-ink-faint); font-size: var(--cg-text-xs); }
.cg-or__item[aria-checked="true"] .cg-or__id { color: var(--cg-ink-muted); }
.cg-or__adapt {
  display: inline-flex; align-items: center; gap: 5px; height: 20px; margin-left: auto; padding: 0 8px; border-radius: var(--cg-r-sm);
  color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 500;
}
.cg-or__adapt:hover { color: var(--cg-ink-strong); }
.cg-or__adapt[aria-checked="true"] { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.cg-or__adapt .cg-ico { width: 11px; height: 11px; }
.cg-or__note { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 1.4; white-space: normal; }
.cg-spw .cg-sp__head .cg-or__toggle.cg-btn[aria-pressed="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); }
/* A row of the outreach: «Отправить» always shown in the action cell; the personal line under it is a draft. */
.cg-bd__act.cg-or__act { gap: 6px; }
.cg-spw .cg-or__send.cg-btn { height: 26px; padding: 0 12px; border-radius: var(--cg-r-sm); font-size: var(--cg-text-sm); }
.cg-or__state { display: inline-flex; align-items: center; gap: 5px; font-size: var(--cg-text-sm); white-space: nowrap; }
.cg-or__state.is-sent { color: var(--cg-ink-strong); font-weight: 500; }
.cg-or__state.is-sent .cg-ico { width: 12px; height: 12px; }
.cg-or__state.is-failed, .cg-or__state.is-uncertain { color: var(--cg-ink-2); }
.cg-or__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cg-danger); }
.cg-or__state.is-uncertain .cg-or__dot { background: var(--cg-ink-muted); }
.cg-bd__row.has-outreach .cg-bt__line > b { display: none; }
.cg-bd__row.has-outreach .cg-bt__line .cg-bt__text { font-family: var(--cg-serif); color: var(--cg-ink); }
.cg-or__plus { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); }
@media (max-width: 900px) { .cg-or { grid-template-columns: minmax(0, 1fr); } }
`;
