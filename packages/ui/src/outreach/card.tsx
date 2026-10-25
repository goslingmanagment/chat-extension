// The chosen fan's card of «Рассылка», chat-like: the fan's conversation from the hub's archive (the chat is never
// opened), and under it — where the next message would stand — their version in the draft look (dashed terracotta,
// warm fill, serif: never like a sent bubble) with what goes with it, «Ещё раз», «Править» and the blue «Отправить →».
// Once it went, it is a real bubble of the conversation («✓ отправлено из рассылки») and the zone says what went and
// which version waits next. One click, one message; an unknown outcome is never sent again by our button.

import { type JSX } from 'preact';
import { useRef } from 'preact/hooks';

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type I18n, type OutreachCardVM, type OutreachMediaVM, type OutreachRowVM, type OutreachWindowVM, type PartVM, type PreviewVM } from '@cg/contracts/vm';

import { Button, Dot, Icon, Spinner, TextField, TalkingMark, useDispatch, useI18n, useTooltip } from '../kit';
import { NewcomerAvatar } from '../newcomers/frame';
import { Feed } from '../spenders/preview/Feed';
import { priceText } from '../spenders/preview/MediaPicker';
import { offersOpenInsert, openAndInsert } from '../spenders/preview/SendRow';
import { Length, Thumb, Thumbs } from './offer';
import { blockedReason } from './rows';
import { asideText, isPaid, mediumWords, tierWords } from './words';

/** «Ivan» of «Ivan Petrov»: the card says «Медиа для Ivan». */
const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** The registry's text of a shared code, or the site's own code as it is. */
function codeTail(i18n: I18n, code: string): string {
  return Object.hasOwn(CG_REGISTRY, code) ? i18n.t(CG_REGISTRY[code as keyof typeof CG_REGISTRY].body) : '';
}

/** The version as the card's preview holds it: what «Открыть и вставить» puts into the fan's chat. */
function versionPart(preview: PreviewVM, handle: string): { readonly opId: string; readonly part: PartVM } | null {
  const result = preview.result;
  if (preview.handle !== handle || result === null || result.state !== 'done') return null;
  const part = (result.parts ?? result.variants?.[0]?.parts ?? [])[0];
  return part === undefined ? null : { opId: result.opId, part };
}

/** The fan as the list knows them (tier, sum, handle), whichever group they are in. */
const rowOf = (vm: OutreachWindowVM, handle: string): OutreachRowVM | null => vm.rows.find((row) => row.handle === handle) ?? vm.aside.find((row) => row.handle === handle) ?? null;

