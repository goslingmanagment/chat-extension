// TEMPORARY (integration step M1; R16 builds the real popup and settings):
// a minimal options page — sign in, sign out, the hub address under
// «Дополнительно» (ST-042: it changes only while signed out) and status lines
// (hub, bootstrap pages, bindings, host contract) — and a status-only popup.
// Enough to sign in and see that the chain works; nothing here is the final
// design, and nothing here reads a view model: the pages' controllers and
// view models are R16's. The composition root hands in a small port over the
// page RPC instead.

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { type ValueSignal } from '@cg/contracts/vm';

import { Button } from '../kit/components/Button';
import { ErrorCard } from '../kit/components/ErrorCard';
import { TextField } from '../kit/components/Field';
import { GooseMark } from '../kit/components/Icon';
import { Dot } from '../kit/components/Indicators';
import { useI18n } from '../kit/context';
import { useValueSignal } from '../kit/signals';
import { type StyleSource } from '../kit/styles';

export interface TempPageStatus {
  readonly version: string;
  readonly testBuild: boolean;
  /** false — the background did not answer (CG-RUNTIME-UNREACHABLE in `error`). */
  readonly reachable: boolean;
  readonly error: CgErrorView | null;
  readonly session: { readonly login: string; readonly role: string } | null;
  readonly hubUrl: string;
  /** The hub's health check: null — not asked yet. */
  readonly hub: { readonly ok: boolean; readonly error: CgErrorView | null } | null;
  /** The bootstrap of this sign-in: null — signed out. */
  readonly bootstrap: { readonly ok: boolean; readonly pages: readonly string[]; readonly configRevision: number | null; readonly error: CgErrorView | null } | null;
  /** ChatSpace accounts this browser saw and the hub page each is bound to (or its CG-BINDING-* code). */
  readonly bindings: readonly { readonly account: string; readonly page: string | null; readonly code: CgCode | null; readonly openTabs: number }[];
  /** The host contract as each open ChatSpace tab reported it. */
  readonly contracts: readonly { readonly build: string | null; readonly state: 'unknown' | 'ok' | 'degraded' | 'broken' }[];
}

export interface TempPagePort {
  /** null — still loading. */
  readonly status: ValueSignal<TempPageStatus | null>;
  refresh(): void;
  /** null — done; an error card otherwise. The password is not kept anywhere. */
  signIn(login: string, password: string): Promise<CgErrorView | null>;
  signOut(): Promise<CgErrorView | null>;
  /** Saves another hub address (asks the browser for access to it first). */
  saveHubUrl(url: string): Promise<CgErrorView | null>;
  openOptions(): void;
}

function Row({ label, value, state, name }: { readonly label: string; readonly value: string; readonly state: 'ok' | 'bad' | 'none'; readonly name: string }): JSX.Element {
  return (
    <div class="cg-temp__row" data-cg-temp-row={name} data-cg-temp-state={state}>
      <span class="cg-temp__dot">{state === 'none' ? null : <Dot kind={state === 'ok' ? 'ring' : 'danger'} />}</span>
      <span class="cg-temp__label">{label}</span>
      <span class="cg-temp__value">{value}</span>
    </div>
  );
}

