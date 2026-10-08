// The fan panel (architecture.md §10.2 FanPanelVM, D-29; ui-design §3.7,
// §4.18, §10; CS-017, CS-031…CS-038): a 320 px side panel at the right edge
// of ChatSpace's container — who this is and when they were last seen, money
// by kind, the subscription with the churn risk, ChatSpace's own scores when
// it already holds them, the bio and lists, the Recap tab, and how old and
// how complete the data is. With no chat open it says «Выберите чат». It does
// not hold focus; Esc inside closes it. Avatars are initials: no remote
// images. A missing source is «—», never a guess.

import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type FanPanelVM, type I18n, type RecapLength, type RecapViewVM } from '@cg/contracts/vm';

import { Button, Markdown, Money, OverlayLayer, Segmented, SidePanel, StageLine, Tabs, ViewState, hotkeyText, useDispatch, useHints, useI18n, useMinuteClock, useView } from '../kit';

type Kind = NonNullable<FanPanelVM['spent']>['byKind'][number]['kind'];

const KIND_KEYS: Readonly<Record<Kind, I18nKey>> = {
  messages: 'fanPanel.byKind.messages',
  tips: 'fanPanel.byKind.tips',
  subscription: 'fanPanel.byKind.subscription',
  posts: 'fanPanel.byKind.posts',
  other: 'fanPanel.byKind.other',
};

const CHURN_KEYS = { low: 'fanPanel.churn.low', medium: 'fanPanel.churn.medium', high: 'fanPanel.churn.high' } as const;

const TABS_ID = 'cg-fp';

function unknown(i18n: I18n): string {
  return i18n.formatMoneyMills(null);
}

/** «@hubert_pl, был 6 мин назад»; someone ChatSpace shows online is «в сети». */
function presence(i18n: I18n, fan: NonNullable<FanPanelVM['fan']>): string | null {
  const handle = fan.username === null ? null : `@${fan.username}`;
  if (fan.online === true) return handle === null ? i18n.t('fanPanel.online') : i18n.t('fanPanel.subOnline', { handle });
  if (fan.lastSeenAt === null) return handle;
  return handle === null ? i18n.t('fanPanel.lastSeen', { age: { age: fan.lastSeenAt } }) : i18n.t('fanPanel.sub', { handle, age: { age: fan.lastSeenAt } });
}

function subscribedText(i18n: I18n, subscription: NonNullable<FanPanelVM['subscription']>): string {
  const { months, since } = subscription;
  const date = since === null ? null : i18n.formatTime(since, 'date');
  if (months !== null && date !== null) return i18n.t('fanPanel.subscribedValue', { months, date });
  if (months !== null) return i18n.t('fanPanel.subscribedMonths', { months });
  if (date !== null) return i18n.t('fanPanel.subscribedSince', { date });
  return unknown(i18n);
}

function Kv({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd class="cg-num">{value}</dd>
    </>
  );
}

