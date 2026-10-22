// The toolbar popup (ui-design §4.23; architecture.md §9.9; PU-001…PU-022):
// 360 px, the frame and shadow are the browser's. In the agency identity
// (X32), and since X61 in the order the person reads it: whose voice this
// shift writes in (the persona's name in the display face), then the verdict —
// the stage of «Статус», the pond when ready, the gosling's yellow with what to
// fix and its one remedy — then the facts on one paper-white card and the
// windows that open inside the site's tab; «Настройки» at the head, the
// optional site's switch in the one line of the foot. A background that does not
// answer is a card with its code, never an endless spinner (PU-001); without a
// sign-in the popup leads to «Аккаунт» (PU-002).

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { type CgCode, type CgErrorTone } from '@cg/contracts/errors';
import { type PopupVerdictVM, type PopupVM } from '@cg/contracts/vm';

import { Button, Dot, ErrorCard, Kbd, hotkeyText, useDispatch, useI18n, useKit, useTooltip, useView } from '../kit';
import { ChatGooseLogo, LostArt, TrioArt } from './brand/art';
import { PageLayers, PageTag, pageTagText, useAct, usePageServices } from './shared';
import { SiteSwitch, SiteSwitchError, useSiteAccess, waitingReloadOf } from './SiteAccess';

/** A value that copies itself on a click (PU-007): the id is text the popup already holds. */
function CopyValue({ text, value, tooltip }: { readonly text: string; readonly value: string; readonly tooltip: string }): JSX.Element {
  const i18n = useI18n();
  const { deps, report, surface } = useKit();
  const services = usePageServices();
  const tip = useTooltip(tooltip);
  return (
    <>
      <button
        type="button"
        class="pg-popup__copy"
        {...tip.props}
        onClick={() => {
          void deps.clipboard.writeText(value).then(
            (result) => {
              if (result.ok) services.success(i18n.t('popup.copiedId'), 'copy-id');
              else report({ kind: 'clipboard', surface, code: result.code, name: 'ClipboardError' });
            },
            (error: unknown) => report({ kind: 'clipboard', surface, code: 'CG-CLIPBOARD', name: error instanceof Error ? error.name : typeof error }),
          );
        }}
      >
        {text}
      </button>
      {tip.description}
    </>
  );
}