function Head({ card, row, preview }: { readonly card: OutreachCardVM; readonly row: OutreachRowVM | null; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const period = preview.header?.period30 ?? null;
  const lifetime = row?.lifetime ?? preview.header?.lifetime ?? null;
  const username = row?.username ?? preview.header?.username ?? null;
  return (
    <header class="cg-nc__head">
      <NewcomerAvatar name={card.name} url={row?.avatarUrl} size="card" />
      <div class="cg-nc__who">
        <h3 class="cg-nc__name">
          {card.name}
          {row?.tier === null || row?.tier === undefined ? null : <span class="cg-nw__tag">{tierWords(i18n, row.tier)}</span>}
        </h3>
        <div class="cg-nc__meta cg-num">
          {[username === null ? null : `@${username}`, lifetime === null ? null : i18n.formatMoneyMills(lifetime)].filter((part) => part !== null && part !== '').join(' · ')}
          {period !== null && period > 0 ? (
            <>
              {' · '}
              <span class="cg-ow__money">{i18n.formatMoneyMills(period, { sign: 'plus' })}</span> {i18n.t('outreach.card.period')}
            </>
          ) : null}
          <TalkingMark handle={card.handle} />
        </div>
      </div>
      {preview.header === null ? null : (
        <Button label={i18n.text(preview.openChat.label)} variant="quiet" size="sm" class="cg-nc__open" reason={preview.openChat.enabled ? null : preview.openChat.reason === null ? null : i18n.text(preview.openChat.reason.text)} onClick={() => void dispatch(preview.openChat.action)} />
      )}
    </header>
  );
}

/** «Из архива на 19:12 · чат не открыт, останется непрочитанным»: the archive is the card's only source. */
function ArchivePill({ preview, open }: { readonly preview: PreviewVM; readonly open: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const asOf = preview.archive.stamp.asOf;
  const time = asOf === null ? i18n.t('common.unknown') : i18n.formatTime(asOf);
  // The fan's chat open in the site (the version goes into its field): «чат не открыт» would not be true.
  const key = open ? 'outreach.card.archiveOpen' : preview.unread === 'kept' ? 'outreach.card.archiveKept' : preview.unread === 'read-by-check' ? 'outreach.card.archiveByCheck' : 'outreach.card.archiveAfterSend';
  const tip = useTooltip(i18n.t('outreach.card.archiveTooltip'));
  return (
    <div class="cg-ow__pill" data-cg-unread={preview.unread}>
      <Icon name="eyeOff" size={14} />
      <span {...tip.props}>
        {preview.fanWroteNew ? i18n.t('preview.fanWroteNew') : i18n.t(key, { time })}
        {tip.description}
      </span>
      {preview.fanWroteNew ? <Button label={i18n.text(preview.archive.refresh.label)} variant="quiet" size="sm" busy={preview.archive.refreshing} onClick={() => void dispatch(preview.archive.refresh.action)} /> : null}
    </div>
  );
}

/** The version went (or is on its way) and the archive does not hold it yet: it stands in the feed as our bubble. */
function bubbleShown(card: OutreachCardVM, preview: PreviewVM): boolean {
  if (card.version === null || (card.state !== 'sent' && card.state !== 'uncertain' && card.state !== 'accepted' && card.state !== 'sending')) return false;
  // The archive has the message already: it is in the feed, once.
  const since = Date.parse(card.sentAt ?? card.clickedAt ?? '') - 120_000;
  const text = card.version.trim();
  return !preview.feed.items.some((item) => item.sender === 'model' && item.text.trim() === text && (item.at === null || Number.isNaN(since) || Date.parse(item.at) >= since));
}

/** What went: the version as a bubble of the conversation, with its media and «✓ отправлено из рассылки». */
function SentBubble({ card }: { readonly card: OutreachCardVM }): JSX.Element | null {
  const i18n = useI18n();
  if (card.version === null) return null;
  const media = card.media;
  const bought = card.bought;
  const under = card.state === 'sent' ? (card.sentAt === null ? '' : i18n.formatTime(card.sentAt)) : card.clickedAt === null ? '' : i18n.formatTime(card.clickedAt);
  return (
    <div class={`cg-feed__msg is-own cg-ow__sentmsg${card.state === 'sent' ? '' : ' is-going'}`} data-cg-outreach-sent={card.state}>
      {media === null ? null : (
        <span class="cg-ow__btiles">
          {media.items.map((item) => (
            <Thumb key={item.id} item={item} size="bt">
              {!item.free && media.priceCents > 0 ? (
                <span class="cg-ow__lock">
                  <Icon name="lock" size={12} />
                  {priceText(media.priceCents)}
                </span>
              ) : null}
              <Length item={item} />
            </Thumb>
          ))}
          {Array.from({ length: media.items.length === 0 ? media.posts : 0 }, (_, index) => (
            <Thumb key={`post-${index}`} item={null} size="bt">
              <span class="cg-ow__lock">
                <Icon name="lock" size={12} />
              </span>
            </Thumb>
          ))}
        </span>
      )}
      {card.version}
      <small class="cg-num">
        {under}
        {card.state === 'sent' ? (
          <>
            {under === '' ? '' : ' · '}
            <Icon name="check" size={12} class="cg-ow__sm" /> {i18n.t('outreach.card.fromOutreach')}
          </>
        ) : null}
        {bought !== null ? i18n.t('outreach.card.bubbleBought', { money: i18n.formatMoneyMills(bought.mills), time: bought.at === null ? '' : ` ${i18n.formatTime(bought.at)}` }) : null}
      </small>
    </div>
  );
}

/** What goes with the version: the offer's media (or the fan's own), «Другие медиа для …», or «Только текст». */
function DraftMedia({ card }: { readonly card: OutreachCardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const media = card.media;
  const name = firstName(card.name);
  const pick = (): void => void dispatch({ type: 'SetMediaOpen', targetHandle: card.handle, open: true });
  const common = (): void => void dispatch({ type: 'ResetOutreachMedia', targetHandle: card.handle });
  if (media === null) {
    return (
      <div class="cg-ow__dnone">
        <span>{i18n.t('outreach.card.textOnly')}</span>
        {card.canPickMedia && card.editable ? (
          <button type="button" class="cg-ow__link" onClick={pick}>
            {i18n.t('outreach.card.mediaFor', { name })}
          </button>
        ) : null}
        {card.ownMedia ? (
          <button type="button" class="cg-ow__link" onClick={common}>
            {i18n.t('outreach.card.common')}
          </button>
        ) : null}
      </div>
    );
  }
  const paid = media.priceCents > 0 ? media.items.filter((item) => !item.free) : [];
  const free = media.priceCents > 0 ? media.items.filter((item) => item.free) : media.items;
  return (
    <div class="cg-ow__dmedia">
      <Thumbs media={media} size="md" />
      <span class="cg-ow__dwords">
        {media.items.length === 0 ? (
          <span>
            <b>{i18n.plural('outreach.media.posts', media.posts)}</b>, {i18n.t('outreach.media.postPrice')}
          </span>
        ) : null}
        {free.length > 0 ? (
          <span>
            <b>{free.length === 1 ? (media.priceCents > 0 ? i18n.t('outreach.media.preview') : mediumWords(i18n, free[0] as OutreachMediaVM['items'][number])) : i18n.plural('outreach.media.previewsN', free.length)}</b>, {i18n.t('outreach.media.free')}
          </span>
        ) : null}
        {paid.length > 0 ? (
          <span>
            <b>{paid.length === 1 ? mediumWords(i18n, paid[0] as OutreachMediaVM['items'][number]) : i18n.plural('outreach.media.count', paid.length)}</b>, {i18n.t('outreach.media.forPrice', { price: priceText(media.priceCents) })}
          </span>
        ) : null}
        {media.problem === null ? null : <span class="cg-ow__bad">{i18n.text(media.problem)}</span>}
        {card.canPickMedia && card.editable ? (
          card.ownMedia ? (
            <span class="cg-ow__ownl">
              <button type="button" class="cg-ow__link" onClick={pick}>
                {i18n.t('outreach.card.ownFor', { name })}
              </button>
              {' · '}
              <button type="button" class="cg-ow__link" onClick={common}>
                {i18n.t('outreach.card.common')}
              </button>
            </span>
          ) : (
            <button type="button" class="cg-ow__link" onClick={pick}>
              {i18n.t('outreach.card.otherFor', { name })}
            </button>
          )
        ) : null}
      </span>
    </div>
  );
}

/** The warning «Отправить всё равно» passes, in one calm line over the buttons. */
function Calm({ card, preview }: { readonly card: OutreachCardVM; readonly preview: PreviewVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const warning = card.warning;
  if (warning === null || card.state !== 'ready') return null;
  const time = card.archiveAt === null ? null : i18n.formatTime(card.archiveAt);
  return (
    <div class="cg-ow__calm" data-cg-warning={warning.kind}>
      <Dot kind="accent" use="send-held-stale" size={6} />
      {warning.kind === 'archive' ? (
        <span>
          <b>{i18n.t('outreach.card.archiveWarn')}</b>
          {time === null ? null : `: ${i18n.t('outreach.card.byArchiveAt', { time })}`}
        </span>
      ) : warning.kind === 'stale' ? (
        <span>
          <b>{i18n.t('outreach.card.staleWarn')}</b>: {i18n.t('outreach.card.staleTail')}
        </span>
      ) : (
        <span>
          <b>{i18n.t('outreach.card.talkingWarn', { names: warning.names.join(', ') })}</b>: {i18n.t('outreach.card.talkingTail')}
        </span>
      )}
      <span class="cg-nw__grow" />
      {warning.kind === 'archive' ? <Button label={i18n.text(preview.archive.refresh.label)} variant="quiet" size="sm" busy={preview.archive.refreshing} reason={preview.archive.refresh.enabled ? null : preview.archive.refresh.reason === null ? null : i18n.text(preview.archive.refresh.reason.text)} onClick={() => void dispatch(preview.archive.refresh.action)} /> : null}
    </div>
  );
}

/** The version's zone under the conversation, by where the fan stands. */
function Zone({ vm, card, preview, onSent }: { readonly vm: OutreachWindowVM; readonly card: OutreachCardVM; readonly preview: PreviewVM; readonly onSent: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const name = firstName(card.name);
  const reasons = (card.aside ?? []).filter((reason) => reason.kind !== 'manual');

  if (reasons.length > 0) {
    return (
      <div class="cg-ow__dzone is-empty" data-cg-zone="aside">
        <Dot kind="ink" size={6} />
        <span>{i18n.t('outreach.card.aside', { why: reasons.map((reason) => asideText(i18n, reason, vm.media)).join(' · ') })}</span>
      </div>
    );
  }
  switch (card.state) {
    case 'idle':
      return vm.audience.locked ? (
        <div class="cg-ow__dzone is-empty" data-cg-zone="idle">
          <span>{i18n.t('outreach.card.notIn', { name: card.name })}</span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('outreach.card.writeFor', { name })} variant="line" size="sm" onClick={() => void dispatch({ type: 'RewriteOutreach', targetHandle: card.handle })} />
        </div>
      ) : (
        <div class="cg-ow__dzone is-empty" data-cg-zone="idle">
          <span>{i18n.t('outreach.card.later')}</span>
        </div>
      );
    case 'queued':
    case 'writing':
      return (
        <div class="cg-ow__dzone" data-cg-zone="writing">
          <div class="cg-ow__dcard">
            <div class="cg-ow__dhead">
              <b>{i18n.t('outreach.card.versionFor', { name: card.name })}</b>
              <span>{i18n.t(card.state === 'writing' ? 'outreach.card.writing' : 'outreach.card.queued')}</span>
            </div>
            <div class="cg-ow__dwait">
              {card.state === 'writing' ? <Spinner /> : null}
              {i18n.t(card.state === 'writing' ? 'outreach.card.writingLong' : 'outreach.card.queuedLong')}
            </div>
          </div>
        </div>
      );
    case 'stopped':
      return (
        <div class="cg-ow__dzone is-empty" data-cg-zone="stopped">
          <span>{i18n.t('outreach.card.stopped')}</span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('outreach.card.resume')} variant="line" size="sm" onClick={() => void dispatch({ type: 'RewriteOutreach', targetHandle: card.handle })} />
        </div>
      );
    case 'unwritten':
      return (
        <div class="cg-ow__dzone is-empty" data-cg-zone="unwritten" {...(card.code === null ? {} : { 'data-cg-code': card.code })}>
          <Dot kind="ink" size={6} />
          <span>{card.code === null ? i18n.t('outreach.row.unwritten') : i18n.t('outreach.card.unwritten', { code: card.code })}</span>
          <span class="cg-nw__grow" />
          {card.rewrite ? <Button label={i18n.t('outreach.card.again')} variant="line" size="sm" onClick={() => void dispatch({ type: 'RewriteOutreach', targetHandle: card.handle })} /> : null}
        </div>
      );
    case 'sent': {
      const media = card.media;
      const what = media === null ? i18n.t('outreach.card.wentText') : isPaid(media) && media.items.length > 0 ? i18n.t('outreach.card.wentPaid', { price: priceText(media.priceCents) }) : i18n.t('outreach.card.wentMedia');
      const later = card.bought !== null ? (
        <>
          {' · '}
          {i18n.t('outreach.row.boughtLead')} <span class="cg-ow__money">{i18n.formatMoneyMills(card.bought.mills, { sign: 'plus' })}</span>
          {card.bought.at === null ? null : ` ${i18n.t('outreach.card.at', { time: { time: card.bought.at } })}`}
        </>
      ) : card.replied !== null ? (
        ` · ${i18n.t('outreach.card.replied', { time: { time: card.replied.at } })}`
      ) : null;
      return (
        <div class="cg-ow__dzone is-sent" data-cg-zone="sent">
          <div class="cg-ow__sentline">
            <b>
              <Icon name="check" size={14} />
              {card.sentAt === null ? i18n.t('outreach.card.sentNow', { name: card.name }) : i18n.t('outreach.card.sent', { name: card.name, time: { time: card.sentAt } })}
            </b>
            <span>
              {what}
              {later}
            </span>
          </div>
          <span class="cg-nw__grow" />
          {card.next !== null ? (
            <Button label={i18n.t('outreach.card.next', { name: card.next.name })} variant="line" size="sm" trailing={<Icon name="arrowRight" size={14} />} tooltip={i18n.t('outreach.card.nextTooltip')} onClick={() => void dispatch({ type: 'OpenPreview', targetHandle: card.next?.handle ?? card.handle })} />
          ) : (
            <Button label={i18n.t('outreach.card.toSummary')} variant="line" size="sm" onClick={() => void dispatch({ type: 'SetOutreach', pane: 'summary' })} />
          )}
        </div>
      );
    }
    case 'uncertain':
      return (
        <div class="cg-ow__dzone" data-cg-zone="uncertain">
          <div class="cg-ow__dcard is-went">
            <div class="cg-ow__dhead">
              <b>{i18n.t('outreach.card.versionFor', { name: card.name })}</b>
              <span>
                {card.clickedAt === null ? null : i18n.t('outreach.card.clicked', { time: { time: card.clickedAt } })}
                {card.replied === null ? null : ` · ${i18n.t('outreach.card.repliedCheck', { time: { time: card.replied.at } })}`}
              </span>
            </div>
            <div class="cg-ow__dtext">{card.version}</div>
          </div>
          <div class="cg-nc__gst" data-cg-uncertain="1">
            <Dot kind="ink" />
            <b>{i18n.t('outreach.row.uncertainShort')}</b>
            <span class="cg-nc__gcode">
              <b>ChatGoose · CG-SEND-UNCERTAIN:</b> {i18n.t('outreach.card.uncertainTail')}
            </span>
          </div>
          <div class="cg-ow__acts">
            <span class="cg-nw__grow" />
            <Button label={i18n.t('outreach.card.verify')} variant="line" onClick={() => void dispatch(preview.openChat.action)} />
          </div>
        </div>
      );
    case 'ready':
    case 'failed':
    case 'sending':
    case 'accepted':
      break;
  }
  const busy = card.state === 'sending' || card.state === 'accepted';
  const send = card.send;
  const label = send?.kind === 'retry' ? 'outreach.retry' : send?.kind === 'anyway' ? 'outreach.sendAnyway' : 'outreach.send';
  const reason = send === null ? (busy ? null : i18n.t('outreach.cannot')) : send.can ? null : send.paused ? i18n.t('outreach.paused') : send.reason === null ? i18n.t('outreach.cannot') : i18n.text(send.reason);
  // Held where this window cannot send it: why, and the chat's own way — «Открыть и вставить», the person sends there
  // (never for a fan who takes no messages: nothing reaches them either way).
  const blocked = busy ? null : blockedReason(i18n, send, card.state);
  const insert = blocked === null || send?.reason?.key === 'send.reason.fan' ? null : versionPart(preview, card.handle);
  const insertState = insert === null || !offersOpenInsert(insert.part) ? undefined : insert.part.openInsert;
  return (
    <div class="cg-ow__dzone" data-cg-zone="draft">
      <div class={`cg-ow__dcard${busy ? ' is-busy' : ''}`}>
        <div class="cg-ow__dhead">
          <b>{i18n.t('outreach.card.versionFor', { name: card.name })}</b>
          <span>
            {i18n.t('outreach.card.draft')}
            {card.edited ? ` · ${i18n.t('outreach.card.edited')}` : null}
          </span>
          {card.edited && card.editable ? (
            <>
              <span class="cg-nw__grow" />
              <button type="button" class="cg-ow__link" onClick={() => void dispatch({ type: 'EditOutreach', targetHandle: card.handle, text: null })}>
                {i18n.t('outreach.card.restore')}
              </button>
            </>
          ) : null}
        </div>
        <TextField
          value={card.version ?? ''}
          label={i18n.t('outreach.card.versionFor', { name: card.name })}
          multiline
          minHeight={21}
          maxHeight={168}
          maxLength={vm.maxChars}
          class="cg-ow__dta"
          inputRef={field}
          reason={card.editable ? null : busy ? i18n.t('outreach.card.going') : null}
          onValue={(text) => void dispatch({ type: 'EditOutreach', targetHandle: card.handle, text })}
        />
        <DraftMedia card={card} />
      </div>
      <Calm card={card} preview={preview} />
      {blocked === null ? null : (
        <div class="cg-ow__calm is-held" data-cg-blocked="1">
          <Dot kind="ink" size={6} />
          <span>
            <b>{i18n.t('outreach.card.blocked')}:</b> {blocked}
          </span>
        </div>
      )}
      {card.state === 'failed' ? (
        <div class="cg-nc__gst" {...(card.code === null ? {} : { 'data-cg-code': card.code })}>
          <Dot kind="danger" />
          <b>{i18n.t('outreach.state.failed')}</b>
          {card.failedAt === null ? null : <span>{i18n.t('outreach.card.at', { time: { time: card.failedAt } })}</span>}
          {card.code === null ? null : (
            <span class="cg-nc__gcode">
              <b>ChatGoose · {card.code}:</b> {codeTail(i18n, card.code)}
            </span>
          )}
        </div>
      ) : null}
      {busy ? (
        <div class="cg-nc__gst">
          {card.state === 'accepted' ? <Dot kind="pulse" /> : <Spinner />}
          <b>{i18n.t(card.state === 'accepted' ? 'send.accepted' : 'outreach.state.sending')}</b>
        </div>
      ) : null}
      <div class="cg-ow__acts">
        <Button label={i18n.t('outreach.card.again')} icon="refresh" variant="quiet" size="sm" tooltip={i18n.t('outreach.card.againTooltip', { name: card.name })} reason={card.rewrite ? null : busy ? i18n.t('outreach.card.going') : i18n.t('outreach.cannot')} onClick={() => void dispatch({ type: 'RewriteOutreach', targetHandle: card.handle })} />
        <Button
          label={i18n.t('outreach.card.edit')}
          icon="pencil"
          variant="quiet"
          size="sm"
          reason={card.editable ? null : busy ? i18n.t('outreach.card.going') : i18n.t('outreach.cannot')}
          onClick={() => {
            const node = field.current;
            if (node === null) return;
            node.focus();
            node.setSelectionRange(node.value.length, node.value.length);
          }}
        />
        <span class="cg-nw__grow" />
        {insert !== null && insertState !== undefined && insertState.s !== 'hidden' ? (
          <Button
            label={i18n.t('send.openAndInsert')}
            variant="line"
            class="cg-ow__cinsert"
            busy={insertState.s === 'waiting'}
            tooltip={i18n.t(card.media === null ? 'outreach.card.insertTooltip' : 'outreach.card.insertMediaTooltip')}
            reason={insertState.s === 'unavailable' ? i18n.text(insertState.reason.text) : null}
            onClick={() => void dispatch(openAndInsert(insert.opId, insert.part))}
          />
        ) : (
        <Button
          label={`${i18n.t(label)} →`}
          variant="send"
          class="cg-ow__csend"
          busy={busy}
          tooltip={i18n.t(send?.kind === 'retry' ? 'outreach.retryTooltip' : send?.kind === 'anyway' ? (card.warning?.kind === 'stale' ? 'outreach.anywayStale' : card.warning?.kind === 'talking' ? 'outreach.anywayTalking' : 'outreach.anywayArchive') : 'outreach.sendTooltip')}
          reason={busy ? null : reason}
          onClick={() => {
            if (send === null || !send.can || busy) return;
            onSent(card.handle);
            void dispatch(send.kind === 'anyway' ? { type: 'SendOutreach', targetHandle: card.handle, anyway: true } : { type: 'SendOutreach', targetHandle: card.handle });
          }}
        />
        )}
      </div>
    </div>
  );
}

export function OutreachCard({ vm, card, preview, onSent }: { readonly vm: OutreachWindowVM; readonly card: OutreachCardVM; readonly preview: PreviewVM; readonly onSent: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const row = rowOf(vm, card.handle);
  const tail = bubbleShown(card, preview) ? <SentBubble card={card} /> : undefined;
  return (
    <section class="cg-nc cg-ow__card" aria-label={i18n.t('outreach.card.label', { name: card.name })} data-cg-outreach-card={card.state}>
      <Head card={card} row={row} preview={preview} />
      <div class="cg-ow__conv">
        <ArchivePill preview={preview} open={card.send?.reason?.key === 'send.reason.activeChat'} />
        <Feed handle={preview.handle} feed={preview.feed} empty={preview.view.s === 'loading' ? null : { key: 'outreach.card.noChat' }} loading={preview.view.s === 'loading'} seen={preview.seen} {...(tail === undefined ? {} : { tail })} />
      </div>
      <Zone vm={vm} card={card} preview={preview} onSent={onSent} />
    </section>
  );
}