function FanTab({ vm }: { readonly vm: FanPanelVM }): JSX.Element {
  const i18n = useI18n();
  const { spent, subscription, host } = vm;
  const mark = unknown(i18n);
  const kinds = (spent?.byKind ?? []).filter((entry) => entry.mills !== 0);
  return (
    <>
      <div class="cg-fp__sec">
        <div class="cg-fp__cap">{i18n.t('fanPanel.spent')}</div>
        {/* A known zero of money is not drawn (ui-design §1 п. 6): «трат нет» under the caption, and no rows of
            kinds that brought nothing. Unknown stays «—». */}
        {spent !== null && spent.total === 0 ? (
          <div class="cg-fp__none">{i18n.t('fanPanel.spentNone')}</div>
        ) : (
          <div class="cg-fp__hero">
            <Money mills={spent?.total ?? null} class="cg-fp__big" />
            {spent !== null && spent.period30 !== null && spent.period30 > 0 ? <span class="cg-fp__in cg-money cg-num">{i18n.t('fanPanel.spentIn', { moneyIn: { money: spent.period30, sign: 'plus' } })}</span> : null}
          </div>
        )}
        {kinds.length === 0 ? null : (
          <dl class="cg-fp__kv">
            {kinds.map((entry) => (
              <Kv key={entry.kind} label={i18n.t(KIND_KEYS[entry.kind])} value={i18n.formatMoneyMills(entry.mills)} />
            ))}
          </dl>
        )}
      </div>
      <div class="cg-fp__sec">
        <div class="cg-fp__cap">{i18n.t('fanPanel.subscription')}</div>
        <dl class="cg-fp__kv cg-fp__kv--flush">
          <Kv label={i18n.t('fanPanel.subscribedLabel')} value={subscription === null ? mark : subscribedText(i18n, subscription)} />
          <Kv
            label={i18n.t('fanPanel.autoRenew')}
            value={subscription === null || subscription.autoRenew === null ? mark : i18n.t(subscription.autoRenew ? 'fanPanel.autoRenew.on' : 'fanPanel.autoRenew.off')}
          />
          <Kv label={i18n.t('fanPanel.churn')} value={subscription === null || subscription.churnRisk === null ? i18n.t('fanPanel.churn.unknown') : i18n.t(CHURN_KEYS[subscription.churnRisk])} />
          {/* ChatSpace's own estimates, only when it already holds them (D-29): shown as it names them. */}
          {host === null || host.buyingPower === null ? null : <Kv label={i18n.t('fanPanel.buyingPower')} value={host.buyingPower} />}
          {host === null ? null : host.scores.map((score) => <Kv key={score.label} label={score.label} value={score.value} />)}
        </dl>
      </div>
      {vm.bio === null || vm.bio === '' ? null : (
        <div class="cg-fp__sec">
          <div class="cg-fp__cap">{i18n.t('fanPanel.bio')}</div>
          {/* The hub's profile of the fan is a Markdown document (the saved full Recap); ChatSpace's own «О себе» is plain text. */}
          {vm.bioSource === 'hub' ? <Markdown source={vm.bio} class="cg-fp__md" /> : <p class="cg-fp__text">{vm.bio}</p>}
        </div>
      )}
      {vm.lists.length === 0 ? null : (
        <div class="cg-fp__sec">
          <div class="cg-fp__cap">{i18n.t('fanPanel.lists')}</div>
          <p class="cg-fp__text">{vm.lists.join(', ')}</p>
        </div>
      )}
    </>
  );
}

type Coverage = FanPanelVM['footer']['stamp']['coverage'];

/**
 * «Архив» of the Recap tab. A Recap that knows what it was built over says so; one that does not (a copy read back
 * from the hub carries no coverage) is not called «неполный» for a thing nobody measured: it says what the panel's
 * footer says of the same archive, and «неизвестно» when the panel does not know either.
 */
function recapArchive(i18n: I18n, recap: RecapViewVM, panel: Coverage): string {
  if (recap.archiveLag !== null) return recap.archiveLag.messages === null ? i18n.t('fanPanel.recap.archivePartial') : i18n.plural('recap.archiveLag', recap.archiveLag.messages);
  const coverage = recap.stamp.coverage === 'unknown' ? panel : recap.stamp.coverage;
  return i18n.t(coverage === 'complete' ? 'fanPanel.recap.archiveComplete' : coverage === 'partial' ? 'fanPanel.recap.archivePartial' : 'common.unknown');
}

