// The archive feed of a preview (ui-design §4.16; architecture.md §6.7.5,
// D-27; SP-050, SP-053, NF-010): only what the hub archive holds. The chat is
// never opened and nothing is read from ChatSpace, so the feed never carries
// the fan's live text. Bubbles are the host's own colours: incoming left,
// ours right; attachments are captions, no media is loaded. Our newest
// message says whether the fan read it, when the site said so (read live, the
// chat still not opened). Older pages come
// by the server cursor when the person scrolls up (or presses «Показать более
// ранние»), and the place they were reading stays where it was. The scroll
// bookkeeping is one fan's: another fan's feed opens at its newest message.

import { type JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type FeedItemVM, type I18n, type Msg, type PreviewVM, type TargetHandle } from '@cg/contracts/vm';

import { Button, ErrorCard, Icon, Spinner, useDispatch, useI18n } from '../../kit';

/** How close to the top the scroll must be to ask for the older page. */
const OLDER_EDGE_PX = 48;
/** Within this distance from the end the feed counts as «at the bottom» and follows new messages. */
const BOTTOM_EDGE_PX = 24;

/** «23:15, $25, куплено»: the time and what the archive knows about the message, nothing else. */
function underline(i18n: I18n, item: FeedItemVM): { readonly text: string; readonly tip: string | null } {
  let text = item.at === null ? '' : i18n.formatTime(item.at);
  if (item.deleted) text += `, ${i18n.t('preview.feed.deleted')}`;
  if (item.automatic === true) text += i18n.t('preview.feed.automatic');
  if (item.price !== null && item.price.mills !== null) {
    const money = i18n.formatMoneyMills(item.price.mills, { zero: 'show' });
    text += i18n.t(item.price.purchased === true ? 'preview.feed.bought' : item.price.purchased === false ? 'preview.feed.notBought' : 'preview.feed.priced', { money });
  }
  // The tip is set in the income colour by the caller, so it stays a separate piece.
  const tip = item.tip !== null && item.tip > 0 ? i18n.formatMoneyMills(item.tip, { sign: 'plus' }) : null;
  return { text: text.replace(/^,\s*/, ''), tip };
}

/** «✓✓ прочитано (в 14:05)» / «✓ не прочитано»: whether the fan read our newest message, as the site says it. */
export function SeenMark({ seen }: { readonly seen: NonNullable<PreviewVM['seen']> }): JSX.Element {
  const i18n = useI18n();
  const words = !seen.read ? i18n.t('preview.seen.unread') : seen.readAt === null ? i18n.t('preview.seen.read') : i18n.t('preview.seen.readAt', { time: i18n.formatTime(seen.readAt) });
  return (
    <span class={`cg-seen${seen.read ? ' is-read' : ''}`} data-cg-seen={seen.read ? 'read' : 'unread'}>
      <Icon name={seen.read ? 'checks' : 'check'} size={13} />
      {words}
    </span>
  );
}

function Bubble({ item, seen }: { readonly item: FeedItemVM; readonly seen: PreviewVM['seen'] }): JSX.Element {
  const i18n = useI18n();
  const own = item.sender === 'model';
  const { text, tip } = underline(i18n, item);
  // «, чаевые +$50» with the amount in the income colour: the words around it come from the catalog.
  const tipWords = tip === null ? null : i18n.t('preview.feed.tip', { moneyIn: '\u0000' }).split('\u0000');
  const tipLead = tipWords === null ? '' : text === '' ? (tipWords[0] ?? '').replace(/^,\s*/, '') : (tipWords[0] ?? '');
  if (item.sender === 'system') {
    return (
      <div class="cg-feed__sys" data-cg-msg={item.id}>
        {item.text}
      </div>
    );
  }
  return (
    <div class={`cg-feed__msg${own ? ' is-own' : ''}${item.deleted ? ' is-deleted' : ''}`} data-cg-msg={item.id}>
      <span class="cg-sr">{own ? i18n.t('spenders.ourPrefix') : i18n.t('preview.feed.fanPrefix')} </span>
      {item.text}
      {item.attachments.map((caption, index) => (
        <span key={index} class="cg-feed__att">
          {caption}
        </span>
      ))}
      {text === '' && tip === null && seen === null ? null : (
        <small class="cg-num">
          {text}
          {tip === null ? null : (
            <>
              {tipLead}
              <span class="cg-money">{tip}</span>
              {tipWords?.[1] ?? ''}
            </>
          )}
          {seen === null ? null : <SeenMark seen={seen} />}
        </small>
      )}
    </div>
  );
}

export interface FeedProps {
  readonly handle: TargetHandle | null;
  readonly feed: PreviewVM['feed'];
  /** «Сообщений пока нет.» — shown instead of the bubbles. */
  readonly empty: Msg | null;
  readonly loading: boolean;
  /** Whether the fan read our newest message: the mark goes under that message's bubble. */
  readonly seen?: PreviewVM['seen'];
}

