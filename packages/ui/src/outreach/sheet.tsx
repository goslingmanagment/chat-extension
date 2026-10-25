// The media sheet of «Рассылка», over its window (the same on both sites): the outreach's media — every fan's version
// takes them — or one fan's own («только ему — остальные получат общие»). The site's vault picker (X53: «Платное» with
// its price, «Превью», the folders, the grid) where the site has one; «Из постов» — the bundles and media copied in the
// model's posts — where the site sends those. What the sheet holds is the outreach's at once; «Готово» closes it.

import { type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { OUTREACH_MEDIA_HANDLE, type OutreachPostsVM, type OutreachWindowVM, type PreviewVM, type UiAction } from '@cg/contracts/vm';

import { Button, CheckGlyph, Icon, Spinner, useDispatch, useI18n } from '../kit';
import { MediaPicker } from '../spenders/preview/MediaPicker';
import { mediaSummary } from './words';

/** «Из постов»: the page's «Copied …» list, each item picked or not; how to fill it when it is empty. */
function Posts({ posts }: { readonly posts: OutreachPostsVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const unchecked = posts.state === 'unchecked' && posts.items.some((item) => item.contentType === 1);
  return (
    <div class="cg-ow__posts">
      {posts.items.length === 0 ? (
        <div class="cg-ow__pempty">
          {posts.state === 'reading' ? <Spinner /> : <Icon name="media" />}
          <span>{i18n.t(posts.state === 'reading' ? 'outreach.posts.reading' : 'outreach.posts.empty')}</span>
        </div>
      ) : (
        <div class="cg-ow__pgrid" role="group" aria-label={i18n.t('outreach.posts.title')}>
          {posts.items.map((item) => {
            const kind = i18n.t(item.contentType === 2 ? 'outreach.posts.bundle' : 'outreach.posts.media');
            return (
              <button
                key={`${item.contentType}:${item.contentId}`}
                type="button"
                role="checkbox"
                class={`cg-ow__pcell${item.picked ? ' is-on' : ''}`}
                aria-checked={item.picked ? 'true' : 'false'}
                aria-label={`${kind} ${item.contentId}`}
                title={i18n.t('outreach.posts.tooltip', { kind, id: item.contentId })}
                data-cg-copied={item.contentType === 2 ? 'bundle' : 'media'}
                onClick={() => void dispatch({ type: 'SetOutreach', post: { contentType: item.contentType, contentId: item.contentId, picked: !item.picked } })}
              >
                <span class="cg-ow__pthumb">
                  <Icon name="lock" size={14} />
                </span>
                <span class="cg-ow__pwords">
                  <b>{kind}</b>
                  <span class="cg-num">··{item.contentId.slice(-4)}</span>
                </span>
                <CheckGlyph on={item.picked} size={14} />
              </button>
            );
          })}
        </div>
      )}
      <div class="cg-ow__phint">
        {unchecked ? i18n.t('outreach.posts.unchecked') : i18n.t('outreach.posts.hint')}
        <Button label={i18n.t('outreach.posts.refresh')} icon="refresh" variant="quiet" size="sm" busy={posts.state === 'reading'} onClick={() => void dispatch({ type: 'SetOutreach', refresh: true })} />
      </div>
    </div>
  );
}

export function MediaSheet({ vm, preview }: { readonly vm: OutreachWindowVM; readonly preview: PreviewVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const sheetRef = useRef<HTMLDivElement>(null);
  // One fan's own sheet is their card's picker; the outreach's is its own.
  const fan = vm.sheet === null && preview.media?.open === true && vm.card !== null ? vm.card : null;
  const picker = fan !== null ? preview.media : vm.picker;
  const handle = fan !== null ? fan.handle : OUTREACH_MEDIA_HANDLE;
  const close: UiAction = vm.sheet === 'posts' ? { type: 'SetOutreach', sheet: false } : { type: 'SetMediaOpen', targetHandle: handle, open: false };
  const blocked = picker !== null && picker.price.problem !== null;

  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [vm.sheet, fan?.handle]);

  if (vm.sheet === null && fan === null) return null;
  const bought = vm.aside.filter((row) => row.aside?.[0]?.kind === 'bought').map((row) => row.name);
  const marks: Record<string, string> = {};
  // «1 из 8 уже купил» on the paid medium the outreach's buyers already have.
  if (fan === null && bought.length > 0 && vm.media !== null) {
    const pool = vm.audience.count + bought.length;
    for (const item of vm.media.items) if (!item.free && vm.media.priceCents > 0) marks[item.id] = i18n.plural('outreach.sheet.bought', bought.length, { of: pool });
  }
  return (
    <>
      <div class="cg-ow__veil" onPointerDown={() => void dispatch(close)} />
      <div
        class="cg-ow__sheet"
        role="dialog"
        aria-label={fan === null ? i18n.t('outreach.sheet.title') : i18n.t('outreach.sheet.fanTitle', { name: fan.name })}
        ref={sheetRef}
        data-cg-outreach-sheet={vm.sheet ?? 'fan'}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || blocked) return;
          event.preventDefault();
          event.stopPropagation();
          void dispatch(close);
        }}
      >
        <div class="cg-ow__shead">
          <span class="cg-ow__stitle">{fan === null ? i18n.t(vm.sheet === 'posts' ? 'outreach.posts.title' : 'outreach.sheet.title') : i18n.t('outreach.sheet.fanTitle', { name: fan.name })}</span>
          <span class="cg-ow__ssub">{i18n.t(fan === null ? 'outreach.sheet.sub' : 'outreach.sheet.fanSub')}</span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('common.close')} variant="quiet" size="sm" hotkey="Esc" reason={blocked ? i18n.t('outreach.sheet.fixPrice') : null} onClick={() => void dispatch(close)} />
        </div>
        {vm.sheet === 'posts' && vm.posts !== null ? (
          <>
            <Posts posts={vm.posts} />
            <div class="cg-ow__sfoot">
              <span class="cg-ow__sum">{vm.media === null ? i18n.t('outreach.sheet.nothing') : <b>{mediaSummary(i18n, vm.media)}</b>}</span>
              {vm.media === null ? null : <Button label={i18n.t('outreach.sheet.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearOutreachMedia' })} />}
              <Button label={i18n.t('outreach.sheet.done')} variant="line" size="sm" class="cg-ow__main" onClick={() => void dispatch(close)} />
            </div>
          </>
        ) : picker !== null ? (
          <MediaPicker
            vm={picker}
            handle={handle}
            variant="window"
            clear={false}
            marks={marks}
            extra={
              <>
                {fan === null ? (
                  vm.media === null ? null : <Button label={i18n.t('outreach.sheet.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearOutreachMedia' })} />
                ) : (
                  <Button label={i18n.t('outreach.card.common')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ResetOutreachMedia', targetHandle: fan.handle })} />
                )}
                <Button label={i18n.t('outreach.sheet.done')} variant="line" size="sm" class="cg-ow__main" reason={blocked ? i18n.t('outreach.sheet.fixPrice') : null} onClick={() => void dispatch(close)} />
              </>
            }
          />
        ) : (
          <div class="cg-ow__pempty">
            <Spinner />
            <span>{i18n.t('preview.media.loading')}</span>
          </div>
        )}
      </div>
    </>
  );
}