/** The Recap tab: the shared Recap of the page, fan and persona (D-31), short or full, with its facts. */
function RecapTab({ archive }: { readonly archive: Coverage }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const recap = useView({ of: 'recap.view' }).value;
  useMinuteClock(recap.generatedAt !== null);
  const refresh = recap.refresh;
  const keys = hotkeyText(refresh.hotkey);
  const running = recap.state === 'admitted' || recap.state === 'requesting' || recap.state === 'streaming';
  const hasText = recap.markdown !== null && recap.view.s !== 'error' && recap.view.s !== 'forbidden';
  const retrySave = recap.saved.s === 'failed' ? recap.saved.retry : null;
  return (
    <>
      <div class="cg-fp__sec">
        <div class="cg-fp__cap cg-fp__cap--mid">
          <span>{recap.targetName === null ? i18n.t('fanPanel.tab.recap') : i18n.t('recap.forFan', { name: recap.targetName })}</span>
          <Segmented<RecapLength>
            label={i18n.t('recap.lengthLabel')}
            value={recap.length}
            options={[
              { value: 'short', label: i18n.t('recap.short') },
              { value: 'full', label: i18n.t('recap.full') },
            ]}
            onChange={(length) => void dispatch({ type: 'ShowRecap', length })}
          />
        </div>
        {running && recap.phase !== null ? (
          <div class="cg-fp__stage" aria-busy="true">
            <StageLine phase={recap.phase} startedAt={recap.phase.startedAt} />
          </div>
        ) : null}
        {hasText && recap.blocks === null ? <Markdown source={recap.markdown ?? ''} class="cg-fp__md" /> : null}
        {!hasText && !running ? <ViewState view={recap.view} /> : null}
      </div>
      {hasText && recap.blocks !== null
        ? recap.blocks.map((block) => (
            <div key={block.heading} class="cg-fp__sec">
              <div class="cg-fp__cap">{block.heading}</div>
              <Markdown source={block.markdown} class="cg-fp__md" />
            </div>
          ))
        : null}
      <div class="cg-fp__sec">
        {hasText ? (
          <dl class="cg-fp__kv cg-fp__kv--flush">
            <Kv label={i18n.t('fanPanel.recap.made')} value={recap.generatedAt === null ? unknown(i18n) : i18n.t('common.agoSuffix', { age: { age: recap.generatedAt } })} />
            {recap.saved.s === 'not-applicable' ? null : (
              <Kv
                label={i18n.t('fanPanel.recap.hub')}
                value={recap.saved.s === 'saved' ? i18n.t('fanPanel.recap.hubSaved') : recap.saved.s === 'saving' ? i18n.t('common.saving') : recap.saved.error.title}
              />
            )}
            <Kv label={i18n.t('fanPanel.recap.archive')} value={recapArchive(i18n, recap, archive)} />
          </dl>
        ) : null}
        <div class="cg-fp__acts">
          <Button
            label={i18n.t('fanPanel.recap.refresh')}
            variant="line"
            hotkey={refresh.hotkey}
            busy={running}
            tooltip={hints ? i18n.t('recap.refreshTooltip', { hotkey: keys?.display ?? '' }).trim() : null}
            reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
            onClick={() => void dispatch(refresh.action)}
          />
          {/* CG-RECAP-SAVE: only the idempotent reference write repeats, never the AI. */}
          {retrySave === null ? null : <Button label={i18n.t('common.retry')} variant="plain" onClick={() => void dispatch(retrySave)} />}
        </div>
      </div>
    </>
  );
}

function footerArchive(i18n: I18n, vm: FanPanelVM): string {
  const { stamp, archiveMessages } = vm.footer;
  if (archiveMessages === null) return stamp.coverage === 'complete' ? i18n.t('recap.archiveComplete') : i18n.t(stamp.coverage === 'partial' ? 'common.coverage.partial' : 'common.coverage.unknown');
  if (stamp.coverage === 'complete') return i18n.plural('fanPanel.footer', archiveMessages);
  return i18n.plural('fanPanel.footerCoverage', archiveMessages, { coverage: i18n.t(stamp.coverage === 'partial' ? 'common.coverage.partial' : 'common.coverage.unknown') });
}

export function FanPanel(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'fan-panel' }).value;
  // «был 6 мин назад» moves with the clock.
  useMinuteClock(vm.fan !== null);
  const fan = vm.fan;
  const close = (): void => void dispatch(vm.close);
  const sub = fan === null ? vm.personaLabel : presence(i18n, fan);
  const body = vm.view.s === 'error' || vm.view.s === 'forbidden' || (vm.view.s === 'loading' && fan === null);

  return (
    <OverlayLayer>
      <SidePanel label={i18n.t('fanPanel.label')} class="cg-fp" onClose={close}>
        <div class="cg-fp__head" data-cg-fanpanel={vm.view.s}>
          {fan === null ? null : (
            <span class="cg-fp__av" aria-hidden="true">
              {fan.initials}
            </span>
          )}
          <div class="cg-fp__who">
            <h2 class="cg-fp__name">{fan === null ? i18n.t('dock.label') : fan.name}</h2>
            {sub === null ? null : <div class="cg-fp__sub cg-num">{sub}</div>}
          </div>
          <Button label={i18n.t('common.close')} icon="x" iconOnly variant="quiet" onClick={close} />
        </div>
        {vm.view.s === 'empty' ? (
          // No chat is open: «Выберите чат» (CS-038).
          <div class="cg-fp__empty" role="status">
            <b>{i18n.t('fanPanel.empty.title')}</b>
            {i18n.t('fanPanel.empty.body')}
          </div>
        ) : body ? (
          <div class="cg-fp__body">
            <ViewState view={vm.view} />
          </div>
        ) : (
          <>
            <div class="cg-fp__tabs">
              <Tabs<FanPanelVM['tab']>
                label={i18n.t('fanPanel.label')}
                idPrefix={TABS_ID}
                value={vm.tab}
                tabs={[
                  { value: 'fan', label: i18n.t('fanPanel.tab.fan') },
                  { value: 'recap', label: i18n.t('fanPanel.tab.recap') },
                ]}
                onChange={(tab) => void dispatch({ type: 'SetFanPanelTab', tab })}
              />
            </div>
            <div class="cg-fp__body" role="tabpanel" id={`${TABS_ID}-${vm.tab}`} aria-labelledby={`${TABS_ID}-tab-${vm.tab}`} tabIndex={0}>
              {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
              {vm.tab === 'fan' ? <FanTab vm={vm} /> : <RecapTab archive={vm.footer.stamp.coverage} />}
            </div>
            <div class="cg-fp__foot">
              <span>{vm.footer.stamp.asOf === null ? '' : i18n.t('common.dataAsOfCap', { time: { time: vm.footer.stamp.asOf } })}</span>
              <span>{footerArchive(i18n, vm)}</span>
            </div>
          </>
        )}
      </SidePanel>
    </OverlayLayer>
  );
}

