// The media panel of a preview (decision X53). On top (2026-10-24, the
// owner): «Платное» and «Превью» with their picks as squares and the price
// between them — a click on one makes the grid's clicks land there. Under
// them the vault's folders as chips, one folder's media as a grid of
// thumbnails, the picks numbered in the message's order, what the fan
// already got of a medium; at the foot what goes — and, once closed with
// picks, the one line of what goes with the next part sent. A chunk of its own
// (MediaPicker.tsx loads it on the first «Медиа» click; the extension's lazy
// entry `preview-send`): Spenders, «Новые» and the preview window carry only
// the toggle. Nothing here sends.

import { type ComponentChildren, type JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { type I18n, type MediaCellVM, type MediaChosenVM, type MediaPickerVM, type TargetHandle } from '@cg/contracts/vm';

import { type LazyPart } from '../../dock/lazy-part';
import { Button, ErrorCard, Icon, Spinner, TextField, useDispatch, useI18n, useTooltip, type StyleSource } from '../../kit';

export interface MediaPanelProps {
  readonly vm: MediaPickerVM;
  readonly handle: TargetHandle;
  /** `window` — «Рассылка»'s media sheet: the folders wrap, the grid is large and fills the sheet. */
  readonly variant?: 'window';
  /** At the foot's end, after what goes (the sheet's «Готово»). */
  readonly extra?: ComponentChildren;
  /** false — no «Очистить» of the panel's own (the sheet puts its own words there through `extra`). */
  readonly clear?: false;
  /** A word on a medium of the grid, by its id («1 из 8 уже купил»). */
  readonly marks?: Readonly<Record<string, string>>;
}

/** Where a click on a medium lands: «Платное» (behind the price) or «Превью» (free). */
type Step = 'paid' | 'preview';

const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const TYPE_KEYS = { photo: 'preview.media.type.photo', video: 'preview.media.type.video', gif: 'preview.media.type.anim', audio: 'preview.media.type.audio' } as const;

function typeWords(i18n: I18n, cell: Pick<MediaCellVM, 'type' | 'duration'>): string {
  return i18n.t(TYPE_KEYS[cell.type], { duration: duration(cell.duration) });
}

/** What is wrong with the picks, under the panel or in the closed line. */
function Notes({ vm, handle }: MediaPanelProps): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const notes: JSX.Element[] = [];
  if (vm.price.problem !== null) notes.push(<span key="price" class="cg-pvm__bad">{i18n.text(vm.price.problem)}</span>);
  else if (vm.allFree) notes.push(<span key="free" class="cg-pvm__bad">{i18n.t('preview.media.allFree')}</span>);
  if (vm.tags === 'loading')
    notes.push(
      <span key="tags" class="cg-pvm__wait-line">
        <Spinner />
        {i18n.t('preview.media.tagsLoading')}
      </span>,
    );
  // A warning, not a hold (2026-10-22): the picks go without tags; «Повторить» asks again.
  if (vm.tags === 'failed')
    notes.push(
      <span key="tags" class="cg-pvm__warn" data-cg-media-tags="failed">
        {i18n.t('preview.media.tagsFailed')}
        <Button label={i18n.t('preview.media.retry')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'RetryMedia', targetHandle: handle })} />
      </span>,
    );
  return notes.length === 0 ? null : <div class="cg-pvm__notes">{notes}</div>;
}

