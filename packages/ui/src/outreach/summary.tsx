// «Итог рассылки»: once nothing more goes by a click (or when asked), what the outreach did — how many versions went,
// what came of them (purchases with a paid medium the site can tell of, else answers), what to check in the chat (an
// unknown outcome), whose version did not go and why, who was not written to. What came of the sends keeps coming by
// itself while the window lives.

import { type JSX } from 'preact';

import { type I18n, type OutreachSummaryFanVM, type OutreachSummaryLeftVM, type OutreachSummaryVM, type OutreachWindowVM } from '@cg/contracts/vm';

import { Button, Dot, useDispatch, useI18n } from '../kit';
import { NewcomerAvatar } from '../newcomers/frame';
import { reasonLine } from './rows';
import { asideText, mediaTitle, mediaShort } from './words';

/** Why a version did not go: the send's reason, else what the version's state says. */
function leftWords(i18n: I18n, fan: OutreachSummaryLeftVM): string {
  if (fan.reason !== null) return reasonLine(i18n.text(fan.reason));
  switch (fan.state) {
    case 'failed':
      return i18n.t('outreach.summary.leftFailed');
    case 'unwritten':
      return i18n.t('outreach.summary.leftUnwritten');
    case 'stopped':
      return i18n.t('outreach.summary.leftStopped');
    case 'queued':
    case 'writing':
      return i18n.t('outreach.summary.leftWriting');
    case 'idle':
      return i18n.t('outreach.summary.leftIdle');
    case 'ready':
    case 'sending':
    case 'accepted':
    case 'sent':
    case 'uncertain':
      return i18n.t('outreach.summary.leftReady');
  }
}

function Fan({ fan, children, end }: { readonly fan: OutreachSummaryFanVM; readonly children: JSX.Element | string; readonly end: JSX.Element | null }): JSX.Element {
  const dispatch = useDispatch();
  return (
    <div class="cg-ow__erow">
      <NewcomerAvatar name={fan.name} url={fan.avatarUrl} size="row" />
      <button type="button" class="cg-ow__ename" onClick={() => void dispatch({ type: 'OpenPreview', targetHandle: fan.handle })}>
        {fan.name}
      </button>
      <span class="cg-ow__emid">{children}</span>
      {end}
    </div>
  );
}