/** Whose voice: the persona, the page it writes for and the page's platform and label. */
function Persona({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const persona = vm.persona;
  return (
    <div class="pg-popup__sec pg-popup__hero">
      <div class="pg-popup__cap">{i18n.t('popup.persona')}</div>
      {/* The persona's name is what the popup is for: it stands alone in the display face, the page under it; each ends in «…» on its own. */}
      <div class="pg-popup__line pg-popup__line--fit">
        <b class={persona.s === 'set' ? undefined : 'pg-popup__none'}>{persona.s === 'set' ? persona.label : persona.s === 'no-persona' ? i18n.t('popup.personaNone') : i18n.t('popup.notConnected')}</b>
        {persona.s === 'not-connected' ? null : (
          <span class="pg-popup__aside" title={i18n.t('popup.personaFor', { page: persona.pageName })}>
            {i18n.t('popup.personaFor', { page: persona.pageName })}
          </span>
        )}
      </div>
      {/* The platform and the hub's page label — what tells pages of one title apart — on a muted line of their own. */}
      {persona.s === 'not-connected' || persona.page === undefined ? null : (
        <div class="pg-popup__under" title={pageTagText(persona.page)}>
          <PageTag tag={persona.page} />
        </div>
      )}
    </div>
  );
}

/** One thing to fix as the stage draws it: the view model's, or the optional site's tabs that wait for a reload. */
interface StageAlert {
  readonly code: CgCode;
  readonly tone: CgErrorTone;
  readonly title: string;
  readonly body: string | null;
  /** `short` — the remedy's word on the line of a second problem («Перезагрузить»): the line keeps its title. */
  readonly fix: { readonly label: string; readonly short?: string; readonly busy: boolean; readonly run: () => Promise<unknown> } | null;
}

/** A producer older than 1.35.0 says no verdict: its problems are the alerts, without remedies. */
function verdictOf(vm: PopupVM): PopupVerdictVM {
  if (vm.verdict !== undefined) return vm.verdict;
  if (vm.problems.length > 0) return { s: 'attention', line: null, alerts: vm.problems.map((problem) => ({ code: problem.code, tone: problem.tone ?? 'state', title: problem.title, body: problem.body, fix: null })) };
  return { s: vm.pills.host === 'unknown' || vm.pills.hub === 'unknown' ? 'checking' : 'ready', line: null, alerts: [] };
}

/** The remedy's button: busy while its action runs (the tab reloads, the rights are asked), whoever started it. */
function Fix({ fix, primary }: { readonly fix: NonNullable<StageAlert['fix']>; readonly primary: boolean }): JSX.Element {
  const [running, setRunning] = useState(false);
  return (
    <Button
      label={fix.label}
      // The first problem's remedy is the popup's one black button; another's is a quiet word on its line.
      {...(primary ? { variant: 'line' as const, class: 'pg-primary' } : { variant: 'quiet' as const, size: 'sm' as const })}
      busy={fix.busy || running}
      onClick={() => {
        setRunning(true);
        void fix.run().finally(() => setRunning(false));
      }}
    />
  );
}

/**
 * The verdict (X61), the stage of «Статус» in the popup's width: «Готово к смене» on the pond with the three
 * goslings; what to fix on the gosling's yellow — the first in the display face with its remedy as the one black
 * button, the goose looking back beside it, the rest as quiet lines under it; the shade while a report is not in.
 */
function Stage({ vm, siteOnly = false }: { readonly vm: PopupVM; readonly siteOnly?: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const act = useAct();
  const services = usePageServices();
  const access = useSiteAccess();
  // Signed out or the background silent: the popup's own verdict is the state card; the optional site's tabs that
  // wait for a reload still are said (FS-IDN-4: «Включить Fansly» works before a sign-in).
  const verdict: PopupVerdictVM = siteOnly ? { s: 'checking', line: null, alerts: [] } : verdictOf(vm);
  const waiting = access === null ? 0 : waitingReloadOf(access.view);
  const own: StageAlert[] = verdict.alerts.map((alert) => {
    const fix = alert.fix;
    const short = alert.code === 'CG-RUNTIME-RELOADED' ? { short: i18n.t('popup.alert.reloadShort') } : {};
    return { code: alert.code, tone: alert.tone, title: alert.title, body: alert.body, fix: fix === null ? null : { label: i18n.text(fix.label), ...short, busy: alert.busy === true, run: () => act(fix.action) } };
  });
  const site: StageAlert[] =
    access === null || waiting === 0
      ? []
      : [
          {
            code: 'CG-RUNTIME-RELOADED',
            tone: 'state',
            title: i18n.t(waiting === 1 ? 'popup.alert.reloadTitleOne' : 'popup.alert.reloadTitleMany', { site: access.props.title }),
            body: i18n.plural('popup.site.reloadBody', waiting, { site: access.props.title }),
            fix: {
              label: i18n.t(waiting === 1 ? 'popup.alert.reloadOne' : 'siteAccess.reload'),
              short: i18n.t('popup.alert.reloadShort'),
              busy: access.view.busy,
              run: async () => {
                await access.props.control.reload();
                const reloaded = access.props.control.value.state?.reloaded;
                if (reloaded !== undefined && reloaded > 0) services.success(i18n.t('siteAccess.reloaded', { count: reloaded }), 'site-reload');
              },
            },
          },
        ];
  // The optional site's tabs waiting for a reload are where the work is: «Откройте …» would only send the person away.
  const alerts = site.length === 0 ? own : [...own.filter((alert) => alert.code === 'CG-RUNTIME-RELOADED'), ...site, ...own.filter((alert) => alert.code !== 'CG-RUNTIME-RELOADED' && alert.code !== 'CG-HOST-NOT-READY')];
  const first = alerts[0];
  if (first === undefined && siteOnly) return null;
  if (first === undefined) {
    const ready = verdict.s === 'ready';
    return (
      <section class="pg-popup__stage" data-pg-verdict={ready ? 'ready' : 'checking'} role="status">
        <b>{ready ? i18n.t('settings.status.ready') : i18n.t('popup.verdict.checking')}</b>
        {ready && verdict.line !== null ? <span>{verdict.line}</span> : null}
        {ready ? <TrioArt class="pg-art" /> : null}
      </section>
    );
  }
  return (
    <section class="pg-popup__stage" data-pg-verdict="attention" role="status" aria-label={i18n.t('popup.problems')}>
      {/* The code is for whoever helps the person: it stays on the card (support, the e2e), in the tooltip, not in the words. */}
      <div class="pg-popup__alert" data-cg-code={first.code} title={first.code}>
        <b class="pg-popup__alert-t">{first.title}</b>
        {first.body === null ? null : <p>{first.body}</p>}
        {first.fix === null ? null : <Fix fix={first.fix} primary />}
        <LostArt class="pg-art pg-art--lost" />
      </div>
      {alerts.length === 1 ? null : (
        <ul class="pg-popup__more">
          {alerts.slice(1).map((alert, index) => (
            // The rest is a line each — the words in the tooltip: the popup fits the browser's 600 px with two problems.
            <li key={`${alert.code}-${String(index)}`} data-cg-code={alert.code} title={alert.body === null ? alert.code : `${alert.body} (${alert.code})`}>
              <Dot kind={alert.tone === 'failure' ? 'danger' : 'ring'} />
              <b>{alert.title}</b>
              {alert.fix === null ? null : <Fix fix={{ ...alert.fix, label: alert.fix.short ?? alert.fix.label }} primary={false} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type PopupChat = NonNullable<PopupVM['chat']>;

/** The number a click on the open dialog copies: the conversation where it has its own (Fansly's group), else the fan. */
function chatIdOf(chat: PopupChat): string {
  return chat.copyIds.conversationRef ?? chat.copyIds.fanId ?? chat.copyIds.hostAccountId;
}

/** «Скопировать номер чата 8100… · фан 9200… · Fansly 7000…»: every id of the dialog, said once, in the name's tooltip. */
function chatIdsTooltip(i18n: ReturnType<typeof useI18n>, chat: PopupChat): string {
  const { conversationRef, fanId, creatorId, hostAccountId } = chat.copyIds;
  return [
    i18n.t('popup.copyChatId', { id: chatIdOf(chat) }),
    conversationRef !== undefined && fanId !== undefined ? i18n.t('popup.fanId', { id: fanId }) : null,
    chat.hostAccountLabel,
    creatorId !== null && creatorId !== hostAccountId ? creatorId : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** The open dialog, the quota and who is signed in: one line each, the word on the left, the value on the right. */
function Facts({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const services = usePageServices();
  const act = useAct();
  const quota = vm.quota;
  const signOut = vm.account?.signOut ?? null;
  // The quota is said once it is known (the old popup's rule: no row beats a made-up number); the hub down is on the stage.
  const quotaKnown = vm.pills.hub !== 'down' && quota !== null && quota.remaining !== null;
  return (
    <dl class="pg-popup__facts">
      <div class="pg-popup__fact" data-pg-fact="dialog">
        <dt>{i18n.t('popup.dialog')}</dt>
        {vm.chat === null ? (
          <dd>
            <span class="pg-popup__nil">{i18n.t('popup.dialogNone')}</span>
          </dd>
        ) : (
          <dd>
            {/* 2026-10-22 (the old popup): the fan's name and @handle; the ids live in the name's tooltip, and a click on
                the name copies the chat's own number — what support asks for. */}
            <b class="pg-popup__who">
              <CopyValue text={vm.chat.fanName} value={chatIdOf(vm.chat)} tooltip={chatIdsTooltip(i18n, vm.chat)} />
              {vm.chat.fanUsername === null ? null : <span class="pg-popup__handle">{` @${vm.chat.fanUsername.replace(/^@/, '')}`}</span>}
            </b>
          </dd>
        )}
      </div>
      {!quotaKnown || quota === null || quota.remaining === null ? null : (
        <div class="pg-popup__fact" data-pg-fact="quota">
          <dt>{i18n.t('popup.quota')}</dt>
          <dd>
            {/* PU-009 without amber: the gosling's egg before the number when the quota is low or gone, said in the tooltip. */}
            <b title={quota.low && quota.resetsAt !== null ? i18n.plural('dock.quota.lowTooltip', quota.remaining, { time: { time: quota.resetsAt } }) : undefined}>
              {quota.low ? <Dot kind="ring" /> : null}
              {i18n.t('popup.quotaLeft', { n: quota.remaining })}
            </b>
            {quota.resetsAt === null ? null : <small class="pg-popup__by">{i18n.t('popup.quotaReset', { time: { time: quota.resetsAt } })}</small>}
          </dd>
        </div>
      )}
      {vm.account === null || signOut === null ? null : (
        <div class="pg-popup__fact" data-pg-fact="account">
          <dt>{i18n.t('popup.account')}</dt>
          <dd>
            <b>{vm.account.login}</b>
            <Button
              label={i18n.text(signOut.label)}
              variant="quiet"
              size="sm"
              onClick={() => {
                // Signing out is asked once more (ST-051): it erases the sign-in of this device.
                void services
                  .confirm({
                    title: { key: 'settings.account.signOutTitle' },
                    body: { key: 'settings.account.signOutBody' },
                    confirm: { key: 'common.signOut' },
                    cancel: { key: 'common.cancel' },
                    tone: 'destructive',
                  })
                  .then((answer) => (answer === 'confirm' ? act(signOut.action) : null));
              }}
            />
          </dd>
        </div>
      )}
      {vm.aiTodayLine === null ? null : <div class="pg-popup__fact pg-popup__fact--note">{vm.aiTodayLine}</div>}
    </dl>
  );
}

/**
 * Spenders, «Новые» and «Клавиши» open inside the site's tab, in one row: without the tab they are not drawn — the stage
 * says to open or reload it (X61).
 */
function Windows({ vm }: { readonly vm: PopupVM }): JSX.Element | null {
  const i18n = useI18n();
  const act = useAct();
  const windows = vm.buttons.filter((button) => button.action.type !== 'OpenSettings' && button.enabled);
  if (windows.length === 0) return null;
  return (
    <div class="pg-popup__btns">
      {windows.map((button, index) => {
        const keys = hotkeyText(button.hotkey);
        const newcomers = button.action.type === 'Navigate' && button.action.to.kind === 'surface' && button.action.to.surface === 'newcomers';
        const count = newcomers ? vm.newcomersCount : null;
        return (
          <Button
            key={index}
            label={i18n.text(button.label)}
            variant="line"
            tooltip={count === null ? null : i18n.t('popup.newcomersTooltip', { hours: 48, n: count })}
            onClick={() => void act(button.action)}
            trailing={
              <>
                {/* The count of «Новые» is not a shortcut: it stands right after the word (§4.23). */}
                {count === null ? null : <span class="pg-popup__count">{count}</span>}
                <span class="pg-popup__key">{keys === null ? null : <Kbd>{keys.display}</Kbd>}</span>
              </>
            }
          />
        );
      })}
    </div>
  );
}

/** One line: «Что нового», the optional site's switch (X61: no row of its own), «Обновить статус». */
function Footer({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  return (
    <div class="pg-popup__foot">
      <button type="button" class="pg-link" onClick={() => void act(vm.links.whatsNew)}>
        {i18n.t('popup.whatsNew')}
      </button>
      <SiteSwitch />
      <Button label={vm.refreshing ? i18n.t('popup.refreshing') : i18n.text(vm.refresh.label)} variant="quiet" size="sm" icon="refresh" busy={vm.refreshing} onClick={() => void act(vm.refresh.action)} />
    </div>
  );
}

/** «Скачать лог» (2026-10-21): the files of the last 24 hours, in one click, for the lead — under the foot, in every state of the popup. */
function LogDownload(): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  return (
    <div class="pg-popup__log">
      <Button
        label={i18n.t('log.download')}
        variant="quiet"
        size="sm"
        icon="download"
        tooltip={i18n.t('log.downloadHint')}
        onClick={() => void act({ type: 'DownloadLog' }, { success: i18n.t('log.downloaded') })}
      />
    </div>
  );
}

export function Popup(): JSX.Element {
  const vm = useView({ of: 'popup' }).value;
  const i18n = useI18n();
  const dispatch = useDispatch();
  const act = useAct();
  const view = vm.view;
  const settings = vm.buttons.find((button) => button.action.type === 'OpenSettings') ?? null;
  const plainSignIn = view.s === 'forbidden' && view.error.code === 'CG-AUTH-REQUIRED';
  return (
    <div class="pg-popup" role="main" aria-label="ChatGoose">
      {/* «Настройки» at the head, in every state (PU-010): the one black button is the stage's remedy, if any (X61). */}
      <div class="pg-popup__head">
        <ChatGooseLogo class="pg-logo" />
        {/* The version opens its history (PU-011): the foot keeps one line. */}
        <button type="button" class="pg-popup__ver" title={i18n.t('popup.history')} aria-label={`${i18n.t('popup.history')} ${vm.version}`} onClick={() => void act(vm.links.changelog)}>
          {vm.version}
        </button>
        {settings === null || view.s === 'loading' ? null : (
          <Button label={i18n.text(settings.label)} variant="line" size="sm" class="pg-popup__settings" onClick={() => void act(settings.action)} />
        )}
      </div>
      {view.s === 'loading' ? (
        <div class="cg-state cg-state--loading" role="status" aria-busy="true">
          {i18n.t('common.loading')}
        </div>
      ) : view.s === 'error' ? (
        // PU-001: the background did not answer — say so, offer the retry and the settings.
        <div class="pg-popup__state">
          <ErrorCard tone="failure" error={view.error} inline>
            {view.retry === null ? null : <Button label={i18n.t('common.retry')} variant="line" class="pg-primary" onClick={() => void dispatch(view.retry ?? { type: 'ReloadView', selector: { of: 'popup' } })} />}
          </ErrorCard>
        </div>
      ) : view.s === 'forbidden' ? (
        // PU-002: not signed in — the one thing to do is to sign in on the settings page.
        <div class="pg-popup__state">
          {/* «Нужно войти»: the registry's sentence sends the person to the extension's icon — which is this very
              popup. Here the card says the popup's own: where to sign in. Any other reason (revoked, expired)
              keeps its own words, and the lead follows it. */}
          <ErrorCard tone="state" error={plainSignIn ? { ...view.error, body: i18n.t('popup.signInLead') } : view.error} copyCode={false} alert={false} inline>
            {view.remedy === null ? null : <Button label={i18n.t('common.signIn')} variant="line" class="pg-primary" onClick={() => void dispatch(view.remedy ?? { type: 'OpenSettings', route: { section: 'account' } })} />}
          </ErrorCard>
          {plainSignIn ? null : <p class="pg-popup__lead pg-sub">{i18n.t('popup.signInLead')}</p>}
        </div>
      ) : null}
      {view.s === 'error' || view.s === 'forbidden' ? <Stage vm={vm} siteOnly /> : null}
      {view.s === 'loading' || view.s === 'error' || view.s === 'forbidden' ? null : (
        <>
          <Persona vm={vm} />
          <Stage vm={vm} />
          <Facts vm={vm} />
          <Windows vm={vm} />
        </>
      )}
      <SiteSwitchError />
      <Footer vm={vm} />
      <LogDownload />
      <PageLayers />
    </div>
  );
}
