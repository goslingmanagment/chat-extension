// The toolbar popup (ui-design §4.23, final-20a / 20b; architecture.md §9.9;
// PU-001…PU-022): 360 px, the frame and shadow are the browser's. Pills say
// what is connected, rows say who, where and how much quota, four buttons
// open what lives inside ChatSpace. A background that does not answer is a
// card with its code, never an endless spinner (PU-001); without a sign-in
// the popup leads to «Аккаунт» (PU-002).

import { type JSX } from 'preact';

import { type PopupVM } from '@cg/contracts/vm';

import { ActionButton, Button, CodeLine, Dot, ErrorCard, GooseMark, Icon, Kbd, hotkeyText, useDispatch, useI18n, useKit, useTooltip, useView } from '../kit';
import { PageLayers, PageTag, useAct, usePageServices } from './shared';

function Pill({ label, mark }: { readonly label: string; readonly mark: 'ok' | 'ring' | 'danger' }): JSX.Element {
  // «ChatSpace: подключён» — the state in strong ink after the colon.
  const cut = label.indexOf(': ');
  return (
    <span class="pg-pill">
      {mark === 'ok' ? <Icon name="check" size={14} /> : <Dot kind={mark} />}
      {cut < 0 ? (
        <b>{label}</b>
      ) : (
        <>
          {label.slice(0, cut + 1)} <b>{label.slice(cut + 2)}</b>
        </>
      )}
    </span>
  );
}

