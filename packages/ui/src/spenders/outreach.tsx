// «Рассылка» of the Spenders window (Fansly): the head's button that shows the bar; the bar — the common text after
// each fan's personal line and the page's own «Copied …» items, ticked to go with every message; and in a row's action
// cell its «Отправить» — one click, one fan (X8: no key, no «send all»), then how it went in words. The family's
// language (ui-design §1): the items are chosen in a groove, the personal line is a draft (the batch line under the
// row, serif), blue is «Отправить» alone, a failure is a red dot with its words and code.

import { type JSX } from 'preact';

import { OUTREACH_MEDIA_HANDLE, type BatchVM, type MediaPickerVM, type OutreachRowVM, type OutreachVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, Icon, TextField, useDispatch, useI18n, useTooltip } from '../kit';
import { MediaPicker, priceText } from './preview/MediaPicker';

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
export function OutreachBar({ outreach, batch }: { readonly outreach: OutreachVM; readonly batch: BatchVM | undefined }): JSX.Element {
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
          {outreach.adapt === null || outreach.channel === 'preview' ? null : (
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
      {outreach.channel === 'preview' ? (
        <div class="cg-or__col">
          <span class="cg-or__label">{i18n.t('outreach.media.title')}</span>
          {outreach.media === null ? (
            <>
              {/* The outreach's own media window: the vault, the picks, the price — for no fan in particular. */}
              <Button label={i18n.t('outreach.media.pick')} icon="media" variant="line" size="sm" class="cg-or__pick" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: OUTREACH_MEDIA_HANDLE, open: true })} />
              <span class="cg-or__note">{i18n.t('outreach.media.none')}</span>
            </>
          ) : (
            <span class="cg-or__media" data-cg-outreach-media="on">
              <Icon name="media" />
              <b>{mediaText(i18n, outreach.media)}</b>
              {outreach.media.from === null ? null : <span class="cg-or__id">{i18n.t('outreach.media.from', { name: outreach.media.from })}</span>}
              <Button label={i18n.t('outreach.media.change')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: OUTREACH_MEDIA_HANDLE, open: true })} />
              <Button label={i18n.t('outreach.media.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearOutreachMedia' })} />
            </span>
          )}
        </div>
      ) : (
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
      </div>
      )}
      <Steps outreach={outreach} batch={batch} />
      <Button label={i18n.t('outreach.close')} icon="x" iconOnly variant="quiet" size="sm" class="cg-or__close cg-or__icon" onClick={() => void dispatch({ type: 'SetOutreach', open: false })} />
    </section>
  );
}

/**
 * How the outreach goes, the step at hand lit: the text, the ticks in the list, the batch's button over the list, the
 * row's «Отправить». Without «Подстроить» the common text may stay empty, so it never holds the way.
 */