function Cell({ cell, handle, priced, step, mark }: { readonly cell: MediaCellVM; readonly handle: TargetHandle; readonly priced: boolean; readonly step: Step; readonly mark: string | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const fanTip = useTooltip(cell.fan === null ? null : i18n.t(`preview.media.fanTip.${cell.fan}`));
  const picked = cell.order !== null;
  const words = [
    typeWords(i18n, cell),
    cell.fan === null ? null : i18n.t(`preview.media.fan.${cell.fan}`),
    picked ? i18n.t('preview.media.pickedAria', { n: cell.order }) : null,
    picked ? i18n.t(cell.free ? 'preview.media.preview' : 'preview.media.locked') : null,
  ]
    .filter((word) => word !== null)
    .join(', ');
  return (
    <div class={`cg-pvm__cell${picked ? ' is-picked' : ''}${picked && cell.free ? ' is-preview' : ''}${cell.ready ? '' : ' is-wait'}`} data-cg-media={cell.id}>
      <button
        type="button"
        class="cg-pvm__pick"
        aria-pressed={cell.order !== null}
        aria-label={words}
        {...(cell.ready || cell.order !== null ? {} : { 'aria-disabled': 'true' as const })}
        onClick={() => {
          if (cell.ready || picked) void dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: cell.id, free: step === 'preview' });
        }}
      >
        {cell.thumb === null ? <span class="cg-pvm__blank">{typeWords(i18n, cell)}</span> : <img class="cg-pvm__img" src={cell.thumb} alt="" loading="lazy" decoding="async" draggable={false} />}
        {cell.type === 'video' || cell.type === 'audio' ? (
          <span class="cg-pvm__len cg-num" aria-hidden="true">
            {cell.type === 'video' ? <Icon name="play" size={12} /> : null}
            {duration(cell.duration)}
          </span>
        ) : cell.type === 'gif' ? (
          <span class="cg-pvm__len" aria-hidden="true">
            GIF
          </span>
        ) : null}
        {cell.order === null ? null : (
          <span class="cg-pvm__order cg-num" aria-hidden="true">
            {cell.order}
          </span>
        )}
        {cell.ready ? null : <span class="cg-pvm__wait">{i18n.t('preview.media.notReady')}</span>}
        {mark === null ? null : <span class="cg-pvm__strip">{mark}</span>}
      </button>
      {cell.fan === null ? null : (
        <span class={`cg-pvm__fan is-${cell.fan}`} {...fanTip.props} tabIndex={-1}>
          {i18n.t(`preview.media.fan.${cell.fan}`)}
        </span>
      )}
      {picked && cell.free ? (
        <span class="cg-pvm__mark is-preview" aria-hidden="true">
          {i18n.t('preview.media.preview')}
        </span>
      ) : picked && priced ? (
        <span class="cg-pvm__mark" aria-hidden="true">
          <Icon name="lock" size={12} />
        </span>
      ) : null}
    </div>
  );
}

/** A square of «Платное» or «Превью»: the pick's thumbnail and the «×» that takes it out. */
function Chosen({ pick, handle }: { readonly pick: MediaChosenVM; readonly handle: TargetHandle }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <span class="cg-pvm__sq" data-cg-chosen={pick.id}>
      {pick.thumb === null ? <span class="cg-pvm__blank">{typeWords(i18n, pick)}</span> : <img class="cg-pvm__img" src={pick.thumb} alt="" decoding="async" draggable={false} />}
      {pick.type === 'video' || pick.type === 'audio' ? (
        <span class="cg-pvm__len cg-num" aria-hidden="true">
          {duration(pick.duration)}
        </span>
      ) : null}
      <button
        type="button"
        class="cg-pvm__unpick"
        aria-label={`${i18n.t('preview.media.unpick')}: ${typeWords(i18n, pick)}`}
        // The same click as in the grid: a pick clicked again as what it is goes out.
        onClick={() => void dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: pick.id, free: pick.free })}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

/**
 * «Платное» or «Превью» (2026-10-24, the owner): its picks as small tiles, and the tile that makes the grid's clicks land
 * here — a click anywhere on the card does too. `next` — the paid media and their price are there: their preview is
 * what comes next. `children` — what its head carries on the right (the price of «Платное»).
 */