export function Feed({ handle, feed, empty, loading, seen = null }: FeedProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const scroller = useRef<HTMLDivElement>(null);
  const before = useRef<{ first: string | null; last: string | null; height: number; top: number; atBottom: boolean } | null>(null);
  const asked = useRef<string | null>(null);
  const owner = useRef(handle);
  const first = feed.items[0]?.id ?? null;
  const last = feed.items[feed.items.length - 1]?.id ?? null;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    if (owner.current !== handle) {
      // Another fan (J / K, ← →): where the last feed was scrolled to, and which page it asked for, mean nothing here.
      owner.current = handle;
      before.current = null;
      asked.current = null;
    }
    const previous = before.current;
    if (previous === null || previous.atBottom) {
      // The first paint, and while the end is in view — a new message, a mark under ours: the newest stays in view.
      node.scrollTop = node.scrollHeight;
    } else if (previous.first !== first && previous.last === last) {
      // An older page arrived above: what the person was reading does not jump.
      node.scrollTop = previous.top + (node.scrollHeight - previous.height);
    }
    before.current = { first, last, height: node.scrollHeight, top: node.scrollTop, atBottom: node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_EDGE_PX };
  });

  // The feed's box shrinks under it (a line above it, the result or the media under it came later): a feed at its end
  // stays there, the newest message never slides out under the composer.
  useLayoutEffect(() => {
    const node = scroller.current;
    const view = node?.ownerDocument.defaultView;
    if (node === null || view === null || view === undefined || typeof view.ResizeObserver !== 'function') return undefined;
    const observer = new view.ResizeObserver(() => {
      if (before.current?.atBottom === true) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const loadOlder = (): void => {
    if (handle === null || !feed.hasOlder || feed.loadingOlder || first === null) return;
    if (asked.current === first) return;
    asked.current = first;
    void dispatch({ type: 'LoadOlder', targetHandle: handle });
  };

  return (
    <div
      ref={scroller}
      class="cg-feed"
      role="log"
      aria-label={i18n.t('preview.feed.label')}
      tabIndex={0}
      onScroll={(event) => {
        const node = event.currentTarget;
        const state = before.current;
        if (state !== null) {
          state.top = node.scrollTop;
          state.height = node.scrollHeight;
          state.atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_EDGE_PX;
        }
        if (node.scrollTop <= OLDER_EDGE_PX) loadOlder();
      }}
    >
      {feed.olderError !== null ? (
        <div class="cg-feed__older">
          <ErrorCard error={feed.olderError} tone="failure" inline>
            <Button
              label={i18n.t('common.retry')}
              variant="line"
              onClick={() => {
                asked.current = null;
                loadOlder();
              }}
            />
          </ErrorCard>
        </div>
      ) : feed.loadingOlder ? (
        <div class="cg-feed__older" role="status">
          <Spinner label={i18n.t('common.loading')} />
        </div>
      ) : feed.hasOlder && feed.items.length > 0 ? (
        <div class="cg-feed__older">
          <Button label={i18n.t('preview.feed.older')} variant="quiet" size="sm" onClick={loadOlder} />
        </div>
      ) : null}
      {loading && feed.items.length === 0 ? (
        <div class="cg-feed__empty" role="status">
          <Spinner label={i18n.t('common.loading')} />
        </div>
      ) : null}
      {feed.items.length === 0 && empty !== null ? <div class="cg-feed__empty">{i18n.text(empty)}</div> : null}
      {feed.items.flatMap((item) => [
        item.dayBreak && item.at !== null ? (
          <div key={`day:${item.id}`} class="cg-feed__day">
            {i18n.formatTime(item.at, 'day')}
          </div>
        ) : null,
        <Bubble key={item.id} item={item} seen={seen !== null && seen.inFeed && seen.messageId === item.id ? seen : null} />,
      ])}
    </div>
  );
}

export const FEED_CSS = `
.cg-feed {
  flex: 1 1 120px; min-height: 84px; overflow-y: auto; padding: 8px 16px 10px; display: flex; flex-direction: column; gap: 6px;
  scrollbar-width: thin; overscroll-behavior: contain; background: var(--cg-feed-bg);
}
.cg-feed:focus-visible { outline-offset: -2px; }
.cg-feed__day, .cg-feed__sys { align-self: center; font-size: var(--cg-text-xs); line-height: 18px; color: var(--cg-ink-muted); margin: 6px 0 2px; text-align: center; }
/* The day of what is in view stays at the top of the feed: «22:14» is never read as today's when it was yesterday's. */
.cg-feed__day {
  position: sticky; top: -2px; z-index: 1; padding: 0 10px; border-radius: var(--cg-r-pill); background: var(--cg-surface);
  box-shadow: 0 0 0 1px var(--cg-rule);
}
.cg-feed__msg {
  max-width: 82%; padding: 6px 10px; border-radius: var(--cg-r-xl); font-size: var(--cg-text-base); line-height: 18px;
  background: var(--cg-chat-in); color: var(--cg-ink); overflow-wrap: anywhere; white-space: pre-wrap;
}
.cg-feed__msg.is-own { align-self: flex-end; background: var(--cg-chat-out); }
.cg-feed__msg.is-deleted { color: var(--cg-ink-muted); }
.cg-feed__msg small { display: block; font-size: var(--cg-text-xs); line-height: 18px; color: var(--cg-ink-muted); margin-top: 2px; white-space: normal; }
.cg-feed__msg .cg-money { font-weight: 600; }
.cg-seen { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; vertical-align: -2px; }
:is(small, .cg-pv__meta) > .cg-seen { margin-left: 8px; }
.cg-seen.is-read { color: var(--cg-good-ink); }
.cg-feed__att { display: block; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-feed__empty { align-self: center; margin: auto 0; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); text-align: center; max-width: 30ch; }
.cg-feed__older { align-self: center; display: flex; justify-content: center; min-height: 22px; }
`;