function Steps({ outreach, batch }: { readonly outreach: OutreachVM; readonly batch: BatchVM | undefined }): JSX.Element {
  const i18n = useI18n();
  const adapting = outreach.adapt === true || outreach.channel === 'preview';
  const started = batch !== undefined && batch.queued + batch.generating + batch.ready + batch.sent + batch.failed > 0;
  const steps = [
    { key: 'text', label: i18n.t(adapting ? 'outreach.step.text' : 'outreach.step.textOptional'), done: outreach.text.trim() !== '', holds: adapting },
    { key: 'pick', label: i18n.t('outreach.step.pick'), done: started || (batch?.picked ?? 0) > 0, holds: true },
    { key: 'run', label: i18n.t('outreach.step.run', { button: i18n.t(adapting ? 'outreach.adaptLines' : 'outreach.writeLines') }), done: started, holds: true },
    { key: 'send', label: i18n.t('outreach.step.send'), done: started && batch.sent > 0 && batch.ready + batch.queued + batch.generating === 0, holds: true },
  ];
  const now = steps.findIndex((step) => step.holds && !step.done);
  return (
    <ol class="cg-or__steps" aria-label={i18n.t('outreach.steps')}>
      {steps.map((step, index) => (
        <li key={step.key} class={`cg-or__step${step.done ? ' is-done' : ''}${index === now ? ' is-now' : ''}`} {...(index === now ? { 'aria-current': 'step' as const } : {})}>
          <span class="cg-or__stepn cg-num" aria-hidden="true">
            {step.done ? <Icon name="check" size={12} /> : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * «Выбрать медиа»: the outreach's own media window over the list — the vault's folders, a large grid, the picks in
 * order with their free previews, the price, and «Для всей рассылки». Esc or × closes it; the picks stay for «Изменить».
 */
export function OutreachMediaWindow({ picker }: { readonly picker: MediaPickerVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const close = (): void => void dispatch({ type: 'SetMediaOpen', targetHandle: OUTREACH_MEDIA_HANDLE, open: false });
  return (
    <div
      class="cg-or-mw"
      role="dialog"
      aria-label={i18n.t('outreach.media.window')}
      data-cg-outreach-window="media"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div class="cg-or-mw__head">
        <b class="cg-or-mw__title">{i18n.t('outreach.media.window')}</b>
        <span class="cg-or__note">{i18n.t('outreach.media.windowHint')}</span>
        <span class="cg-sp__grow" />
        <Button label={i18n.t('common.close')} variant="quiet" size="sm" hotkey="Esc" onClick={close} />
      </div>
      <MediaPicker vm={picker} handle={OUTREACH_MEDIA_HANDLE} variant="window" />
    </div>
  );
}

/** «2 медиа · 1 бесплатное превью · $25» of the outreach's vault media. */
function mediaText(i18n: ReturnType<typeof useI18n>, media: NonNullable<OutreachVM['media']>): string {
  const parts = [i18n.plural('outreach.plusMedia', media.count), media.previews === 0 ? null : i18n.plural('outreach.mediaPreviews', media.previews), media.priceCents === 0 ? i18n.t('outreach.mediaFree') : priceText(media.priceCents)];
  return parts.filter((part) => part !== null).join(' · ');
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
  // From the card: the outreach's vault media, as each fan's card takes them (a fan's own picks there win).
  const media = outreach.media === null ? null : i18n.plural('outreach.plusMedia', outreach.media.count) + (outreach.media.priceCents > 0 ? ` ${priceText(outreach.media.priceCents)}` : '');
  const parts = [text ? i18n.t('outreach.plusText') : null, items === 0 ? null : i18n.plural('outreach.plusItems', items), media].filter((part) => part !== null);
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
          label={i18n.t(row.anyway === true ? 'outreach.sendAnyway' : 'outreach.send')}
          variant="send"
          size="sm"
          class="cg-or__send"
          tabIndex={-1}
          tooltip={i18n.t(row.anyway === true ? 'outreach.sendAnywayTooltip' : 'outreach.sendTooltip')}
          reason={row.can ? null : i18n.t('newcomers.row.sendPaused')}
          onClick={(event) => {
            event.stopPropagation();
            if (row.can) void dispatch(row.anyway === true ? { type: 'SendOutreach', targetHandle: handle, anyway: true } : { type: 'SendOutreach', targetHandle: handle });
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
.cg-or__media { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; min-height: 32px; padding: 0 4px 0 10px; border-radius: var(--cg-r-md); background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-strong); font-size: var(--cg-text-sm2); }
.cg-or__media .cg-ico { width: 14px; height: 14px; color: var(--cg-ink-muted); }
.cg-spw .cg-or__pick.cg-btn { align-self: flex-start; }
.cg-or-mw {
  position: absolute; inset: 64px 16px 40px; z-index: 30; display: flex; flex-direction: column; min-height: 0;
  border-radius: 12px; background: var(--cg-surface); box-shadow: var(--cg-shadow), 0 0 0 1px var(--cg-rule-2); overflow: hidden;
}
.cg-or-mw__head { flex: none; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 12px 0 20px; border-bottom: 1px solid var(--cg-rule); }
.cg-or-mw__title { font-weight: 600; font-size: var(--cg-text-lg, 15px); color: var(--cg-ink-strong); white-space: nowrap; }
.cg-or-mw .cg-pvm { flex: 1; min-height: 0; }
.cg-or__media b { font-weight: 500; }
.cg-or__note { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 1.4; white-space: normal; }
.cg-or__steps {
  grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 0; margin: 0; padding: 0; list-style: none;
  color: var(--cg-ink-muted); font-size: var(--cg-text-sm2);
}
.cg-or__step { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.cg-or__step + .cg-or__step::before { content: ''; width: 24px; height: 1px; margin: 0 12px; background: var(--cg-rule-2); }
.cg-or__stepn {
  display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 10px;
  box-shadow: inset 0 0 0 1px var(--cg-rule-2); font-size: var(--cg-text-xs); font-weight: 600;
}
.cg-or__stepn .cg-ico { width: 12px; height: 12px; }
.cg-or__step.is-done { color: var(--cg-ink-2); }
.cg-or__step.is-done .cg-or__stepn { background: var(--cg-surface); color: var(--cg-ink-strong); }
.cg-or__step.is-now { color: var(--cg-ink-strong); font-weight: 500; }
.cg-or__step.is-now .cg-or__stepn { background: var(--cg-clay-ink); color: var(--cg-surface); box-shadow: none; }
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