function Slot(props: {
  readonly slot: Step;
  readonly picks: readonly MediaChosenVM[];
  readonly on: boolean;
  readonly next: boolean;
  readonly handle: TargetHandle;
  readonly onSlot: (slot: Step) => void;
  readonly children?: JSX.Element;
}): JSX.Element {
  const { slot, picks, on, next, handle, onSlot, children } = props;
  const i18n = useI18n();
  const tip = useTooltip(i18n.t(slot === 'paid' ? 'preview.media.step.paidTooltip' : 'preview.media.step.previewTooltip'));
  const meta = slot === 'preview' ? i18n.t('preview.media.slot.free') : picks.length === 0 ? null : i18n.plural('preview.media.count', picks.length, { n: picks.length });
  return (
    <div class={`cg-pvm__slot${on ? ' is-on' : ''}${next ? ' is-next' : ''}`} data-cg-slot={slot} onClick={() => onSlot(slot)}>
      <div class="cg-pvm__slothead">
        <button type="button" class="cg-pvm__slotname" aria-pressed={on} {...tip.props}>
          <b>{i18n.t(slot === 'paid' ? 'preview.media.step.paid' : 'preview.media.preview')}</b>
          {meta === null ? null : <span>{meta}</span>}
          {tip.description}
        </button>
        {children}
      </div>
      <div class="cg-pvm__sqs">
        {picks.map((pick) => (
          <Chosen key={pick.id} pick={pick} handle={handle} />
        ))}
        <button type="button" class="cg-pvm__add" aria-pressed={on}>
          <span class="cg-pvm__plus" aria-hidden="true">
            +
          </span>
          {i18n.t(on ? 'preview.media.slot.pickInGrid' : 'preview.media.slot.add')}
        </button>
      </div>
    </div>
  );
}

/** Over the folders: «Платное» with its price, «Превью» — and, in a fan's preview, the panel's «×». */
function Slots({ vm, handle, variant, step, onStep }: MediaPanelProps & { readonly step: Step; readonly onStep: (step: Step) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const paid = vm.chosen.filter((pick) => !pick.free);
  const previews = vm.chosen.filter((pick) => pick.free);
  return (
    <div class="cg-pvm__slots">
      <Slot slot="paid" picks={paid} on={step === 'paid'} next={false} handle={handle} onSlot={onStep}>
        <label class="cg-pvm__price">
          <span>{i18n.t('preview.media.price')}</span>
          <TextField
            value={vm.price.text}
            label={i18n.t('preview.media.price')}
            placeholder={i18n.t('preview.media.pricePlaceholder')}
            maxLength={16}
            {...(vm.price.problem === null ? {} : { class: 'is-bad' })}
            onValue={(text) => void dispatch({ type: 'SetMediaPrice', targetHandle: handle, text })}
          />
        </label>
      </Slot>
      <Slot slot="preview" picks={previews} on={step === 'preview'} next={step === 'paid' && paid.length > 0 && vm.priced && previews.length === 0} handle={handle} onSlot={onStep} />
      {/* The window has its own «Закрыть Esc». */}
      {variant === 'window' ? null : <Button label={i18n.t('preview.media.close')} icon="x" iconOnly size="sm" variant="quiet" class="cg-pvm__close" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: false })} />}
    </div>
  );
}