function Pills({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const host = {
    connected: ['popup.pill.chatspace.connected', 'ok'],
    partial: ['popup.pill.chatspace.partial', 'ring'],
    'copy-only': ['popup.pill.chatspace.copyOnly', 'ring'],
    closed: ['popup.pill.chatspace.closed', 'ring'],
    unknown: ['popup.pill.chatspace.unknown', 'ring'],
  } as const;
  const hub = {
    ok: ['popup.pill.hub.online', 'ok'],
    // The red dot stands next to a failure and its words (ui-design §12 п. 4).
    down: ['popup.pill.hub.offline', 'danger'],
    unknown: ['popup.pill.hub.unknown', 'ring'],
  } as const;
  const [hostKey, hostMark] = host[vm.pills.host];
  const [hubKey, hubMark] = hub[vm.pills.hub];
  return (
    <div class="pg-pills">
      <Pill label={i18n.t('popup.pill.chatspace', { state: i18n.t(hostKey) })} mark={hostMark} />
      <Pill label={i18n.t('popup.pill.hub', { state: i18n.t(hubKey) })} mark={hubMark} />
    </div>
  );
}

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

function Rows({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const services = usePageServices();
  const act = useAct();
  const persona = vm.persona;
  const quota = vm.quota;
  const signOut = vm.account?.signOut ?? null;
  return (
    <>
      <div class="pg-popup__sec">
        <div class="pg-popup__cap">{i18n.t('popup.persona')}</div>
        <div class="pg-popup__line">
          <b>{persona.s === 'set' ? persona.label : persona.s === 'no-persona' ? i18n.t('popup.personaNone') : i18n.t('popup.notConnected')}</b>
          {persona.s === 'not-connected' ? null : (
            <span class="pg-popup__aside">
              {i18n.t('popup.personaFor', { page: persona.pageName })}
              {persona.page === undefined ? null : (
                <>
                  {' · '}
                  <PageTag tag={persona.page} />
                </>
              )}
            </span>
          )}
        </div>
      </div>
      {vm.account === null || signOut === null ? null : (
        <div class="pg-popup__sec">
          <div class="pg-popup__cap">{i18n.t('popup.account')}</div>
          <div class="pg-popup__line">
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
          </div>
        </div>
      )}
      <div class="pg-popup__sec">
        <div class="pg-popup__cap">{i18n.t('popup.dialog')}</div>
        {vm.chat === null ? (
          <div class="pg-popup__line">
            <b class="pg-muted">{i18n.t('popup.dialogNone')}</b>
          </div>
        ) : (
          <div class="pg-popup__line">
            <b>
              {vm.chat.fanName}
              {vm.chat.fanUsername === null ? null : ` @${vm.chat.fanUsername.replace(/^@/, '')}`}
            </b>
            <span class="pg-popup__aside">
              <CopyValue text={vm.chat.hostAccountLabel} value={vm.chat.copyIds.hostAccountId} tooltip={i18n.t('popup.copyAccountId')} />
              {vm.chat.copyIds.creatorId === null ? null : (
                <>
                  {' · '}
                  <CopyValue text={vm.chat.copyIds.creatorId} value={vm.chat.copyIds.creatorId} tooltip={i18n.t('popup.copyCreatorId')} />
                </>
              )}
            </span>
          </div>
        )}
      </div>
      <div class="pg-popup__sec">
        <div class="pg-popup__cap">{i18n.t('popup.quota')}</div>
        <div class="pg-popup__line">
          {vm.pills.hub === 'down' ? (
            <>
              <b>—</b>
              <span class="pg-popup__aside">{i18n.t('popup.quotaHubDown')}</span>
            </>
          ) : quota === null || quota.remaining === null ? (
            <>
              <b>{i18n.t('popup.quotaUnknown')}</b>
              <span class="pg-popup__aside">{i18n.t('popup.quotaAfterFirst')}</span>
            </>
          ) : (
            <>
              <b>
                {/* PU-009 without amber: a ring before the number when the quota is low or gone. */}
                {quota.low ? <Dot kind="ring" /> : null}
                {i18n.t('popup.quotaLeft', { n: quota.remaining })}
              </b>
              {quota.resetsAt === null ? null : <span class="pg-popup__aside">{i18n.t('popup.quotaReset', { time: { time: quota.resetsAt } })}</span>}
            </>
          )}
        </div>
        {vm.aiTodayLine === null ? null : <div class="pg-sub">{vm.aiTodayLine}</div>}
      </div>
    </>
  );
}

function Buttons({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  return (
    <div class="pg-popup__btns">
      {vm.buttons.map((button, index) => {
        const keys = hotkeyText(button.hotkey);
        const newcomers = button.action.type === 'Navigate' && button.action.to.kind === 'surface' && button.action.to.surface === 'newcomers';
        const reason = button.enabled ? null : button.reason === null ? i18n.t('common.unknown') : i18n.text(button.reason.text);
        const count = newcomers ? vm.newcomersCount : null;
        return (
          <Button
            key={index}
            label={i18n.text(button.label)}
            variant="line"
            reason={reason}
            tooltip={count === null ? null : i18n.t('popup.newcomersTooltip', { hours: 48, n: count })}
            onClick={() => void act(button.action)}
            trailing={
              <>
                {/* The count of «Новые» is not a shortcut: it stands right after the word (§4.23). */}
                {count === null ? null : <span class="pg-popup__count">{count}</span>}
                <span class="pg-popup__key">{keys === null || reason !== null ? null : <Kbd>{keys.display}</Kbd>}</span>
              </>
            }
          />
        );
      })}
    </div>
  );
}

function Footer({ vm }: { readonly vm: PopupVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  return (
    <div class="pg-popup__foot">
      <button type="button" class="pg-link" onClick={() => void act(vm.links.whatsNew)}>
        {i18n.t('popup.whatsNew')}
      </button>
      <button type="button" class="pg-link" onClick={() => void act(vm.links.changelog)}>
        {i18n.t('popup.history')}
      </button>
      <Button label={vm.refreshing ? i18n.t('popup.refreshing') : i18n.text(vm.refresh.label)} variant="quiet" size="sm" icon="refresh" busy={vm.refreshing} onClick={() => void act(vm.refresh.action)} />
    </div>
  );
}

export function Popup(): JSX.Element {
  const vm = useView({ of: 'popup' }).value;
  const i18n = useI18n();
  const dispatch = useDispatch();
  const view = vm.view;
  const settings = vm.buttons.find((button) => button.action.type === 'OpenSettings') ?? null;
  const plainSignIn = view.s === 'forbidden' && view.error.code === 'CG-AUTH-REQUIRED';
  return (
    <div class="pg-popup" role="main" aria-label="ChatGoose">
      <div class="pg-popup__head">
        <GooseMark size={22} />
        <span class="pg-popup__brand">ChatGoose</span>
        <span class="pg-popup__ver">{vm.version}</span>
      </div>
      {view.s === 'loading' ? (
        <div class="cg-state cg-state--loading" role="status" aria-busy="true">
          {i18n.t('common.loading')}
        </div>
      ) : view.s === 'error' ? (
        // PU-001: the background did not answer — say so, offer the retry and the settings.
        <div class="pg-popup__state">
          <ErrorCard tone="failure" error={view.error} inline>
            {view.retry === null ? null : <Button label={i18n.t('common.retry')} variant="line" onClick={() => void dispatch(view.retry ?? { type: 'ReloadView', selector: { of: 'popup' } })} />}
            {settings === null ? null : <ActionButton vm={settings} />}
          </ErrorCard>
        </div>
      ) : view.s === 'forbidden' ? (
        // PU-002: not signed in — the one thing to do is to sign in on the settings page.
        <div class="pg-popup__state">
          {/* «Нужно войти»: the registry's sentence sends the person to the extension's icon — which is this very
              popup. Here the card says the popup's own: where to sign in. Any other reason (revoked, expired)
              keeps its own words, and the lead follows it. */}
          <ErrorCard tone="state" error={plainSignIn ? { ...view.error, body: i18n.t('popup.signInLead') } : view.error} copyCode={false} alert={false} inline>
            {view.remedy === null ? null : <Button label={i18n.t('common.signIn')} variant="line" onClick={() => void dispatch(view.remedy ?? { type: 'OpenSettings', route: { section: 'account' } })} />}
          </ErrorCard>
          {plainSignIn ? null : <p class="pg-popup__lead pg-sub">{i18n.t('popup.signInLead')}</p>}
        </div>
      ) : (
        <>
          <Pills vm={vm} />
          {vm.problems.length === 0 ? null : (
            <div class="pg-popup__sec" role="status" aria-label={i18n.t('popup.problems')}>
              {vm.problems.map((problem) => (
                <div key={problem.code} class="pg-popup__err" data-cg-code={problem.code}>
                  <CodeLine code={problem.code} class="pg-code" />
                  {problem.body}
                </div>
              ))}
            </div>
          )}
          <Rows vm={vm} />
          <Buttons vm={vm} />
        </>
      )}
      <Footer vm={vm} />
      <PageLayers />
    </div>
  );
}