export function Summary({ vm, summary }: { readonly vm: OutreachWindowVM; readonly summary: OutreachSummaryVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const what = vm.media === null ? i18n.t('outreach.offer.textOnly') : mediaTitle(i18n, vm.media);
  // «с 19:12 до 19:40»; one minute — «в 19:12».
  const span =
    summary.from === null || summary.to === null
      ? ''
      : ` · ${i18n.formatTime(summary.from) === i18n.formatTime(summary.to) ? i18n.t('outreach.card.at', { time: { time: summary.from } }) : i18n.t('outreach.summary.span', { from: { time: summary.from }, to: { time: summary.to } })}`;
  const bought = summary.bought;
  const replied = summary.replied;
  const short = mediaShort(i18n, vm.media).toLowerCase();
  const stats = 2 + (summary.check.length > 0 ? 1 : 0);
  return (
    <section class="cg-ow__end" aria-label={i18n.t('outreach.summary.title')} data-cg-outreach-summary={bought === null ? 'replies' : 'purchases'}>
      <div class="cg-ow__ebody">
        <h2 class="cg-ow__etitle">{i18n.t('outreach.summary.title')}</h2>
        <div class="cg-ow__esub">
          {what}
          {span}
        </div>
        <div class={`cg-ow__stats${stats === 2 ? ' is-two' : ''}`}>
          <div class="cg-ow__stat">
            <span>{i18n.t('outreach.summary.sent')}</span>
            <b class="cg-num">{summary.sent}</b>
            <small>{i18n.plural('outreach.summary.sentOf', summary.total)}</small>
          </div>
          {bought !== null ? (
            <div class="cg-ow__stat">
              <span>{i18n.t('outreach.summary.bought')}</span>
              <b class={`cg-num${bought.mills > 0 ? ' cg-ow__money' : ''}`}>{bought.mills > 0 ? i18n.formatMoneyMills(bought.mills, { sign: 'plus' }) : i18n.formatMoneyMills(null)}</b>
              <small>{bought.fans.length === 0 ? i18n.t('outreach.summary.noneBought') : i18n.plural('outreach.summary.boughtFans', bought.fans.length, { what: short })}</small>
            </div>
          ) : (
            <div class="cg-ow__stat">
              <span>{i18n.t('outreach.summary.replied')}</span>
              <b class="cg-num">
                {replied?.length ?? 0} <i>{i18n.t('outreach.summary.of', { n: summary.total })}</i>
              </b>
              <small>{(replied?.length ?? 0) === 0 ? i18n.t('outreach.summary.noneReplied') : i18n.t('outreach.summary.repliedTail')}</small>
            </div>
          )}
          {summary.check.length > 0 ? (
            <div class="cg-ow__stat">
              <span>{i18n.t('outreach.summary.check')}</span>
              <b class="cg-num">{summary.check.length}</b>
              <small>{i18n.t('outreach.summary.checkTail')}</small>
            </div>
          ) : null}
        </div>
        {summary.check.length === 0 ? null : (
          <>
            <h4 class="cg-ow__eh">{i18n.t('outreach.summary.checkTitle')}</h4>
            {summary.check.map((fan) => (
              <Fan
                key={fan.handle}
                fan={fan}
                end={<Button label={i18n.t('outreach.card.verify')} variant="line" size="sm" onClick={() => void dispatch({ type: 'Navigate', to: { kind: 'chat', targetHandle: fan.handle } })} />}
              >
                <>
                  <Dot kind="ink" size={6} />
                  {fan.at === null ? i18n.t('outreach.row.uncertainShort') : i18n.t('outreach.summary.clicked', { time: { time: fan.at } })}
                </>
              </Fan>
            ))}
          </>
        )}
        {bought === null || bought.fans.length === 0 ? null : (
          <>
            <h4 class="cg-ow__eh">{i18n.t('outreach.summary.buyers')}</h4>
            {bought.fans.map((fan) => (
              <Fan key={fan.handle} fan={fan} end={<span class="cg-ow__money cg-num">{i18n.formatMoneyMills(fan.mills, { sign: 'plus' })}</span>}>
                {fan.boughtAt === null ? short : `${short} · ${i18n.t('outreach.card.at', { time: { time: fan.boughtAt } })}`}
              </Fan>
            ))}
          </>
        )}
        {replied === null || replied.length === 0 ? null : (
          <>
            <h4 class="cg-ow__eh">{i18n.t('outreach.summary.repliers')}</h4>
            {replied.map((fan) => (
              <Fan key={fan.handle} fan={fan} end={<span class="cg-num cg-ow__etime">{i18n.formatTime(fan.repliedAt)}</span>}>
                {fan.text === null ? <span class="cg-ow__q2">{i18n.t('outreach.summary.media')}</span> : <span class="cg-ow__quote">{fan.text}</span>}
              </Fan>
            ))}
          </>
        )}
        {summary.left.length === 0 ? null : (
          <>
            <h4 class="cg-ow__eh">
              {i18n.t('outreach.summary.left')} · <span class="cg-num">{summary.left.length}</span>
            </h4>
            {summary.left.map((fan) => (
              <Fan key={fan.handle} fan={fan} end={<Button label={i18n.t('outreach.summary.leftOpen')} variant="line" size="sm" onClick={() => void dispatch({ type: 'OpenPreview', targetHandle: fan.handle })} />}>
                <span class="cg-ow__q2" data-cg-left={fan.state}>
                  {leftWords(i18n, fan)}
                </span>
              </Fan>
            ))}
          </>
        )}
        {summary.quiet.length === 0 ? null : (
          <>
            <h4 class="cg-ow__eh">{i18n.t(bought === null ? 'outreach.summary.quietReplies' : 'outreach.summary.quietPurchases')}</h4>
            <div class="cg-ow__names">
              {summary.quiet.map((fan) => (
                <span key={fan.handle}>
                  <b>{fan.name}</b>
                  {fan.at === null ? null : <span class="cg-num">{i18n.formatTime(fan.at)}</span>}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div class="cg-ow__efoot">
        <span>{summary.skipped.length === 0 ? '' : i18n.t('outreach.summary.skipped', { list: summary.skipped.map((item) => `${item.name} ${asideText(i18n, item.reason, vm.media).toLowerCase()}`).join('; ') })}</span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t('outreach.summary.fresh')} variant="line" size="sm" tooltip={i18n.t('outreach.summary.freshTooltip')} onClick={() => void dispatch({ type: 'SetOutreach', fresh: true })} />
      </div>
    </section>
  );
}
