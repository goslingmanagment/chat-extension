// The chosen fan's card of «Онлайн», chat-like (the twin of «Рассылка»'s): who they are and how fresh their presence
// is, why to write now in one calm box (or why they are set aside: a warning, never a block), their conversation from
// the hub's archive (the chat is not opened and stays unread), and under it the usual window (2026-10-26, the owner):
// the text's box, always there, and the strip of the dock and the preview — the goose, Reply with its tones, Hi, Ping —
// with «Шаблон», the hub's advice its main chip. Nothing is written until the person clicks one. The text — the AI's,
// or a text of the team's guide — stands in the box with «Ещё раз» / «Другой шаблон», «Править», «Пропустить»,
// «Не предлагать» and the blue «Отправить →». One click, one message; an unknown outcome is never sent again by our
// button: the person looks in the chat.
//
// «Очереди» (2026-10-29) shows this same card for a fan of its portion (`card.queue`): why he is in the queue, the
// mass messages he got where there was no conversation, and «Пропустить ▾» with its reasons instead of «Пропустить» and
// «Не предлагать».

import { Fragment, type JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type I18n, type Msg, type OnlineCardVM, type OnlineChoice, type PartVM, type PreviewVM, type QueueSkipReason } from '@cg/contracts/vm';

import { Button, Dot, FanBadge, GooseMark, Icon, Menu, MenuAnchor, Spinner, StripButton, TextField, menuTriggerKeys, useDispatch, useHints, useI18n, useTooltip } from '../kit';
import { Feed } from '../spenders/preview/Feed';
import { priceText } from '../spenders/preview/MediaPicker';
import { SEGMENT_LETTERS, ToneCapsule, reasonText, stripKeys } from '../spenders/preview/MiniStrip';
import { useOwnEchoes } from '../spenders/ownEchoes';
import { offersOpenInsert, openAndInsert } from '../spenders/preview/SendRow';
import { blockedReason } from '../outreach/rows';
import { OnlineAvatar } from './rows';
import { actWord, asideText, firstName, seenLong, timeLeft } from './words';
import { touchedText } from '../outreach/words';

/** The text as the card's preview holds it: what «Открыть и вставить» puts into the fan's chat. */
function textPart(preview: PreviewVM, handle: string): { readonly opId: string; readonly part: PartVM } | null {
  const result = preview.result;
  if (preview.handle !== handle || result === null || result.state !== 'done') return null;
  const part = (result.parts ?? result.variants?.[0]?.parts ?? [])[0];
  return part === undefined ? null : { opId: result.opId, part };
}

/** The registry's text of a shared code, or nothing for a site's own code. */
function codeTail(i18n: I18n, code: string): string {
  return Object.hasOwn(CG_REGISTRY, code) ? i18n.t(CG_REGISTRY[code as keyof typeof CG_REGISTRY].body) : '';
}

