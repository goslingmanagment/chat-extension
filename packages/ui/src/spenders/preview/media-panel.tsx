// The media panel of a preview (decision X53): the vault's folders as chips,
// one folder's media as a grid of thumbnails, the picks numbered in the order
// of the clicks, a free-preview mark on a pick of a priced message, what the
// fan already got of a medium, the price and what goes — and, once closed with
// picks, the one line of what goes with the next part sent. A chunk of its own
// (MediaPicker.tsx loads it on the first «Медиа» click; the extension's lazy
// entry `preview-send`): Spenders, «Новые» and the preview window carry only
// the toggle. Nothing here sends.

import { type JSX } from 'preact';
import { useRef } from 'preact/hooks';

import { type I18n, type MediaCellVM, type MediaPickerVM, type TargetHandle } from '@cg/contracts/vm';

import { type LazyPart } from '../../dock/lazy-part';
import { Button, ErrorCard, Icon, Spinner, TextField, useDispatch, useI18n, useTooltip, type StyleSource } from '../../kit';

export interface MediaPanelProps {
  readonly vm: MediaPickerVM;
  readonly handle: TargetHandle;
  /** `window` — «Рассылка»'s own media window: the folders wrap, the grid is large and fills the window. */
  readonly variant?: 'window';
}

const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const TYPE_KEYS = { photo: 'preview.media.type.photo', video: 'preview.media.type.video', gif: 'preview.media.type.anim', audio: 'preview.media.type.audio' } as const;