function StatusRows({ status }: { readonly status: TempPageStatus }): JSX.Element {
  const i18n = useI18n();
  const hubValue = status.hub === null ? i18n.t('common.loading') : status.hub.ok ? i18n.t('popup.pill.hub.online') : (status.hub.error?.code ?? i18n.t('popup.pill.hub.offline'));
  const bootstrap = status.bootstrap;
  const pagesValue = bootstrap === null ? i18n.t('popup.notConnected') : bootstrap.ok ? bootstrap.pages.join(', ') || i18n.t('common.empty') : (bootstrap.error?.code ?? i18n.t('common.unknown'));
  const contractWord = (state: TempPageStatus['contracts'][number]['state']): string =>
    state === 'ok'
      ? i18n.t('popup.pill.chatspace.connected')
      : state === 'degraded'
        ? i18n.t('popup.pill.chatspace.copyOnly')
        : state === 'broken'
          ? i18n.t('popup.pill.chatspace.partial')
          : i18n.t('common.loading');
  return (
    <div class="cg-temp__rows">
      <Row name="extension" label={i18n.t('settings.status.row.extension')} value={i18n.t('settings.status.row.extensionValue', { v: status.version })} state="none" />
      <Row name="hub" label={i18n.t('settings.status.row.hub')} value={`${status.hubUrl} · ${hubValue}`} state={status.hub === null ? 'none' : status.hub.ok ? 'ok' : 'bad'} />
      <Row
        name="account"
        label={i18n.t('settings.status.row.account')}
        value={status.session === null ? i18n.t('dock.persona.notSignedIn') : `${status.session.login} · ${status.session.role}`}
        state={status.session === null ? 'bad' : 'ok'}
      />
      <Row name="bootstrap" label={i18n.t('settings.account.pages')} value={pagesValue} state={bootstrap === null ? 'none' : bootstrap.ok ? 'ok' : 'bad'} />
      {status.bindings.length === 0 ? (
        <Row name="binding" label={i18n.t('settings.status.row.binding')} value={i18n.t('popup.pill.chatspace.closed')} state="none" />
      ) : (
        status.bindings.map((binding) => (
          <Row
            key={binding.account}
            name="binding"
            label={i18n.t('settings.status.row.binding')}
            value={i18n.t('settings.status.row.bindingValue', { id: binding.account, page: binding.page ?? binding.code ?? i18n.t('common.unknown') })}
            state={binding.page !== null ? 'ok' : binding.code !== null ? 'bad' : 'none'}
          />
        ))
      )}
      {status.contracts.length === 0 ? (
        <Row name="contract" label={i18n.t('settings.status.row.contract')} value={i18n.t('popup.pill.chatspace.closed')} state="none" />
      ) : (
        status.contracts.map((contract, index) => (
          <Row
            key={index}
            name="contract"
            label={i18n.t('settings.status.row.contract')}
            value={contract.build === null ? contractWord(contract.state) : `${contractWord(contract.state)} · ${contract.build}`}
            state={contract.state === 'ok' ? 'ok' : contract.state === 'unknown' ? 'none' : 'bad'}
          />
        ))
      )}
    </div>
  );
}

function SignInForm({ port }: { readonly port: TempPagePort }): JSX.Element {
  const i18n = useI18n();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CgErrorView | null>(null);
  const submit = (): void => {
    if (pending || login === '' || password === '') return;
    setPending(true);
    setError(null);
    void port.signIn(login, password).then((failure) => {
      setPending(false);
      setPassword('');
      setError(failure);
    });
  };
  return (
    <form
      class="cg-temp__form"
      data-cg-temp="sign-in"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 class="cg-temp__h">{i18n.t('signIn.title')}</h2>
      <TextField label={i18n.t('signIn.login')} placeholder={i18n.t('signIn.login')} value={login} onValue={setLogin} onEnter={submit} class="cg-temp__input" />
      <input
        class="cg-field cg-temp__input"
        type="password"
        autocomplete="current-password"
        aria-label={i18n.t('signIn.password')}
        placeholder={i18n.t('signIn.password')}
        value={password}
        onInput={(event) => setPassword(event.currentTarget.value)}
      />
      <Button label={pending ? i18n.t('signIn.pending') : i18n.t('signIn.submit')} variant="line" busy={pending} onClick={submit} />
      {error === null ? null : <ErrorCard error={error} tone="failure" />}
    </form>
  );
}

function HubAddress({ port, status }: { readonly port: TempPagePort; readonly status: TempPageStatus }): JSX.Element {
  const i18n = useI18n();
  const [url, setUrl] = useState(status.hubUrl);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<CgErrorView | null>(null);
  const signedIn = status.session !== null;
  const save = (): void => {
    setSaved(false);
    void port.saveHubUrl(url.trim()).then((failure) => {
      setError(failure);
      setSaved(failure === null);
    });
  };
  return (
    <details class="cg-temp__advanced" data-cg-temp="advanced">
      <summary>{i18n.t('settings.account.advanced')}</summary>
      <div class="cg-temp__form">
        <TextField
          label={i18n.t('settings.account.hubAddress')}
          placeholder={i18n.t('settings.account.hubAddress')}
          value={url}
          onValue={(next) => {
            setUrl(next);
            setSaved(false);
          }}
          // ST-042: the address of the hub changes only while signed out.
          reason={signedIn ? 'Перед сменой адреса выйдите' : null}
          onEnter={save}
          class="cg-temp__input"
        />
        <Button label={saved ? i18n.t('common.saved') : i18n.t('common.save')} variant="line" reason={signedIn ? 'Перед сменой адреса выйдите' : null} onClick={save} />
        {error === null ? null : <ErrorCard error={error} tone="failure" />}
      </div>
    </details>
  );
}