function Head({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const money = [card.username === null ? null : `@${card.username}`, card.lifetime !== null ? i18n.formatMoneyMills(card.lifetime) : card.moneyUnknown === true ? null : i18n.t('online.row.notPaid')].filter((part): part is string => part !== null);
  const subscribed = card.subscription?.startedAt ?? null;
  return (
    <header class="cg-nc__head">
      <OnlineAvatar name={card.name} presence={card.presence} size="card" />
      <div class="cg-nc__who">
        <div class="cg-fbname is-card">
          <h3 class="cg-nc__name">{card.name}</h3>
          <FanBadge badges={card.badges} />
        </div>
        <div class="cg-nc__meta cg-num">
          {money.join(' · ')}
          {card.last30 === null ? null : (
            <>
              {' · '}
              <span class="cg-ow__money">{i18n.formatMoneyMills(card.last30, { sign: 'plus' })}</span> {i18n.t('online.card.period')}
            </>
          )}
        </div>
        <div class="cg-nc__meta">
          <span class="ol-meta2">
            <i class={`ol-sdot${card.presence === 'now' ? '' : card.presence === 'fading' ? ' is-fading' : ' is-gone'}`} aria-hidden="true" />
            {seenLong(i18n, card)}
          </span>
          {subscribed === null ? null : ` · ${i18n.t('online.card.subscribed', { date: { time: subscribed, style: 'date' } })}`}
        </div>
      </div>
      {preview.header === null ? null : (
        <Button label={i18n.text(preview.openChat.label)} variant="quiet" size="sm" class="cg-nc__open" reason={preview.openChat.enabled ? null : preview.openChat.reason === null ? null : i18n.text(preview.openChat.reason.text)} onClick={() => void dispatch(preview.openChat.action)} />
      )}
    </header>
  );
}

/**
 * Why to write now, in one calm box; a fan set aside says why, and that a click may still write. A fan of a queue who
 * got the page's mass messages has them here too, unless his empty conversation below says it (`massBelow`).
 */
function Why({ card, massBelow }: { readonly card: OnlineCardVM; readonly massBelow: boolean }): JSX.Element {
  const i18n = useI18n();
  if (card.aside !== null) {
    return (
      <div class="ol-why is-warn" data-cg-aside={card.aside.kind}>
        <Icon name="info" size={14} />
        <span>
          <b>{i18n.t('online.card.asideLead')}</b> {asideText(i18n, card.aside)}. {i18n.t('online.card.asideTail')}
        </span>
      </div>
    );
  }
  const reason = card.reason;
  let lead: string;
  let tail: string;
  // A queue's lead reads as a heading of its why: «Очередь «Холодные живые»: подписан 12 мар, ни разу не писал».
  let mark = '.';
  switch (reason.kind) {
    case 'waiting':
      lead = reason.since === null ? i18n.t('online.why.waitingNow') : i18n.t('online.why.waiting', { age: i18n.formatAge(reason.since) });
      tail = i18n.t('online.card.why.waiting');
      break;
    case 'answered':
      if (card.queue !== undefined) {
        lead = reason.at === null ? i18n.t('queues.why.answeredNow') : i18n.t('queues.why.answered', { age: i18n.formatAge(reason.at) });
        tail = i18n.t('queues.card.why.answered');
        break;
      }
      lead = i18n.t('online.why.answered', { act: actWord(i18n, card.act === 'reply' ? null : card.act), age: reason.at === null ? i18n.t('common.unknown') : i18n.formatAge(reason.at) });
      tail = i18n.t('online.card.why.answered');
      break;
    case 'queue':
      lead = i18n.t('queues.why.lead', { name: reason.queue });
      tail = reason.why ?? (reason.goal === null ? '' : i18n.t('queues.why.goal', { goal: reason.goal }));
      mark = ':';
      break;
    case 'new':
      lead = reason.subscribedAt === null ? i18n.t('online.why.newNow') : i18n.t('online.why.new', { age: i18n.formatAge(reason.subscribedAt) });
      tail = i18n.t('online.card.why.new');
      break;
    case 'expiring':
      lead = reason.endsAt === null ? i18n.t('online.why.expiringSoon') : i18n.t('online.why.expiring', { left: timeLeft(i18n, reason.endsAt) });
      tail = i18n.t('online.card.why.expiring');
      break;
    case 'silent':
      lead = i18n.t('online.card.lead.silent', { money: i18n.formatMoneyMills(reason.lifetime), age: reason.since === null ? i18n.t('common.unknown') : i18n.formatAge(reason.since) });
      tail = i18n.t(card.advice === 'template' ? 'online.card.why.short' : 'online.card.why.ping');
      break;
    case 'quiet':
      lead = reason.since === null ? i18n.t('online.why.quietNow') : i18n.t('online.why.quiet', { age: i18n.formatAge(reason.since) });
      tail = i18n.t(card.advice === 'template' ? 'online.card.why.short' : 'online.card.why.ping');
      break;
    case 'never':
      lead = reason.subscribedAt === null ? i18n.t('online.why.never') : i18n.t('online.why.neverFor', { age: i18n.formatAge(reason.subscribedAt) });
      tail = i18n.t('online.card.why.never');
      break;
    case 'none':
      lead = i18n.t('online.card.lead.none');
      tail = reason.lastAt === null ? i18n.t('online.card.why.none') : i18n.t('online.card.why.noneLast', { age: i18n.formatAge(reason.lastAt) });
      break;
  }
  const named =
    card.template === null || card.template.named === null
      ? null
      : card.template.own !== undefined
        ? card.template.named
          ? i18n.t('queues.card.named', { name: card.template.greeting ?? firstName(card.name) })
          : i18n.t('queues.card.unnamed')
        : card.template.named
          ? i18n.t('online.card.named', { name: card.template.greeting ?? firstName(card.name) })
          : i18n.t('online.card.unnamed');
  const sentence = tail === '' || /[.!?…]$/.test(tail) ? tail : `${tail}.`;
  const mass = reason.kind === 'queue' && reason.mass !== null && !massBelow ? reason.mass : null;
  const massLine = mass === null ? null : mass.lastAt === null ? i18n.t('queues.why.mass', { n: mass.count }) : i18n.t('queues.why.massLast', { n: mass.count, age: i18n.formatAge(mass.lastAt) });
  return (
    <div class="ol-why" data-cg-reason={reason.kind}>
      <Icon name={card.queue === undefined ? 'info' : 'queues'} size={14} />
      <span>
        <b>
          {lead}
          {mark}
        </b>{' '}
        {sentence}
        {massLine === null ? null : ` ${massLine}.`}
        {named === null ? null : ` ${named}`}
      </span>
    </div>
  );
}

/**
 * Where the archive holds no conversation: «Личной переписки ещё нет»; for a fan of a queue who got the page's mass
 * messages and never wrote, how many in 90 days and the last one's age (the prototype's note in the empty chat).
 */
function feedEmpty(card: OnlineCardVM): Msg {
  const reason = card.reason;
  if (reason.kind !== 'queue' || reason.mass === null) return { key: 'online.card.noFeed' };
  return reason.mass.lastAt === null
    ? { key: 'queues.card.noFeedMass', params: { n: reason.mass.count } }
    : { key: 'queues.card.noFeedMassLast', params: { n: reason.mass.count, age: { age: reason.mass.lastAt } } };
}

/** «Из архива на 19:12 · чат не открыт, останется непрочитанным»: the archive is the card's only source. */
function ArchivePill({ preview }: { readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const asOf = preview.archive.stamp.asOf;
  const time = asOf === null ? i18n.t('common.unknown') : i18n.formatTime(asOf);
  const key = preview.unread === 'kept' ? 'outreach.card.archiveKept' : preview.unread === 'read-by-check' ? 'outreach.card.archiveByCheck' : 'outreach.card.archiveAfterSend';
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

/** The text went (or is on its way) and the archive does not hold it yet: it stands in the feed as our bubble. */
function bubbleShown(card: OnlineCardVM, preview: PreviewVM): boolean {
  if (card.version === null || (card.state !== 'sent' && card.state !== 'uncertain' && card.state !== 'accepted' && card.state !== 'sending')) return false;
  const since = Date.parse(card.sentAt ?? card.clickedAt ?? '') - 120_000;
  const text = card.version.trim();
  return !preview.feed.items.some((item) => item.sender === 'model' && item.text.trim() === text && (item.at === null || Number.isNaN(since) || Date.parse(item.at) >= since));
}

function SentBubble({ card }: { readonly card: OnlineCardVM }): JSX.Element | null {
  const i18n = useI18n();
  if (card.version === null) return null;
  const at = card.state === 'sent' ? card.sentAt : card.clickedAt;
  return (
    <div class={`cg-feed__msg is-own cg-ow__sentmsg${card.state === 'sent' ? '' : ' is-going'}`} data-cg-online-sent={card.state}>
      {card.version}
      <small class="cg-num">
        {at === null ? '' : i18n.formatTime(at)}
        {card.state === 'sent' ? ` · ${i18n.t(card.queue === undefined ? 'online.card.sentFrom' : 'queues.card.sentFrom')}` : ` · ${i18n.t('online.row.sending')}`}
      </small>
    </div>
  );
}

/** What goes with the text besides the words: media the person picked for the fan on another card of theirs. */
function MediaLine({ card }: { readonly card: OnlineCardVM }): JSX.Element | null {
  const i18n = useI18n();
  const media = card.media;
  if (media === null) return null;
  const count = media.items.length;
  return (
    <div class="cg-ow__dnone" data-cg-online-media="1">
      <span>
        {i18n.t('online.card.media', { n: count, price: media.priceCents > 0 ? priceText(media.priceCents) : i18n.t('online.card.mediaFree') })}
      </span>
      {media.problem === null ? null : <span class="cg-ow__bad">{i18n.text(media.problem)}</span>}
    </div>
  );
}

/** The warning «Отправить всё равно» passes (the card's send), in one calm line over the buttons. */
function Calm({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element | null {
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
          {time === null ? null : `: ${i18n.t('online.card.byArchiveAt', { time })}`}
        </span>
      ) : warning.kind === 'stale' ? (
        <span>
          <b>{i18n.t('outreach.card.staleWarn')}</b>: {i18n.t('online.card.staleTail')}
        </span>
      ) : warning.kind === 'talking' ? (
        <span>
          <b>{i18n.t('outreach.card.talkingWarn', { names: warning.names.join(', ') })}</b>: {i18n.t('outreach.card.talkingTail')}
        </span>
      ) : warning.kind === 'touched' ? (
        <span>
          <b>{touchedText(i18n, warning)}</b>: {i18n.t('outreach.card.touchedTail')}
        </span>
      ) : (
        <span>
          <b>{i18n.t(warning.refused === true ? 'outreach.card.hubRefused' : 'outreach.card.hubWarn')}</b>: {i18n.t('outreach.card.hubTail')}
        </span>
      )}
      <span class="cg-nw__grow" />
      {warning.kind === 'archive' ? <Button label={i18n.text(preview.archive.refresh.label)} variant="quiet" size="sm" busy={preview.archive.refreshing} onClick={() => void dispatch(preview.archive.refresh.action)} /> : null}
    </div>
  );
}

/**
 * «Пропустить ▾» of a fan of «Очереди»: «Не подходит», «Позже», «Уже общаемся», «Не предлагать», each with what it
 * does. One report to the hub (`SkipQueue`); a fan who answered has none (he is no longer in the portion).
 */
function QueueSkip({ card, busy }: { readonly card: OnlineCardVM; readonly busy: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const skips = card.queue?.skips ?? [];
  if (skips.length === 0) return null;
  return (
    <MenuAnchor>
      <Button
        label={i18n.t('queues.skip')}
        variant="quiet"
        size="sm"
        haspopup="menu"
        expanded={open}
        buttonRef={button}
        trailing={<Icon name="chevronDown" size={12} />}
        reason={busy ? i18n.t('outreach.card.going') : null}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open) menuTriggerKeys(event, () => setOpen(true));
        }}
      />
      <Menu
        open={open}
        kind="action"
        label={i18n.t('queues.skip')}
        items={skips.map((reason) => ({ id: reason, label: i18n.t(`queues.skip.${reason}`), note: i18n.t(`queues.skip.hint.${reason}`) }))}
        align="end"
        placement="top"
        onSelect={(id) => {
          setOpen(false);
          void dispatch({ type: 'SkipQueue', targetHandle: card.handle, reason: id as QueueSkipReason });
        }}
        onClose={() => setOpen(false)}
        returnFocusTo={() => button.current}
      />
    </MenuAnchor>
  );
}

