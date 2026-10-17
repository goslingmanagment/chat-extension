// What the media picker's two halves share (decision X53): the always-loaded
// MediaPicker.tsx and the panel's own chunk, media-panel.tsx, which MediaPicker
// loads — so the panel never imports MediaPicker back.

import { type JSX } from 'preact';

import { type I18n, type MediaCellVM, type MediaPickerVM, type TargetHandle } from '@cg/contracts/vm';

import { Button, Spinner, useDispatch, useI18n } from '../../kit';

export interface MediaPanelProps {
  readonly vm: MediaPickerVM;
  readonly handle: TargetHandle;
}

export const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const TYPE_KEYS = { photo: 'preview.media.type.photo', video: 'preview.media.type.video', gif: 'preview.media.type.anim', audio: 'preview.media.type.audio' } as const;

export function typeWords(i18n: I18n, cell: MediaCellVM): string {
  return i18n.t(TYPE_KEYS[cell.type], { duration: duration(cell.duration) });
}

/** What is wrong with the picks, under the panel or under the strip. */
export function Notes({ vm, handle }: { readonly vm: MediaPickerVM; readonly handle: TargetHandle }): JSX.Element | null {
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
  if (vm.tags === 'failed')
    notes.push(
      <span key="tags" class="cg-pvm__bad">
        {i18n.t('preview.media.tagsFailed')}
        <Button label={i18n.t('preview.media.retry')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'RetryMedia', targetHandle: handle })} />
      </span>,
    );
  return notes.length === 0 ? null : <div class="cg-pvm__notes">{notes}</div>;
}