export function TempOptions({ port }: { readonly port: TempPagePort }): JSX.Element {
  const i18n = useI18n();
  const status = useValueSignal(port.status).value;
  const [error, setError] = useState<CgErrorView | null>(null);
  return (
    <main class="cg-temp" data-cg-temp="options" data-cg-temp-ready={status === null ? 'no' : 'yes'} data-cg-temp-signed-in={status === null || status.session === null ? 'no' : 'yes'}>
      <header class="cg-temp__head">
        <GooseMark size={24} />
        <h1 class="cg-temp__title">{i18n.t('settings.label')}</h1>
      </header>
      {status === null ? (
        <p>{i18n.t('common.loading')}</p>
      ) : (
        <>
          {status.error === null ? null : <ErrorCard error={status.error} tone="failure" />}
          <section class="cg-temp__section">
            <h2 class="cg-temp__h">{i18n.t('settings.section.account')}</h2>
            {status.session === null ? (
              <SignInForm port={port} />
            ) : (
              <div class="cg-temp__form" data-cg-temp="signed-in" data-cg-temp-login={status.session.login}>
                <span>{`${status.session.login} · ${status.session.role}`}</span>
                <Button label={i18n.t('common.signOut')} variant="line" onClick={() => void port.signOut().then(setError)} />
                {error === null ? null : <ErrorCard error={error} tone="failure" />}
              </div>
            )}
            <HubAddress key={status.hubUrl} port={port} status={status} />
          </section>
          <section class="cg-temp__section">
            <h2 class="cg-temp__h">{i18n.t('settings.section.status')}</h2>
            <StatusRows status={status} />
            <Button label={i18n.t('settings.status.checkAll')} variant="quiet" onClick={() => port.refresh()} />
          </section>
        </>
      )}
    </main>
  );
}

export function TempPopup({ port }: { readonly port: TempPagePort }): JSX.Element {
  const i18n = useI18n();
  const status = useValueSignal(port.status).value;
  return (
    <main class="cg-temp cg-temp--popup" data-cg-temp="popup" data-cg-temp-ready={status === null ? 'no' : 'yes'} data-cg-temp-signed-in={status === null || status.session === null ? 'no' : 'yes'}>
      <header class="cg-temp__head">
        <GooseMark size={22} />
        <h1 class="cg-temp__title">{i18n.t('dock.label')}</h1>
      </header>
      {status === null ? (
        <p>{i18n.t('common.loading')}</p>
      ) : (
        <>
          {status.error === null ? null : <ErrorCard error={status.error} tone="failure" copyCode={false} />}
          <StatusRows status={status} />
          <div class="cg-temp__acts">
            <Button label={i18n.t('popup.btn.settings')} variant="line" onClick={() => port.openOptions()} />
            <Button label={i18n.t('popup.refreshStatus')} variant="quiet" onClick={() => port.refresh()} />
          </div>
        </>
      )}
    </main>
  );
}

export const TEMP_PAGES_STYLES: StyleSource = {
  id: 'cg-temp-pages',
  css: `
.cg-temp { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; display: flex; flex-direction: column; gap: 20px; color: var(--cg-ink); }
.cg-temp--popup { width: 340px; padding: 14px 14px 16px; gap: 12px; }
.cg-temp__head { display: flex; align-items: center; gap: 10px; }
.cg-temp__title { font-size: var(--cg-text-lg); line-height: 24px; font-weight: 600; }
.cg-temp__section { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.cg-temp__h { font-size: var(--cg-text-md); line-height: 20px; font-weight: 600; }
.cg-temp__form { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; width: 100%; max-width: 360px; }
.cg-temp__input { width: 100%; min-height: 30px; padding: 4px 8px; border: 1px solid var(--cg-input-border); border-radius: var(--cg-r-sm); background: var(--cg-input-bg); }
.cg-temp__advanced { width: 100%; color: var(--cg-ink-2); }
.cg-temp__advanced > summary { cursor: pointer; padding: 4px 0; }
.cg-temp__rows { display: flex; flex-direction: column; width: 100%; border-top: 1px solid var(--cg-divider); }
.cg-temp__row { display: grid; grid-template-columns: 16px minmax(120px, 34%) minmax(0, 1fr); gap: 8px; align-items: center; min-height: 30px; padding: 4px 0; border-bottom: 1px solid var(--cg-divider); font-size: var(--cg-text-sm2); }
.cg-temp__dot { display: inline-flex; justify-content: center; }
.cg-temp__label { color: var(--cg-ink-muted); }
.cg-temp__value { color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-temp__acts { display: flex; gap: 6px; }
`,
};