/** The open panel: «Платное», the price, «Превью», the folders, the grid and what goes. */
function Panel({ vm, handle, variant, extra, clear, marks }: MediaPanelProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const gridRef = useRef<HTMLDivElement>(null);
  // Each opening starts at «Платное»: a preview is free to the fan, so it is never what a click picks unasked.
  const [step, setStep] = useState<Step>('paid');
  const { folders, grid } = vm;
  const onScroll = (): void => {
    const node = gridRef.current;
    // Near the end of what is shown: the next page, as the old desktop's grid did.
    if (node !== null && grid.hasMore && !grid.loading && grid.error === null && node.scrollTop + node.clientHeight >= node.scrollHeight - 120) {
      void dispatch({ type: 'LoadMoreMedia', targetHandle: handle, what: 'items' });
    }
  };
  return (
    <section class={`cg-pvm${variant === 'window' ? ' cg-pvm--window' : ''}`} aria-label={i18n.t('preview.media.label')} data-cg-media-panel="open">
      <Slots vm={vm} handle={handle} {...(variant === undefined ? {} : { variant })} step={step} onStep={setStep} />
      <div class="cg-pvm__head">
        <div class="cg-pvm__folders" role="tablist" aria-label={i18n.t('preview.media.label')}>
          {folders.items.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="tab"
              aria-selected={folder.selected}
              class={`cg-pvm__folder${folder.selected ? ' is-on' : ''}`}
              title={folder.count === null ? undefined : String(folder.count)}
              onClick={() => void dispatch({ type: 'ChooseMediaFolder', targetHandle: handle, folder: folder.id })}
            >
              {folder.name ?? i18n.t('preview.media.all')}
            </button>
          ))}
          {folders.hasMore && folders.error === null ? (
            <Button label={i18n.t('preview.media.foldersMore')} size="sm" variant="quiet" busy={folders.loading} onClick={() => void dispatch({ type: 'LoadMoreMedia', targetHandle: handle, what: 'folders' })} />
          ) : null}
        </div>
      </div>
      {folders.error !== null || grid.error !== null ? (
        <div class="cg-pvm__error">
          <ErrorCard error={(grid.error ?? folders.error) as NonNullable<typeof grid.error>} tone="state" copyCode={false} />
          <Button label={i18n.t('preview.media.retry')} size="sm" variant="line" onClick={() => void dispatch({ type: 'RetryMedia', targetHandle: handle })} />
        </div>
      ) : null}
      <div ref={gridRef} class={`cg-pvm__grid is-${step}`} onScroll={onScroll}>
        {grid.items.map((cell) => (
          <Cell key={cell.id} cell={cell} handle={handle} priced={vm.priced} step={step} mark={marks?.[cell.id] ?? null} />
        ))}
        {grid.loading ? (
          <div class="cg-pvm__note">
            <Spinner />
            {i18n.t('preview.media.loading')}
          </div>
        ) : grid.items.length === 0 && grid.error === null ? (
          <div class="cg-pvm__note">{i18n.t('preview.media.empty')}</div>
        ) : null}
      </div>
      <div class="cg-pvm__foot">
        <span class="cg-pvm__sum">{vm.summary === null ? i18n.t('preview.media.hint') : i18n.text(vm.summary)}</span>
        {vm.picks > 0 && clear !== false ? (
          <Button
            label={i18n.t('preview.media.clear')}
            size="sm"
            variant="quiet"
            onClick={() => {
              setStep('paid');
              void dispatch({ type: 'ClearMedia', targetHandle: handle });
            }}
          />
        ) : null}
        {extra ?? null}
      </div>
      <Notes vm={vm} handle={handle} />
    </section>
  );
}

/** Closed with picks: one line of what goes with the next part sent, to open the panel again or drop the picks. */
function Closed({ vm, handle }: MediaPanelProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div class="cg-pvm__line" data-cg-media-panel="closed">
      <Icon name="media" size={14} />
      <span class="cg-pvm__sum">
        {vm.summary === null ? null : <b>{i18n.text(vm.summary)}</b>} · {i18n.t('preview.media.attachedHint')}
      </span>
      <Button label={i18n.t('preview.media.button')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true })} />
      <Button label={i18n.t('preview.media.clear')} icon="x" iconOnly size="sm" variant="quiet" onClick={() => void dispatch({ type: 'ClearMedia', targetHandle: handle })} />
      <Notes vm={vm} handle={handle} />
    </div>
  );
}

const MediaView = (props: MediaPanelProps): JSX.Element => (props.vm.open || props.variant === 'window' ? <Panel {...props} /> : <Closed {...props} />);

