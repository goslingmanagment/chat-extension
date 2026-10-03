// «Аккаунт ChatGoose» (architecture.md §8.2, §9.9; ST-040…ST-058) and the
// sign-in screen that replaces the settings while nobody is signed in
// (ST-011). Four zones: the account, the connection, the pages the hub
// granted, diagnostics. The hub address is shown always and changed only on
// the sign-in screen, while signed out (ST-042).

import { type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { type CgErrorView, type I18nKey } from '@cg/contracts/errors';
import { type AccountBodyVM, type AppearanceBodyVM, type SignInVM } from '@cg/contracts/vm';

import { Button, Checkbox, CodeLine, Dot, GooseMark, useI18n } from '../../kit';
import { Opt, useAct, usePageServices } from '../shared';
import { Field } from './controls';
import { SignInForm } from './SignIn';

const ROLE_KEYS: Readonly<Record<string, I18nKey>> = {
  owner: 'settings.role.owner',
  team_lead: 'settings.role.teamLead',
  chatter: 'settings.role.chatter',
  unknown: 'settings.role.unknown',
};

/** Only an https address becomes a link (§14). */
function httpsUrl(origin: string, path: string): string | null {
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origin) ? `${origin}${path}` : null;
}

function HubAccess({ hub }: { readonly hub: AccountBodyVM['hub'] }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const request = hub.requestPermission;
  return (
    <Opt label={i18n.t('settings.account.hostAccess')} anchor="hub-access">
      <span class="pg-line">
        {hub.hostPermission === 'granted' ? null : <Dot kind="danger" />}
        <span class="pg-value">{i18n.t(hub.hostPermission === 'granted' ? 'settings.account.access.granted' : 'settings.account.access.missing')}</span>
        {request === null ? null : <Button label={i18n.text(request.label)} variant="line" onClick={() => void act(request.action)} />}
      </span>
    </Opt>
  );
}