function typeWords(i18n: I18n, cell: MediaCellVM): string {
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

function Cell({ cell, handle, priced }: { readonly cell: MediaCellVM; readonly handle: TargetHandle; readonly priced: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const fanTip = useTooltip(cell.fan === null ? null : i18n.t(`preview.media.fanTip.${cell.fan}`));
  const freeTip = useTooltip(i18n.t(cell.free ? 'preview.media.freeTooltip' : 'preview.media.lockedTooltip'));
  const words = [typeWords(i18n, cell), cell.fan === null ? null : i18n.t(`preview.media.fan.${cell.fan}`), cell.order === null ? null : i18n.t('preview.media.pickedAria', { n: cell.order })]
    .filter((word) => word !== null)
    .join(', ');
  return (
    <div class={`cg-pvm__cell${cell.order === null ? '' : ' is-picked'}${cell.ready ? '' : ' is-wait'}`} data-cg-media={cell.id}>
      <button
        type="button"
        class="cg-pvm__pick"
        aria-pressed={cell.order !== null}
        aria-label={words}
        {...(cell.ready || cell.order !== null ? {} : { 'aria-disabled': 'true' as const })}
        onClick={() => {
          if (cell.ready || cell.order !== null) void dispatch({ type: 'PickMedia', targetHandle: handle, mediaId: cell.id });
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
      </button>
      {cell.fan === null ? null : (
        <span class={`cg-pvm__fan is-${cell.fan}`} {...fanTip.props} tabIndex={-1}>
          {i18n.t(`preview.media.fan.${cell.fan}`)}
        </span>
      )}
      {cell.order !== null && priced ? (
        <button
          type="button"
          class={`cg-pvm__free${cell.free ? ' is-free' : ''}`}
          aria-pressed={cell.free}
          {...freeTip.props}
          onClick={() => void dispatch({ type: 'ToggleMediaFree', targetHandle: handle, mediaId: cell.id })}
        >
          {cell.free ? i18n.t('preview.media.free') : <Icon name="lock" size={12} />}
          {cell.free ? null : <span class="cg-pvm__sr">{i18n.t('preview.media.locked')}</span>}
        </button>
      ) : null}
    </div>
  );
}

/** The open panel: folders, the grid, the price and what goes. */
function Panel({ vm, handle, variant }: MediaPanelProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const gridRef = useRef<HTMLDivElement>(null);
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
        {/* The window has its own «Закрыть Esc». */}
        {variant === 'window' ? null : <Button label={i18n.t('preview.media.close')} icon="x" iconOnly size="sm" variant="quiet" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: false })} />}
      </div>
      {folders.error !== null || grid.error !== null ? (
        <div class="cg-pvm__error">
          <ErrorCard error={(grid.error ?? folders.error) as NonNullable<typeof grid.error>} tone="state" copyCode={false} />
          <Button label={i18n.t('preview.media.retry')} size="sm" variant="line" onClick={() => void dispatch({ type: 'RetryMedia', targetHandle: handle })} />
        </div>
      ) : null}
      <div ref={gridRef} class="cg-pvm__grid" onScroll={onScroll}>
        {grid.items.map((cell) => (
          <Cell key={cell.id} cell={cell} handle={handle} priced={vm.priced} />
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
        <span class="cg-pvm__sum">{vm.summary === null ? i18n.t('preview.media.hint') : i18n.text(vm.summary)}</span>
        {vm.picks > 0 ? <Button label={i18n.t('preview.media.clear')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'ClearMedia', targetHandle: handle })} /> : null}
        <OutreachMediaButton vm={vm} handle={handle} />
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
      <OutreachMediaButton vm={vm} handle={handle} />
      <Button label={i18n.t('preview.media.clear')} icon="x" iconOnly size="sm" variant="quiet" onClick={() => void dispatch({ type: 'ClearMedia', targetHandle: handle })} />
      <Notes vm={vm} handle={handle} />
    </div>
  );
}

/** «Рассылка» open: these picks go to every fan of the outreach («Для всей рассылки»), or already are its media. */
function OutreachMediaButton({ vm, handle }: MediaPanelProps): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (vm.outreach === undefined) return null;
  if (vm.outreach === 'set') return <span class="cg-pvm__or" data-cg-outreach-media="set">{i18n.t('outreach.media.set')}</span>;
  return <Button label={i18n.t('outreach.media.take')} size="sm" variant="line" class="cg-pvm__or" tooltip={i18n.t('outreach.media.takeTooltip')} onClick={() => void dispatch({ type: 'SetOutreachMedia', targetHandle: handle })} />;
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
.cg-pvm__free {
  position: absolute; top: 4px; right: 4px; display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border: 0; border-radius: 9px;
  background: rgb(0 0 0 / .6); color: #fff; font: inherit; font-size: var(--cg-text-2xs); cursor: pointer;
}
.cg-pvm__free.is-free { background: var(--cg-surface); color: var(--cg-ink-strong); box-shadow: 0 0 0 1px var(--cg-ink-strong); font-weight: 500; }
.cg-pvm__sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.cg-pvm__note { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; min-height: 28px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-pvm__foot { display: flex; align-items: center; gap: 8px; padding: 2px 8px 6px 16px; min-height: 32px; }
.cg-pvm__price { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-pvm__price .cg-field { width: 92px; height: 26px; }
.cg-pvm__price .cg-field.is-bad { border-color: var(--cg-danger); }
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
.cg-pvm--window .cg-pvm__free { top: 6px; right: 6px; height: 22px; padding: 0 8px; border-radius: 11px; font-size: var(--cg-text-xs); }
.cg-pvm--window .cg-pvm__foot { gap: 12px; padding: 10px 20px; border-top: 1px solid var(--cg-rule); background: var(--cg-sunk); min-height: 48px; }
.cg-pvm--window .cg-pvm__price .cg-field { width: 150px; height: 30px; }
.cg-pvm--window .cg-pvm__foot .cg-pvm__or { margin-left: auto; }
/* In the window's column a 100% basis is the window's whole height: the notes would push the grid out of sight. */
.cg-pvm--window .cg-pvm__notes { flex: none; padding: 0 20px 10px; background: var(--cg-sunk); }
`;

export const MEDIA_PANEL_STYLES: StyleSource = { id: 'cg-preview-media', css: MEDIA_PANEL_CSS };

export const mediaPanelPart: LazyPart<MediaPanelProps> = { view: MediaView, styles: [MEDIA_PANEL_STYLES] };