/** «Пропустить» and «Не предлагать» of the card, beside its main button; a queue's fan has «Пропустить ▾» instead. */
function PassButtons({ card, busy }: { readonly card: OnlineCardVM; readonly busy: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (card.queue !== undefined) return <QueueSkip card={card} busy={busy} />;
  return (
    <>
      <Button label={i18n.t('online.card.skip')} variant="quiet" size="sm" trailing={<kbd>S</kbd>} tooltip={i18n.t('online.card.skipTooltip')} reason={busy ? i18n.t('outreach.card.going') : null} onClick={() => void dispatch({ type: 'SkipOnline', targetHandle: card.handle, skip: true })} />
      {card.dismiss === 'dismiss' ? (
        <Button label={i18n.t('online.card.dismiss')} variant="quiet" size="sm" tooltip={i18n.t('online.card.dismissTooltip')} reason={busy ? i18n.t('outreach.card.going') : null} onClick={() => void dispatch({ type: 'DismissOnline', targetHandle: card.handle, dismiss: true })} />
      ) : null}
    </>
  );
}

/** Why the card's own gate holds a chip (a short chat for Ping, no chat of the fan); null — it works. */
function heldOf(i18n: I18n, card: OnlineCardVM, preview: PreviewVM, act: OnlineChoice): string | null {
  const gate = act === 'template' || preview.handle !== card.handle ? null : (preview.bar.actions[act] ?? null);
  return gate !== null && !gate.enabled && !gate.busy && gate.reason !== null ? i18n.text(gate.reason.text) : null;
}

/**
 * The advice the card shows: the hub's; Hi or Ping advised where the AI cannot write them (no chat of the fan yet, a
 * short chat) — the guide's text instead. Never for Reply: a reactivation text is no answer.
 */
function adviceShown(i18n: I18n, card: OnlineCardVM, preview: PreviewVM): OnlineChoice | null {
  const advice = card.choices.find((choice) => choice.suggested)?.act ?? null;
  return (advice === 'hi' || advice === 'ping') && heldOf(i18n, card, preview, advice) !== null && card.choices.some((choice) => choice.act === 'template') ? 'template' : advice;
}

/**
 * The strip beside the field «Свой текст», the dock's and the preview's own: the goose, Reply with its tones, Hi,
 * Ping, and «Шаблон» (the guide's text, no AI). The AI writes only by a click here; the hub's advice is the main chip.
 * A chip the card's own gate holds (a short chat for Ping, no chat of the fan) says why.
 */
function Strip({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const bar = useRef<HTMLDivElement>(null);
  // Fix stands in the field «Свой текст»: it works on those words.
  const chips = card.choices.filter((choice) => choice.act !== 'fix');
  if (chips.length === 0) return null;
  const ours = preview.handle === card.handle;
  const writing = card.state === 'writing';
  const advice = adviceShown(i18n, card, preview);
  const letter = ours && preview.ping !== null ? SEGMENT_LETTERS[preview.ping.segment] : undefined;
  return (
    <div ref={bar} class="cg-pvb ol-strip" role="toolbar" aria-label={i18n.t('online.pick.lead')} data-cg-online-pick="1" onKeyDown={stripKeys(bar)}>
      <span class="cg-pvb__mark" aria-hidden="true">
        <GooseMark />
      </span>
      <div class="cg-pvb__acts">
        {chips.flatMap((choice, index) => {
          const act = actWord(i18n, choice.act);
          const busy = writing && choice.current;
          const reason = busy ? null : writing ? i18n.t('online.row.writing', { act: actWord(i18n, card.act) }) : heldOf(i18n, card, preview, choice.act);
          const tooltip = choice.current ? i18n.t('online.pick.again', { act }) : choice.act === 'template' ? i18n.t('online.pick.template') : i18n.t('online.pick.tooltip', { act });
          return [
            <span key={choice.act} data-cg-strip={choice.act} class="cg-pvb__slot">
              <StripButton
                label={act}
                {...(choice.act === advice ? { class: 'cg-act--main' } : {})}
                active={choice.current && !writing}
                busy={busy}
                reason={reason}
                tooltip={hints ? tooltip : null}
                tabIndex={index === 0 ? 0 : -1}
                trailing={choice.act === 'ping' && letter !== undefined ? <span class="cg-pvb__seg">{letter}</span> : null}
                onClick={() => void dispatch({ type: 'RewriteOnline', targetHandle: card.handle, act: choice.act })}
              />
            </span>,
            // The tones are Reply's own: right after it, as in the dock.
            choice.act === 'reply' && ours ? (
              <Fragment key="capsule">
                <ToneCapsule vm={preview} split={false} held={reason} />
              </Fragment>
            ) : null,
          ];
        })}
      </div>
    </div>
  );
}

/**
 * The composer of the Spenders chat: the field «Свой текст» across the card with Fix inside it (and its «Отправить» once
 * it holds words: they go to the fan as they are), then the strip — Reply with its tones, Hi, Ping, «Шаблон» — with
 * «Пропустить» and «Не предлагать» on its right. Fix rewrites the words into the card's text above. The words are the
 * fan's draft of Spenders (one draft per fan).
 */
function Composer({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const ours = preview.handle === card.handle;
  const draft = useOwnEchoes(ours ? preview.draft.text : '', card.handle);
  const going = card.state === 'sending' || card.state === 'accepted';
  const writing = card.state === 'writing';
  const fix = card.choices.find((choice) => choice.act === 'fix') ?? null;
  const fixGate = ours ? (preview.bar.actions.fix ?? null) : null;
  const fixLabel = i18n.t('dock.action.fix');
  const fixReason = fix === null ? i18n.t('outreach.cannot') : writing && !fix.current ? i18n.t('online.row.writing', { act: actWord(i18n, card.act) }) : fixGate !== null && !fixGate.enabled && !fixGate.busy ? reasonText(i18n, fixLabel, fixGate) : null;
  const words = draft.shown.trim();
  const sendReason = going ? i18n.t('outreach.card.going') : writing ? i18n.t('online.row.writing', { act: actWord(i18n, card.act) }) : null;
  return (
    <div class="ol-compose" data-cg-online-compose="1">
      <div class="ol-compose__draft">
        <div class="ol-compose__box">
          <TextField
            value={draft.shown}
            label={i18n.t('preview.draft.aria')}
            placeholder={i18n.text(preview.draft.placeholder)}
            multiline
            minHeight={36}
            maxHeight={120}
            maxLength={preview.draft.maxChars}
            reason={ours && !going ? null : i18n.t('outreach.card.going')}
            onValue={(typed) => {
              if (!ours) return;
              const text = typed.slice(0, preview.draft.maxChars);
              draft.sent(text);
              void dispatch({ type: 'SetPreviewDraft', targetHandle: card.handle, text });
            }}
          />
          <span class="ol-compose__fix" data-cg-strip="fix">
            <StripButton
              label={fixLabel}
              active={fix?.current === true && !writing}
              busy={writing && fix?.current === true}
              reason={fixReason}
              tooltip={i18n.t('online.compose.fix')}
              onClick={() => void dispatch({ type: 'RewriteOnline', targetHandle: card.handle, act: 'fix' })}
            />
          </span>
        </div>
        {words.length === 0 ? null : (
          <Button
            label={`${i18n.t('preview.draft.send')} →`}
            variant="send"
            class="ol-compose__send"
            tooltip={i18n.t('online.compose.sendTooltip')}
            reason={sendReason}
            onClick={() => void dispatch({ type: 'SendOnline', targetHandle: card.handle, own: words })}
          />
        )}
      </div>
      <div class="cg-ow__acts ol-compose__row">
        <Strip card={card} preview={preview} />
        <span class="cg-nw__grow" />
        <PassButtons card={card} busy={going} />
      </div>
    </div>
  );
}

/** The text over the composer, as the Spenders chat shows a result: whose it is, «Ещё раз», the text and its buttons. */
function Text({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const act = actWord(i18n, card.act);
  const again = (): void => void dispatch({ type: 'RewriteOnline', targetHandle: card.handle });

  switch (card.state) {
    case 'idle': {
      // Nothing written yet: the line says what we advise and where the text will stand — or why the AI cannot write.
      const templates = card.choices.some((choice) => choice.act === 'template');
      const held = (['reply', 'hi', 'ping'] as const).map((one) => heldOf(i18n, card, preview, one));
      const advice = adviceShown(i18n, card, preview);
      return (
        <div class="ol-hint">
          {advice === null ? null : <b>{i18n.t('online.pick.advice', { act: actWord(i18n, advice) })}. </b>}
          {held.every((why) => why !== null) ? i18n.t(templates ? 'online.card.noAi' : 'online.card.noAiNoTemplate', { reason: held[0] ?? '' }) : i18n.t('online.card.empty')}
        </div>
      );
    }
    case 'writing':
      return (
        <div class="ol-text">
          <div class="cg-ow__dhead">
            <b>{i18n.t('online.card.textFor', { act, name: card.name })}</b>
          </div>
          <div class="cg-ow__dcard is-busy">
            <div class="cg-ow__dwait">
              <Spinner />
              {i18n.t('online.row.writing', { act })}
            </div>
          </div>
        </div>
      );
    case 'unwritten':
      return (
        <div class="ol-text" {...(card.code === null ? {} : { 'data-cg-code': card.code })}>
          <div class="cg-ow__dhead">
            <b>{i18n.t('online.card.textFor', { act, name: card.name })}</b>
          </div>
          <div class="cg-nc__gst">
            <Dot kind="ink" size={6} />
            <b>{i18n.t('online.card.unwritten', { act })}</b>
            {card.code === null ? null : (
              <span class="cg-nc__gcode">
                <b>ChatGoose · {card.code}:</b> {codeTail(i18n, card.code)}
              </span>
            )}
          </div>
        </div>
      );
    case 'ready':
    case 'failed':
    case 'sending':
    case 'accepted':
    case 'sent':
    case 'uncertain':
      break;
  }

  const busy = card.state === 'sending' || card.state === 'accepted';
  const send = card.send;
  const anyway = send?.kind === 'anyway' || card.aside !== null;
  // Held where this window cannot send it (the chat open on the page, a fan who takes no messages): why, and the chat's
  // own way — «Открыть и вставить», the person sends there (never for a fan who takes no messages).
  const blocked = busy ? null : blockedReason(i18n, send, card.state === 'failed' ? 'failed' : 'ready');
  const insert = blocked === null || send?.reason?.key === 'send.reason.fan' ? null : textPart(preview, card.handle);
  const insertState = insert === null || !offersOpenInsert(insert.part) ? undefined : insert.part.openInsert;
  const label = send?.kind === 'retry' ? 'online.card.retry' : anyway ? 'online.card.sendAnyway' : 'online.card.send';
  const reason = send === null ? (busy ? null : i18n.t('outreach.cannot')) : send.can ? null : send.paused ? i18n.t('online.card.paused') : send.reason === null ? i18n.t('outreach.cannot') : i18n.text(send.reason);
  return (
    <div class="ol-text">
      <div class="cg-ow__dhead">
        {card.template === null ? (
          <>
            <b>{i18n.t('online.card.textFor', { act, name: card.name })}</b>
            <span>
              {i18n.t('online.card.draft')}
              {card.edited ? ` · ${i18n.t('outreach.card.edited')}` : null}
            </span>
          </>
        ) : card.template.own !== undefined ? (
          <>
            <b>{i18n.t('queues.card.ownText')}</b>
            <span>
              {card.template.own.of > 1 ? i18n.t('queues.card.variant', { n: card.template.own.n, of: card.template.own.of }) : null}
              {card.edited ? `${card.template.own.of > 1 ? ' · ' : ''}${i18n.t('outreach.card.edited')}` : null}
            </span>
          </>
        ) : (
          <>
            <b>{i18n.t('online.card.template', { id: card.template.id })}</b>
            <span>
              {i18n.t('online.card.fromGuide')}
              {card.edited ? ` · ${i18n.t('outreach.card.edited')}` : null}
            </span>
          </>
        )}
        <span class="cg-nw__grow" />
        {card.edited && card.editable ? (
          <button type="button" class="cg-ow__link" onClick={() => void dispatch({ type: 'EditOnline', targetHandle: card.handle, text: null })}>
            {i18n.t('online.card.restore')}
          </button>
        ) : card.rewrite ? (
          <button type="button" class="cg-ow__link" onClick={again}>
            {i18n.t(card.template === null ? 'online.card.again' : card.template.own !== undefined ? 'queues.card.otherVariant' : 'online.card.otherTemplate')}
          </button>
        ) : null}
      </div>
      <div class={`cg-ow__dcard${busy ? ' is-busy' : ''}`}>
        <TextField
          value={card.version ?? ''}
          label={i18n.t('online.card.textFor', { act, name: card.name })}
          multiline
          minHeight={21}
          maxHeight={168}
          maxLength={5_000}
          class="cg-ow__dta"
          inputRef={field}
          reason={card.editable ? null : i18n.t(busy ? 'outreach.card.going' : 'outreach.cannot')}
          onValue={(text) => void dispatch({ type: 'EditOnline', targetHandle: card.handle, text })}
        />
        <MediaLine card={card} />
        <div class="ol-text__acts">
          {insert !== null && insertState !== undefined && insertState.s !== 'hidden' ? (
            <Button
              label={i18n.t('send.openAndInsert')}
              variant="line"
              size="sm"
              class="cg-ow__cinsert"
              busy={insertState.s === 'waiting'}
              tooltip={i18n.t('outreach.card.insertTooltip')}
              reason={insertState.s === 'unavailable' ? i18n.text(insertState.reason.text) : null}
              onClick={() => void dispatch(openAndInsert(insert.opId, insert.part))}
            />
          ) : (
            <Button
              label={`${i18n.t(label)} →`}
              variant="send"
              size="sm"
              class="cg-ow__csend"
              busy={busy}
              tooltip={i18n.t(send?.kind === 'retry' ? 'outreach.retryTooltip' : send?.kind === 'anyway' ? (card.warning?.kind === 'stale' ? 'outreach.anywayStale' : card.warning?.kind === 'talking' ? 'outreach.anywayTalking' : 'outreach.anywayArchive') : 'online.card.sendTooltip')}
              reason={busy ? null : reason}
              onClick={() => {
                if (send === null || !send.can || busy) return;
                void dispatch(send.kind === 'anyway' ? { type: 'SendOnline', targetHandle: card.handle, anyway: true } : { type: 'SendOnline', targetHandle: card.handle });
              }}
            />
          )}
          <Button
            label={i18n.t('online.card.edit')}
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
        </div>
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
      {card.noChat && card.state === 'ready' ? (
        <div class="cg-ow__calm" data-cg-online-nochat="1">
          <Dot kind="ink" size={6} />
          <span>{i18n.t('online.card.noChat')}</span>
        </div>
      ) : null}
      {card.state === 'failed' ? (
        <div class="cg-nc__gst" {...(card.code === null ? {} : { 'data-cg-code': card.code })}>
          <Dot kind="danger" />
          <b>{i18n.t('online.row.failed')}</b>
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
          <b>{i18n.t(card.state === 'accepted' ? 'send.accepted' : 'online.row.sending')}</b>
        </div>
      ) : null}
    </div>
  );
}

/** The text's zone under the conversation, by where the fan stands. */
function Zone({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const act = actWord(i18n, card.act);

  const went = card.state === 'sending' || card.state === 'accepted' || card.state === 'sent' || card.state === 'uncertain';
  // A fan of a queue skipped: the hub took the reason, it stands (the queue gives him back by its own rules).
  const queueSkip = card.queue?.skipped ?? null;
  if (!went && queueSkip !== null) {
    return (
      <div class="cg-ow__dzone is-empty" data-cg-zone="skipped">
        <span>{i18n.t('queues.skipped', { why: i18n.t(`queues.skip.${queueSkip}`).toLocaleLowerCase('ru') })}</span>
        <span class="cg-nw__grow" />
        {card.next === null ? null : <Button label={i18n.t('online.card.next', { name: card.next.name })} variant="line" size="sm" trailing={<Icon name="arrowRight" size={14} />} onClick={() => void dispatch({ type: 'SelectOnline', targetHandle: card.next?.handle ?? card.handle })} />}
      </div>
    );
  }
  // «Пропущен» and the person's own «Не предлагать» (a teammate's mark is a warning over the text, never a block).
  if (!went && (card.skipped || (card.aside?.kind === 'dismissed' && card.aside.by === null))) {
    const skipped = card.skipped;
    return (
      <div class="cg-ow__dzone is-empty" data-cg-zone={skipped ? 'skipped' : 'dismissed'}>
        <span>{i18n.t(skipped ? 'online.card.skipped' : 'online.card.dismissed')}</span>
        <span class="cg-nw__grow" />
        <Button
          label={i18n.t('online.card.back')}
          variant="line"
          size="sm"
          onClick={() => void dispatch(skipped ? { type: 'SkipOnline', targetHandle: card.handle, skip: false } : { type: 'DismissOnline', targetHandle: card.handle, dismiss: false })}
        />
      </div>
    );
  }

  switch (card.state) {
    case 'sent': {
      return (
        <div class="cg-ow__dzone is-sent" data-cg-zone="sent">
          <div class="ol-sent">
            <b>
              <Icon name="check" size={14} />
              {card.sentAt === null ? i18n.t('online.row.sentNow', { act }) : i18n.t('online.row.sent', { act, time: { time: card.sentAt } })}
            </b>
            <span>
              {i18n.t('online.card.sentTail')}
            </span>
            {card.next === null ? null : <Button label={i18n.t('online.card.next', { name: card.next.name })} variant="line" size="sm" trailing={<Icon name="arrowRight" size={14} />} onClick={() => void dispatch({ type: 'SelectOnline', targetHandle: card.next?.handle ?? card.handle })} />}
          </div>
        </div>
      );
    }
    case 'uncertain':
      return (
        <div class="cg-ow__dzone" data-cg-zone="uncertain">
          <div class="cg-ow__dcard is-went">
            <div class="cg-ow__dhead">
              <b>{i18n.t('online.card.textFor', { act, name: card.name })}</b>
              <span>{card.clickedAt === null ? null : i18n.t('outreach.card.clicked', { time: { time: card.clickedAt } })}</span>
            </div>
            <div class="cg-ow__dtext">{card.version}</div>
          </div>
          <div class="cg-nc__gst" data-cg-uncertain="1">
            <Dot kind="ink" />
            <b>{i18n.t('online.row.uncertain')}</b>
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
    case 'idle':
    case 'writing':
    case 'unwritten':
    case 'ready':
    case 'failed':
    case 'sending':
    case 'accepted':
      break;
  }
  // Before the text went: the text (or where it will stand), the composer, the card's last line — in this order in every
  // state, so a click on the composer keeps its focus (and the window's keys) as the text is written.
  const zone = card.state === 'idle' || card.state === 'writing' || card.state === 'unwritten' ? card.state : 'draft';
  return (
    <div class="cg-ow__dzone ol-zone" data-cg-zone={zone} {...(zone === 'unwritten' && card.code !== null ? { 'data-cg-code': card.code } : {})}>
      <Text card={card} preview={preview} />
      <Composer card={card} preview={preview} />
    </div>
  );
}

export function OnlineCard({ card, preview }: { readonly card: OnlineCardVM; readonly preview: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const ours = preview.handle === card.handle;
  const tail = ours && bubbleShown(card, preview) ? <SentBubble card={card} /> : undefined;
  return (
    <section class="cg-nc cg-ow__card" aria-label={i18n.t('online.card.label', { name: card.name })} data-cg-online-card={card.state}>
      <Head card={card} preview={preview} />
      <Why card={card} massBelow={ours && preview.view.s !== 'loading' && preview.feed.items.length === 0 && tail === undefined} />
      <div class="cg-ow__conv">
        {ours && preview.archive.stamp.asOf !== null ? <ArchivePill preview={preview} /> : null}
        <Feed handle={ours ? preview.handle : null} feed={ours ? preview.feed : { items: [], hasOlder: false, loadingOlder: false, olderError: null }} empty={!ours || preview.view.s === 'loading' ? null : feedEmpty(card)} loading={!ours || preview.view.s === 'loading'} seen={ours ? preview.seen : null} {...(tail === undefined ? {} : { tail })} />
      </div>
      <Zone card={card} preview={preview} />
    </section>
  );
}