function Connection({ body }: { readonly body: AccountBodyVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const { connection } = body;
  const state = { ok: 'settings.account.connection.ok', down: 'settings.account.connection.down', unknown: 'settings.account.connection.unknown' } as const;
  const meta =
    connection.checkedAt === null
      ? null
      : connection.latencyMs === null
        ? i18n.t('settings.account.connectionChecked', { time: { time: connection.checkedAt } })
        : i18n.t('settings.account.connectionMeta', { time: { time: connection.checkedAt }, ms: connection.latencyMs });
  return (
    <Opt label={i18n.t('settings.account.connection')} anchor="hub">
      <span class="pg-line">
        {connection.s === 'down' ? <Dot kind="danger" /> : null}
        <span class="pg-value">{i18n.t(state[connection.s])}</span>
        <Button label={i18n.t('settings.account.checkConnection')} variant="line" icon="refresh" onClick={() => void act({ type: 'RecheckStatus' })} />
      </span>
      {meta === null ? null : <div class="pg-sub">{meta}</div>}
    </Opt>
  );
}

export function AccountSection({ body, signIn, anchor }: { readonly body: AccountBodyVM; readonly signIn: SignInVM | null; readonly anchor: string | null }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const services = usePageServices();
  // «Войти заново» (ST-048) opens the form in place; a deep link to the sign-in opens it too.
  const [again, setAgain] = useState(anchor === 'sign-in');
  useEffect(() => {
    if (anchor === 'sign-in') setAgain(true);
  }, [anchor]);
  const user = body.user;
  const account = httpsUrl(body.hub.origin, '/account');
  const signOut = body.signOut;
  return (
    <>
      {user === null ? null : (
        <>
          <h2 class="pg-h2">{i18n.t('settings.account.zone.account')}</h2>
          <Opt label={i18n.t('settings.account.signedInAs')}>
            <span class="pg-line">
              <span class="pg-value">
                {user.login} · {i18n.t(ROLE_KEYS[user.role] ?? 'settings.role.unknown')}
              </span>
              {signOut === null ? null : (
                <Button
                  label={i18n.text(signOut.label)}
                  variant="line"
                  onClick={() => {
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
              )}
            </span>
          </Opt>
          <Opt label={i18n.t('settings.account.thisDevice')} anchor="sign-in">
            <span class="pg-line">
              <span class="pg-value">{user.deviceSince === null ? i18n.t('settings.account.deviceSignedIn') : i18n.t('settings.account.deviceSince', { date: { time: user.deviceSince, style: 'date' } })}</span>
              {body.signInAgain === null ? null : <Button label={i18n.text(body.signInAgain.label)} variant="plain" expanded={again} onClick={() => setAgain((before) => !before)} />}
            </span>
            {again && signIn !== null ? (
              <>
                <div class="pg-sub">{i18n.t('signIn.againLead')}</div>
                <SignInForm vm={signIn} onDone={() => setAgain(false)} />
              </>
            ) : null}
          </Opt>
          {account === null ? null : (
            <Opt label={i18n.t('settings.account.hubAccount')} hint={i18n.t('settings.account.hubAccountHint')}>
              <a class="pg-link" href={account} target="_blank" rel="noopener noreferrer">
                {account.replace(/^https:\/\//, '')}
              </a>
            </Opt>
          )}
        </>
      )}

      <h2 class="pg-h2">{i18n.t('settings.account.zone.connection')}</h2>
      <Opt label={i18n.t('settings.account.hubAddress')} hint={i18n.t('settings.account.hubAddressHint')} anchor="hub-address">
        <span class="pg-value">{body.hub.origin}</span>
        {user === null ? null : <div class="pg-sub">{i18n.t('settings.account.hubAddressLocked')}</div>}
      </Opt>
      <HubAccess hub={body.hub} />
      <Connection body={body} />

      <h2 class="pg-h2">{i18n.t('settings.account.pages')}</h2>
      {body.pages.length === 0 ? (
        <p class="pg-note">{i18n.t('settings.account.noPages')}</p>
      ) : (
        <ul class="pg-list pg-zone" data-pg-anchor="pages">
          {body.pages.map((page, index) => (
            <li key={index}>
              <b>{page.pageName}</b>
              <span>
                {page.platform} · {page.persona ?? i18n.t('settings.account.noPersona')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 class="pg-h2">{i18n.t('settings.account.zone.diagnostics')}</h2>
      <Opt label={i18n.t('settings.account.compatibility')}>
        <span class="pg-line">
          {body.sdk.compatible === false ? <Dot kind="danger" /> : null}
          <span class="pg-value">{i18n.t(body.sdk.compatible === null ? 'settings.account.sdk.unknown' : body.sdk.compatible ? 'settings.account.sdk.compatible' : 'settings.account.sdk.incompatible')}</span>
        </span>
        {body.sdk.contractHash === null ? null : <div class="pg-sub pg-mono">{i18n.t('settings.account.sdkHash', { hash: body.sdk.contractHash.slice(0, 12) })}</div>}
      </Opt>
      <Opt label={i18n.t('settings.account.hubErrorsToday')}>
        {body.hubErrorsToday.length === 0 ? (
          <span class="pg-muted">{i18n.t('settings.account.hubErrorsNone')}</span>
        ) : (
          <span class="pg-line">
            {body.hubErrorsToday.map((entry) => (
              <span key={entry.code} class="pg-chip">
                {entry.code} ×{entry.count}
              </span>
            ))}
          </span>
        )}
      </Opt>
      <Opt label={i18n.t('settings.account.lastDossierSave')}>
        <span class={body.lastDossierSave === null ? 'pg-muted' : 'pg-value'}>{body.lastDossierSave === null ? i18n.t('common.unknown') : i18n.formatTime(body.lastDossierSave, 'datetime')}</span>
      </Opt>
    </>
  );
}

export interface SignInScreenProps {
  readonly signIn: SignInVM;
  /** Why nobody is signed in (AU-015): shown when it is more than «нужно войти». */
  readonly reason: CgErrorView;
  readonly account: AccountBodyVM | null;
  readonly appearance: AppearanceBodyVM | null;
  readonly version: string;
  readonly readOnly: boolean;
  /** The page of the site that helps with the sign-in (ST-050); https only. */
  readonly helpUrl: string | null;
}

/** Replaces every section while nobody is signed in: the form, «Дополнительно», the sound, the version. */
export function SignInScreen(props: SignInScreenProps): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const { reason, account, appearance } = props;
  const [address, setAddress] = useState(props.signIn.hubOrigin);
  useEffect(() => setAddress(props.signIn.hubOrigin), [props.signIn.hubOrigin]);
  const unconfirmed = reason.code === 'CG-AUTH-REQUIRED' && reason.detail !== undefined;
  const ended = reason.code !== 'CG-AUTH-REQUIRED';
  const locked = props.readOnly ? i18n.t('cg.storageVersion.title') : null;
  const saveAddress = (value: string): void => {
    if (value.trim() !== '' && value.trim() !== props.signIn.hubOrigin) void act({ type: 'SetPreference', key: 'hub.baseUrl', value: value.trim() }, { quiet: true });
  };
  return (
    <div class="pg-signin">
      <div class="pg-brand" style={{ padding: '0 0 14px' }}>
        <GooseMark size={24} />
        <b>{i18n.t('dock.label')}</b>
        <span>{props.version}</span>
      </div>
      <h1 class="pg-h1">{i18n.t('signIn.title')}</h1>
      <p class="pg-lead">{i18n.t('signIn.lead')}</p>
      {ended || unconfirmed ? (
        <div class="pg-plate" role="status" data-cg-code={reason.code}>
          <Dot kind="ring" />
          <div>
            {ended ? <CodeLine code={reason.code} class="pg-code" /> : null}
            <div class="pg-plate__t">{ended ? reason.title : i18n.t('signIn.signOutUnconfirmed')}</div>
            {ended ? <div class="pg-plate__b">{reason.body}</div> : null}
          </div>
        </div>
      ) : null}
      <SignInForm vm={props.signIn} />
      <p class="pg-note">{i18n.t('signIn.accessNote')}</p>
      {props.helpUrl === null ? null : (
        <p class="pg-note">
          <a class="pg-link" href={props.helpUrl} target="_blank" rel="noopener noreferrer">
            {i18n.t('signIn.help')}
          </a>
        </p>
      )}

      <details class="pg-details" data-pg-anchor="hub-address">
        <summary>{i18n.t('settings.account.advanced')}</summary>
        <div class="pg-details__body">
          <label class="pg-form" style={{ margin: 0 }}>
            <span class="pg-sub">{i18n.t('settings.account.hubAddress')}</span>
            <span class="pg-line">
              <Field label={i18n.t('settings.account.hubAddress')} value={address} wide maxLength={256} reason={locked} onInput={setAddress} onCommit={saveAddress} />
              <Button label={i18n.t('settings.account.hubAddressSave')} variant="line" reason={locked} onClick={() => saveAddress(address)} />
            </span>
          </label>
          <div class="pg-sub">{i18n.t('settings.account.hubAddressHint')}</div>
          {account === null ? null : (
            <div class="pg-line" style={{ marginTop: '10px' }}>
              <span class="pg-muted">{i18n.t('settings.account.hostAccess')}:</span>
              <span class="pg-value">{i18n.t(account.hub.hostPermission === 'granted' ? 'settings.account.access.granted' : 'settings.account.access.missing')}</span>
              {account.hub.requestPermission === null ? null : <Button label={i18n.text(account.hub.requestPermission.label)} variant="line" onClick={() => void act(account.hub.requestPermission?.action ?? { type: 'RequestPermission', kind: 'hub-host' })} />}
            </div>
          )}
        </div>
      </details>

      {appearance === null ? null : (
        <details class="pg-details">
          <summary>{i18n.t('signIn.sound')}</summary>
          <div class="pg-details__body pg-line">
            <Checkbox
              label={i18n.t('settings.appearance.soundMessage')}
              checked={appearance.sound.messages.on}
              size={14}
              reason={locked}
              onChange={(on) => void act({ type: 'SetPreference', key: 'sound.messages.on', value: on }, { quiet: true })}
            />
            <Checkbox
              label={i18n.t('settings.appearance.soundSubscriber')}
              checked={appearance.sound.subscribers.on}
              size={14}
              reason={locked}
              onChange={(on) => void act({ type: 'SetPreference', key: 'sound.subscribers.on', value: on }, { quiet: true })}
            />
          </div>
        </details>
      )}
    </div>
  );
}
