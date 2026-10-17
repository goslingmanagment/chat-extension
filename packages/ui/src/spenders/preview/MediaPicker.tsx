// The media picker of a preview (decision X53; the old desktop's vault strip
// as the reference), its always-loaded half: the strip's toggle, the line
// that says what goes while the panel is closed, what is wrong with the picks,
// and «Отправить»'s words. The panel itself — folders, grid, price — is
// media-panel.tsx, a chunk of its own loaded on the first «Медиа» click.
// Nothing here sends: the picks go with the part whose «Отправить» the person
// clicks next. It renders MediaPickerVM and nothing else.

import { createContext, type JSX } from 'preact';
import { useContext } from 'preact/hooks';

import { type I18n, type MediaPickerVM, type TargetHandle } from '@cg/contracts/vm';

import { useLazyPart, type LazyPart, type PartLoader } from '../../dock/lazy-part';

import { Boundary, Button, Icon, Spinner, StripButton, useDispatch, useHints, useI18n } from '../../kit';
import { Notes, type MediaPanelProps } from './media-common';

/** What a part's «Отправить» takes along (MediaPickerVM.attached): SendRow reads it to say so on the button. */
export const MediaAttachedContext = createContext<MediaPickerVM['attached']>(null);
export const useMediaAttached = (): MediaPickerVM['attached'] => useContext(MediaAttachedContext);

/** «$25», «$24.99». */
export const priceText = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** «Отправить + 3 медиа за $25» / «Отправить + 2 медиа»; null — nothing goes along. */
export function sendWithMediaLabel(i18n: I18n, attached: MediaPickerVM['attached']): string | null {
  if (attached === null) return null;
  const media = i18n.plural('preview.media.count', attached.count, { n: attached.count });
  return attached.priceCents > 0 ? i18n.t('send.buttonMediaPaid', { media, price: priceText(attached.priceCents) }) : i18n.t('send.buttonMedia', { media });
}

/** The strip's toggle: the vault's icon, the number of picks, pressed while the panel is open. */
export function MediaToggle({ vm, handle }: { readonly vm: MediaPickerVM; readonly handle: TargetHandle }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  return (
    <span data-cg-strip="media" class="cg-pvb__slot cg-pvb__media">
      <StripButton
        label={i18n.t('preview.media.button')}
        class="cg-pvm__toggle"
        pressed={vm.open}
        tooltip={hints ? i18n.t('preview.media.buttonTooltip') : null}
        tabIndex={-1}
        leading={<Icon name="media" size={14} />}
        trailing={vm.picks > 0 ? <span class="cg-pvm__count cg-num">{vm.picks}</span> : null}
        onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: !vm.open })}
      />
    </span>
  );
}

/** The panel's chunk (the extension's lazy entry `preview-send` holds the same module). */
const loadPanel: PartLoader<MediaPanelProps> = () => import('./media-panel').then((module): LazyPart<MediaPanelProps> => module.mediaPanelPart);

/** The panel once its chunk is here; until then the line «Загружаю vault…». */
function LazyPanel(props: MediaPanelProps): JSX.Element {
  const i18n = useI18n();
  const part = useLazyPart(loadPanel);
  if (part === null)
    return (
      <div class="cg-pvm__line">
        <Spinner />
        <span class="cg-pvm__sum">{i18n.t('preview.media.loading')}</span>
      </div>
    );
  const View = part.view;
  return <View {...props} />;
}

/**
 * Under the strip: the panel while open; closed with picks — one line of what goes with the next part sent, to
 * open the panel again or drop the picks. Closed without picks — nothing (the strip's toggle opens it).
 */
export function MediaPicker({ vm, handle }: { readonly vm: MediaPickerVM; readonly handle: TargetHandle }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (vm.open)
    return (
      <Boundary surface={null}>
        <LazyPanel vm={vm} handle={handle} />
      </Boundary>
    );
  if (vm.picks === 0 || vm.summary === null) return null;
  return (
    <div class="cg-pvm__line" data-cg-media-panel="closed">
      <Icon name="media" size={14} />
      <span class="cg-pvm__sum">
        <b>{i18n.text(vm.summary)}</b> · {i18n.t('preview.media.attachedHint')}
      </span>
      <Button label={i18n.t('preview.media.button')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'SetMediaOpen', targetHandle: handle, open: true })} />
      <Button label={i18n.t('preview.media.clear')} icon="x" iconOnly size="sm" variant="quiet" onClick={() => void dispatch({ type: 'ClearMedia', targetHandle: handle })} />
      <Notes vm={vm} handle={handle} />
    </div>
  );
}

export const MEDIA_PICKER_CSS = `
.cg-pvb__media { margin-left: auto; }
.cg-pvm__toggle { padding: 0 7px; gap: 4px; }
.cg-pvm__count { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--cg-ink-strong); color: var(--cg-surface); font-size: var(--cg-text-2xs); line-height: 16px; text-align: center; }
.cg-pvm__sum { flex: 1; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); overflow-wrap: anywhere; }
.cg-pvm__sum b { color: var(--cg-ink-strong); font-weight: 600; }
.cg-pvm__notes { flex-basis: 100%; display: flex; flex-direction: column; gap: 2px; padding: 0 12px 6px 16px; font-size: var(--cg-text-sm); }
.cg-pvm__bad { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-danger); }
.cg-pvm__wait-line { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-muted); }
.cg-pvm__line {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 30px; padding: 2px 6px 2px 16px; border-top: 1px solid var(--cg-rule);
  color: var(--cg-ink-muted);
}
.cg-pvm__line .cg-pvm__notes { padding: 0 0 4px; }
`;
