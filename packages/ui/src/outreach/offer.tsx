// The offer of «Рассылка»: the common text every fan's version is written from and — only if wanted — the media that go
// with every version (behind a price, a free preview first). On the right while no fan is chosen; in the head, as a
// plate, while one is (what the outreach sells, and «Изменить» back to it). Text alone is a whole offer: the media part
// stays a quiet «+ Добавить медиа» until asked for.

import { type JSX } from 'preact';

import { OUTREACH_MEDIA_HANDLE, type OutreachMediaVM, type OutreachMediumVM, type OutreachWindowVM, type UiAction } from '@cg/contracts/vm';

import { Button, Icon, TextField, useDispatch, useI18n } from '../kit';
import { priceText } from '../spenders/preview/MediaPicker';
import { clock, mediaTitle, mediumWords } from './words';

/** The site's sheet of the offer's media: its vault picker, or «Из постов» (the page's «Copied …» list). */
export const openMediaSheet = (vm: Pick<OutreachWindowVM, 'posts'>): UiAction =>
  vm.posts !== null ? { type: 'SetOutreach', sheet: true } : { type: 'SetMediaOpen', targetHandle: OUTREACH_MEDIA_HANDLE, open: true };

/** A medium as a picture: its thumbnail where the site gave one, else its kind in words on a neutral block. */
export function Thumb({ item, size, children }: { readonly item: OutreachMediumVM | null; readonly size: 'xs' | 'sm' | 'md' | 'lg' | 'bt'; readonly children?: JSX.Element | (JSX.Element | null)[] | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <span class={`cg-ow__thumb is-${size}${item?.free === true ? ' is-free-ring' : ''}`}>
      {item !== null && item.thumb !== null ? <img src={item.thumb} alt="" loading="lazy" decoding="async" draggable={false} referrerpolicy="no-referrer" /> : item === null ? null : <span class="cg-ow__blank">{mediumWords(i18n, item)}</span>}
      {children ?? null}
    </span>
  );
}

/** «▸ 6:12» on a video's picture. */
export function Length({ item }: { readonly item: OutreachMediumVM }): JSX.Element | null {
  if (item.type !== 'video' && item.type !== 'audio') return null;
  return (
    <span class="cg-ow__len cg-num" aria-hidden="true">
      {item.type === 'video' ? <Icon name="play" size={12} /> : null}
      {clock(item.duration)}
    </span>
  );
}

/** The pictures of an offer in small: the previews, then the paid media with a lock; a post's bundle as a lock. */
export function Thumbs({ media, size }: { readonly media: OutreachMediaVM; readonly size: 'xs' | 'sm' | 'md' }): JSX.Element {
  const shown = media.items.slice(0, size === 'md' ? 4 : 2);
  return (
    <span class="cg-ow__thumbs" aria-hidden="true">
      {shown.map((item) => (
        <Thumb key={item.id} item={item} size={size}>
          {!item.free && media.priceCents > 0 ? (
            <span class="cg-ow__mini">
              <Icon name="lock" size={12} />
            </span>
          ) : null}
          {size === 'md' ? <Length item={item} /> : null}
        </Thumb>
      ))}
      {media.items.length === 0
        ? Array.from({ length: Math.min(media.posts, 2) }, (_, index) => (
            <Thumb key={`post-${index}`} item={null} size={size}>
              <span class="cg-ow__mini">
                <Icon name="lock" size={12} />
              </span>
            </Thumb>
          ))
        : null}
    </span>
  );
}