export const FAN_PANEL_CSS = `
.cg-fp { font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }
.cg-fp__head { flex: none; display: flex; align-items: flex-start; gap: 10px; padding: 14px 8px 10px 16px; }
.cg-fp__av {
  width: 36px; height: 36px; border-radius: var(--cg-r-pill); flex: none; display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--cg-text-base); font-weight: 600; color: var(--cg-ink-2); box-shadow: inset 0 0 0 1px var(--cg-rule-3);
}
.cg-fp__who { flex: 1; min-width: 0; }
.cg-fp__name { font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fp__sub { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fp__tabs { flex: none; padding: 0 12px 8px; border-bottom: 1px solid var(--cg-rule); }
.cg-fp__body { flex: 1; min-height: 160px; overflow-y: auto; scrollbar-width: thin; }
.cg-fp__body:focus-visible { outline-offset: -2px; }
.cg-fp__sec { padding: 12px 16px; border-top: 1px solid var(--cg-rule); }
.cg-fp__sec:first-child { border-top: 0; }
.cg-fp__cap { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-bottom: 6px; display: flex; justify-content: space-between; gap: 8px; }
.cg-fp__cap--mid { align-items: center; }
/* The total and «+$320 за 30 дней» share one line of text, on the big number's baseline. */
.cg-fp__hero { font-size: var(--cg-text-3xl); line-height: 28px; }
.cg-fp__big { font-weight: 600; color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.cg-fp__none { color: var(--cg-ink-2); line-height: 24px; }
.cg-fp__in { margin-left: 8px; font-size: var(--cg-text-base); font-weight: 500; letter-spacing: 0; white-space: nowrap; }
.cg-fp__kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; margin: 6px 0 0; }
.cg-fp__kv--flush { margin-top: 0; }
.cg-fp__kv > * { line-height: 24px; margin: 0; min-width: 0; }
.cg-fp__kv dt { color: var(--cg-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fp__kv dd { font-weight: 500; color: var(--cg-ink); text-align: right; overflow-wrap: anywhere; max-width: 100%; }
.cg-fp__text, .cg-fp__md { font-size: var(--cg-text-md); line-height: 20px; color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-fp__md p, .cg-fp__md li { max-width: none; }
.cg-fp__stage { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.cg-fp__acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0 -8px; }
.cg-fp__kv + .cg-fp__acts { margin-top: 8px; }
.cg-fp__sec .cg-state, .cg-fp__sec .cg-card { padding-left: 0; padding-right: 0; }
.cg-fp__foot { flex: none; padding: 8px 16px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; }
.cg-fp__foot span { white-space: nowrap; }
.cg-fp__empty { margin: auto; padding: 24px; text-align: center; color: var(--cg-ink-muted); max-width: 30ch; }
.cg-fp__empty b { display: block; font-size: var(--cg-text-xl); font-weight: 600; color: var(--cg-ink-strong); margin-bottom: 6px; }
`;