const MEDIA_PANEL_CSS = `
.cg-pvm { display: flex; flex-direction: column; min-width: 0; border-top: 1px solid var(--cg-rule); }
.cg-pvm__head { display: flex; align-items: center; gap: 4px; padding: 6px 6px 4px 12px; }
.cg-pvm__folders { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.cg-pvm__folders::-webkit-scrollbar { display: none; }
.cg-pvm__folder {
  flex: none; max-width: 160px; height: 24px; padding: 0 9px; border: 1px solid var(--cg-rule); border-radius: 12px; background: var(--cg-surface);
  font: inherit; font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
}
.cg-pvm__folder:hover { color: var(--cg-ink-strong); }
.cg-pvm__folder.is-on { border-color: var(--cg-ink-strong); color: var(--cg-ink-strong); font-weight: 500; }
.cg-pvm__error { display: flex; align-items: center; gap: 6px; padding: 0 12px 4px; }
.cg-pvm__error > :first-child { flex: 1; min-width: 0; }
.cg-pvm__grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 2px 12px 6px 16px;
  max-height: 216px; overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain;
}
.cg-pvm__cell { position: relative; aspect-ratio: 1; min-width: 0; }
.cg-pvm__pick {
  position: absolute; inset: 0; display: block; padding: 0; border: 0; border-radius: 6px; overflow: hidden; cursor: pointer;
  background: var(--cg-rule); box-shadow: inset 0 0 0 1px var(--cg-rule);
}
.cg-pvm__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cg-pvm__blank { display: flex; align-items: center; justify-content: center; height: 100%; font-size: var(--cg-text-2xs); color: var(--cg-ink-muted); }
.cg-pvm__cell.is-picked .cg-pvm__pick { box-shadow: 0 0 0 2px var(--cg-ink-strong); }
.cg-pvm__cell.is-preview .cg-pvm__pick { box-shadow: 0 0 0 2px var(--cg-clay-ink); }
/* The ring a click would draw: the ink's behind the price, the clay's for a free preview. */
.cg-pvm__grid.is-paid .cg-pvm__cell:not(.is-picked, .is-wait) .cg-pvm__pick:hover { box-shadow: 0 0 0 2px var(--cg-ink-muted); }
.cg-pvm__grid.is-preview .cg-pvm__cell:not(.is-picked, .is-wait) .cg-pvm__pick:hover { box-shadow: 0 0 0 2px var(--cg-clay-ink); }
.cg-pvm__cell.is-wait .cg-pvm__pick { cursor: default; }
.cg-pvm__cell.is-wait .cg-pvm__img { opacity: .45; }
.cg-pvm__order {
  position: absolute; top: 4px; left: 4px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
  background: var(--cg-ink-strong); color: var(--cg-surface); font-size: var(--cg-text-2xs); font-weight: 600; line-height: 18px; text-align: center;
}
.cg-pvm__len {
  position: absolute; left: 4px; bottom: 4px; display: inline-flex; align-items: center; gap: 2px; padding: 0 4px; height: 16px; border-radius: 4px;
  background: rgb(0 0 0 / .6); color: #fff; font-size: var(--cg-text-2xs); line-height: 16px;
}
.cg-pvm__wait { position: absolute; inset: auto 0 0 0; padding: 2px 4px; background: rgb(0 0 0 / .6); color: #fff; font-size: var(--cg-text-2xs); text-align: center; }
.cg-pvm__fan {
  position: absolute; right: 4px; bottom: 4px; padding: 0 5px; height: 16px; border-radius: 4px; font-size: var(--cg-text-2xs); line-height: 16px;
  background: rgb(0 0 0 / .6); color: #fff; pointer-events: auto;
}
.cg-pvm__fan.is-paid { background: var(--cg-money); }
.cg-pvm__fan.is-unpaid { background: var(--cg-clay-ink); }
.cg-pvm__cell.is-preview .cg-pvm__order { background: var(--cg-clay-ink); }
.cg-pvm__mark {
  position: absolute; top: 4px; right: 4px; display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgb(0 0 0 / .6); color: #fff; font-size: var(--cg-text-2xs); pointer-events: none;
}
.cg-pvm__mark.is-preview { background: var(--cg-clay-ink); color: var(--cg-surface); font-weight: 600; }
.cg-pvm__note { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; min-height: 28px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-pvm__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 2px 8px 6px 16px; min-height: 32px; }
/*
 * «Платное» (its price on the right of its head) and «Превью» on top. The card the grid's clicks land in is lifted and
 * ringed — the ink's, the clay's for a preview: the clay is what goes free, as on the grid's tiles.
 */
.cg-pvm__slots { display: flex; align-items: stretch; gap: 8px; padding: 8px 6px 4px 12px; }
.cg-pvm__slot {
  flex: 3 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 7px 10px 9px; border-radius: 10px;
  box-shadow: inset 0 0 0 1px var(--cg-rule); cursor: pointer;
}
.cg-pvm__slot[data-cg-slot="preview"] { flex-grow: 2; }
.cg-pvm__slot:hover { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-pvm__slot.is-on { background: var(--cg-seg-on); box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
.cg-pvm__slot[data-cg-slot="preview"].is-on { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-pvm__slothead { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.cg-pvm__slotname {
  flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; padding: 0; border: 0; background: none; font: inherit;
  font-size: var(--cg-text-base); color: var(--cg-ink-muted); text-align: left; white-space: nowrap; cursor: pointer;
}
.cg-pvm__slotname b { font-weight: 600; color: var(--cg-ink-strong); }
.cg-pvm__slotname span { overflow: hidden; text-overflow: ellipsis; font-size: var(--cg-text-xs); }
.cg-pvm__slot[data-cg-slot="preview"] .cg-pvm__slotname b { color: var(--cg-clay-ink); }
.cg-pvm__sqs { display: flex; align-items: flex-end; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
.cg-pvm__sq { position: relative; flex: none; width: 42px; height: 56px; border-radius: 6px; overflow: hidden; background: var(--cg-rule); cursor: default; }
.cg-pvm__sq .cg-pvm__blank { font-size: var(--cg-text-2xs); }
.cg-pvm__sq .cg-pvm__len { left: 3px; bottom: 3px; height: 14px; padding: 0 3px; line-height: 14px; }
.cg-pvm__unpick {
  position: absolute; top: 3px; right: 3px; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  padding: 0; border: 0; border-radius: 9px; background: rgb(0 0 0 / .6); color: #fff; cursor: pointer;
}
.cg-pvm__unpick:hover { background: rgb(0 0 0 / .85); }
.cg-pvm__add {
  flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 84px; height: 56px;
  padding: 0 6px; border: 1px dashed var(--cg-rule-2); border-radius: 6px; background: none;
  font: inherit; font-size: var(--cg-text-xs); line-height: 1.2; color: var(--cg-ink-muted); text-align: center; text-wrap: balance; cursor: pointer;
}
.cg-pvm__plus { font-size: 18px; font-weight: 300; line-height: 1; }
.cg-pvm__slot:hover .cg-pvm__add { color: var(--cg-ink-2); }
.cg-pvm__slot.is-on .cg-pvm__add { border-style: solid; border-color: var(--cg-ink-muted); color: var(--cg-ink-strong); }
.cg-pvm__slot[data-cg-slot="preview"].is-on .cg-pvm__add, .cg-pvm__slot.is-next .cg-pvm__add { border-color: var(--cg-clay-ink); color: var(--cg-clay-ink); }
.cg-pvm__price { flex: none; display: inline-flex; align-items: center; gap: 8px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; cursor: default; }
.cg-pvm__price .cg-field { width: 92px; height: 28px; }
.cg-pvm__price .cg-field.is-bad { border-color: var(--cg-danger); }
.cg-pvm__slots .cg-pvm__close { align-self: flex-start; }
.cg-pvm__sum b { color: var(--cg-ink-strong); font-weight: 600; }
.cg-pvm__notes { flex-basis: 100%; display: flex; flex-direction: column; gap: 2px; padding: 0 12px 6px 16px; font-size: var(--cg-text-sm); }
.cg-pvm__line .cg-pvm__notes { padding: 0 0 4px; }
.cg-pvm__bad { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-danger); }
.cg-pvm__wait-line { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-muted); }
.cg-pvm__warn { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-warn-ink); }
/* «Рассылка»'s media window: every folder in sight, a large grid that fills the window, the price and «Для всей рассылки» at its foot. */
.cg-pvm--window { flex: 1; min-height: 0; border-top: 0; }
.cg-pvm--window .cg-pvm__head { align-items: flex-start; padding: 10px 12px 8px 20px; }
.cg-pvm--window .cg-pvm__folders { flex-wrap: wrap; overflow: visible; gap: 6px; }
.cg-pvm--window .cg-pvm__folder { max-width: 260px; height: 28px; padding: 0 12px; border-radius: 14px; font-size: var(--cg-text-sm2); }
.cg-pvm--window .cg-pvm__grid { flex: 1; min-height: 0; max-height: none; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; padding: 4px 20px 12px; align-content: start; }
.cg-pvm--window .cg-pvm__cell { aspect-ratio: 3 / 4; }
.cg-pvm--window .cg-pvm__order { top: 6px; left: 6px; min-width: 22px; height: 22px; border-radius: 11px; line-height: 22px; font-size: var(--cg-text-xs); }
.cg-pvm--window .cg-pvm__mark { top: 6px; right: 6px; height: 22px; padding: 0 8px; border-radius: 11px; font-size: var(--cg-text-xs); }
.cg-pvm--window .cg-pvm__foot { gap: 12px; padding: 10px 20px 10px 16px; border-top: 1px solid var(--cg-rule); background: var(--cg-sunk); min-height: 48px; }
.cg-pvm--window .cg-pvm__slots { gap: 12px; padding: 16px 20px 6px; }
.cg-pvm--window .cg-pvm__slot { gap: 10px; padding: 10px 14px 14px; border-radius: 12px; }
.cg-pvm--window .cg-pvm__slothead { min-height: 32px; }
.cg-pvm--window .cg-pvm__slotname { font-size: var(--cg-text-md); }
.cg-pvm--window .cg-pvm__sqs { gap: 8px; }
.cg-pvm--window .cg-pvm__sq { width: 60px; height: 80px; border-radius: 8px; }
.cg-pvm--window .cg-pvm__add { width: 104px; height: 80px; border-radius: 8px; font-size: var(--cg-text-sm); gap: 4px; }
.cg-pvm--window .cg-pvm__plus { font-size: 22px; }
.cg-pvm--window .cg-pvm__price { font-size: var(--cg-text-sm2); }
.cg-pvm--window .cg-pvm__price .cg-field { width: 108px; height: 32px; }
.cg-pvm__strip {
  position: absolute; left: 6px; right: 6px; bottom: 30px; height: 20px; border-radius: 5px; background: rgb(0 0 0 / .66); color: #fff;
  font-size: var(--cg-text-xs); line-height: 20px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* In the window's column a 100% basis is the window's whole height: the notes would push the grid out of sight. */
.cg-pvm--window .cg-pvm__notes { flex: none; padding: 0 20px 10px; background: var(--cg-sunk); }
`;

export const MEDIA_PANEL_STYLES: StyleSource = { id: 'cg-preview-media', css: MEDIA_PANEL_CSS };

export const mediaPanelPart: LazyPart<MediaPanelProps> = { view: MediaView, styles: [MEDIA_PANEL_STYLES] };