/** The head's plate: what the outreach sells and its text, «Изменить» back to the offer. */
export function OfferPlate({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const title = vm.media === null ? i18n.t('outreach.offer.textOnly') : mediaTitle(i18n, vm.media);
  return (
    <button type="button" class="cg-ow__offer" title={i18n.t('outreach.offer.plateTooltip')} onClick={() => void dispatch({ type: 'SetOutreach', pane: 'offer' })}>
      {vm.media === null ? (
        <span class="cg-ow__glyph" aria-hidden="true">
          “
        </span>
      ) : (
        <Thumbs media={vm.media} size="xs" />
      )}
      <span class="cg-ow__otext">
        <span class="cg-ow__otitle">{title}</span>
        <span class="cg-ow__osub">{vm.text.trim() === '' ? '—' : vm.text}</span>
      </span>
      <span class="cg-btn cg-btn--quiet cg-btn--sm cg-ow__ochange">{i18n.t('outreach.offer.change')}</span>
    </button>
  );
}

/** The offer's media as large pictures with their words: «Фото — бесплатно, первым», «Видео 6:12 — за $25». */
function Tiles({ media }: { readonly media: OutreachMediaVM }): JSX.Element {
  const i18n = useI18n();
  const paid = media.priceCents > 0;
  let firstPaid = true;
  return (
    <div class="cg-ow__tiles">
      {media.items.map((item) => {
        const free = item.free || !paid;
        const lead = !free && firstPaid;
        if (!free) firstPaid = false;
        return (
          <span key={item.id} class="cg-ow__tile">
            <Thumb item={item} size="lg">
              {item.free && paid ? <span class="cg-ow__free">{i18n.t('outreach.media.preview')}</span> : null}
              {!free ? (
                <span class="cg-ow__lock">
                  <Icon name="lock" size={12} />
                  {lead ? priceText(media.priceCents) : null}
                </span>
              ) : null}
              <Length item={item} />
            </Thumb>
            <span class="cg-ow__tcap">
              <b>{mediumWords(i18n, item)}</b>
              {free ? i18n.t(paid ? 'outreach.media.freeFirst' : 'outreach.media.free') : lead ? i18n.t('outreach.media.forPrice', { price: priceText(media.priceCents) }) : i18n.t('outreach.media.samePurchase')}
            </span>
          </span>
        );
      })}
      {Array.from({ length: media.items.length === 0 ? media.posts : 0 }, (_, index) => (
        <span key={`post-${index}`} class="cg-ow__tile">
          <Thumb item={null} size="lg">
            <span class="cg-ow__lock">
              <Icon name="lock" size={12} />
            </span>
            <span class="cg-ow__blank">{i18n.t('outreach.media.post')}</span>
          </Thumb>
          <span class="cg-ow__tcap">
            <b>{i18n.t('outreach.media.post')}</b>
            {i18n.t('outreach.media.postPrice')}
          </span>
        </span>
      ))}
    </div>
  );
}

/** «Предложение»: the common text and the media of every fan's version. */
export function Offer({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const count = vm.audience.count;
  const media = vm.media;
  const bought = vm.aside.filter((row) => row.aside?.[0]?.kind === 'bought').map((row) => row.name);
  return (
    <section class="cg-ow__ocard" aria-label={i18n.t('outreach.offer.title')}>
      <header class="cg-ow__ohead">
        <span class={`cg-ow__oicon${media === null ? '' : ' is-media'}`} aria-hidden="true">
          {media === null ? <span class="cg-ow__q">“</span> : <Thumbs media={media} size="sm" />}
        </span>
        <div class="cg-nc__who">
          <h3 class="cg-nc__name">{i18n.t('outreach.offer.title')}</h3>
          <div class="cg-nc__meta">{i18n.plural(media === null ? 'outreach.offer.metaText' : 'outreach.offer.metaMedia', count)}</div>
        </div>
      </header>
      <div class="cg-ow__obody">
        <div class="cg-ow__sec">
          <div class="cg-ow__label">
            {i18n.t('outreach.offer.text')}
            <span>{i18n.t('outreach.offer.textLang')}</span>
          </div>
          <TextField
            value={vm.text}
            label={i18n.t('outreach.offer.text')}
            placeholder={i18n.t('outreach.offer.placeholder')}
            multiline
            minHeight={132}
            maxHeight={240}
            maxLength={vm.maxChars}
            class="cg-ow__text"
            onValue={(text) => void dispatch({ type: 'SetOutreach', text })}
          />
          <div class="cg-ow__hint">{vm.textChangedAt === null ? i18n.t('outreach.offer.hint') : i18n.t('outreach.offer.changed', { time: { time: vm.textChangedAt } })}</div>
        </div>
        {media !== null ? (
          <div class="cg-ow__sec">
            <div class="cg-ow__label">
              {i18n.t('outreach.offer.media')}
              <span>{i18n.t('outreach.offer.mediaAll')}</span>
              <span class="cg-nw__grow" />
              <Button label={i18n.t('outreach.offer.remove')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearOutreachMedia' })} />
              <Button label={i18n.t('outreach.offer.change')} variant="line" size="sm" class="cg-ow__mchange" onClick={() => void dispatch(openMediaSheet(vm))} />
            </div>
            <Tiles media={media} />
            {media.problem === null ? null : <div class="cg-ow__bad">{i18n.text(media.problem)}</div>}
            {bought.length === 0 ? null : <div class="cg-ow__hint">{i18n.plural('outreach.offer.bought', bought.length, { names: bought.slice(0, 3).join(', ') })}</div>}
          </div>
        ) : vm.canPickMedia ? (
          <div class="cg-ow__addrow">
            <Button label={i18n.t('outreach.offer.addMedia')} variant="quiet" size="sm" class="cg-ow__addmedia" onClick={() => void dispatch(openMediaSheet(vm))} />
            <span class="cg-ow__hint">{i18n.t(vm.posts !== null ? 'outreach.offer.addPostsHint' : 'outreach.offer.addMediaHint')}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
