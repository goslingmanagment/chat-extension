// The settings page (ui-design §4.24; architecture.md §9.4, §9.5, §9.9;
// ST-001…ST-018): a 248 px column of sections and the section itself. The
// hash decides the section (`#account`, `#account:CG-HUB-URL`); a code in
// it shows the plate «КОД · описание» and highlights what it is about for
// two seconds. «Сохранено ✓» appears only when the background confirmed the
// write. While nobody is signed in the sign-in screen stands here instead.

import { type ComponentChildren, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type CgCode, type I18nKey, type SettingsRoute, type SettingsSection } from '@cg/contracts/errors';
import { type OptionsVM, type SaveStateVM, type ValueSignal } from '@cg/contracts/vm';

import { ActionButton, Button, CodeLine, Dot, ErrorCard, Icon, Spinner, useI18n, useReducedMotion, useValueSignal, useView } from '../../kit';
import { ChatGooseLogo } from '../brand/art';
import { PageLayers, useAct } from '../shared';
import { AccountSection, SignInScreen } from './Account';
import { AccountsSection } from './Accounts';
import { AppearanceSection } from './Appearance';
import { Picker } from './controls';
import { DiagnosticsSection } from './Diagnostics';
import { GenerationSection } from './Generation';
import { HotkeysSection } from './Hotkeys';
import { PersonasSection } from './Personas';
import { StatusSection, statusLead } from './Status';

/** Where the page is: the section, the code of a deep link, and a counter that grows on every hash change. */
export type OptionsRoute = SettingsRoute & { readonly seq: number };

const LEADS: Readonly<Record<Exclude<SettingsSection, 'status'>, I18nKey>> = {
  account: 'settings.account.lead',
  personas: 'settings.personas.lead',
  accounts: 'settings.accounts.lead',
  generation: 'settings.generation.lead',
  hotkeys: 'settings.hotkeys.lead',
  appearance: 'settings.appearance.lead',
  diagnostics: 'settings.diagnostics.lead',
};

/** What a code points at inside its section (ST-010): `data-pg-anchor` of the row, the zone or the field. */
const ANCHORS: Partial<Record<CgCode, string>> = {
  'CG-HUB-URL': 'hub-address',
  'CG-HUB-HOST-PERMISSION': 'hub-access',
  'CG-AUTH-REQUIRED': 'sign-in',
  'CG-AUTH-REVOKED': 'sign-in',
  'CG-AUTH-EXPIRED': 'sign-in',
  'CG-AUTH-REJECTED': 'sign-in',
  'CG-LOGIN-CREDENTIALS': 'sign-in',
  'CG-LOGIN-RATE-LIMIT': 'sign-in',
  'CG-LOGIN-UNAVAILABLE': 'sign-in',
  'CG-LOGIN-TIMEOUT': 'sign-in',
  'CG-LOGIN-PENDING': 'sign-in',
  'CG-LOGIN-INCOMPLETE': 'sign-in',
  'CG-HUB-FORBIDDEN': 'pages',
  'CG-HUB-UNAVAILABLE': 'hub',
  'CG-HUB-TIMEOUT': 'hub',
  'CG-HUB-OUTDATED': 'hub',
  'CG-HUB-CAPABILITY': 'hub',
  // The site's row (R20 F7): `data-pg-anchor` of every site's row is `host`.
  'CG-HOST-CONTRACT': 'host',
  'CG-SEND-OFF': 'preview-send',
  'CG-SEND-HOST': 'preview-send',
  'CG-SEND-RECEIPT': 'preview-send',
  'CG-QUOTA-DAILY': 'quota',
  'CG-FEATURE-DISABLED': 'spenders',
  'CG-PERSONA-NONE': 'pages',
  'CG-PERSONA-UNASSIGNED': 'pages',
  'CG-PERSONA-UNAVAILABLE': 'pages',
  'CG-AUDIO-BLOCKED': 'sound',
  'CG-STORAGE-READ': 'storage',
  'CG-STORAGE-WRITE': 'storage',
  'CG-STORAGE-VERSION': 'storage',
  'CG-STORAGE-FULL': 'storage',
};

/** «Сохраняю…», «Сохранено ✓» (for a few seconds after each confirmed revision), «Не сохранено · Повторить». */
function SaveState({ save }: { readonly save: SaveStateVM }): JSX.Element | null {
  const i18n = useI18n();
  const act = useAct();
  const revision = save.s === 'saved' ? save.revision : null;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (revision === null) return undefined;
    setShown(revision);
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
  }, [revision]);
  if (save.s === 'saving') {
    return (
      <span class="pg-save" role="status" data-pg-save="saving">
        <Spinner />
        {i18n.t('common.saving')}
      </span>
    );
  }
  if (save.s === 'failed') {
    return (
      <span class="pg-save pg-save--failed" role="alert" data-pg-save="failed" data-cg-code={save.error.code}>
        <Dot kind="danger" />
        <span>
          {i18n.t('settings.save.failed')} · <CodeLine code={save.error.code} class="pg-code" />
        </span>
        <Button label={i18n.t('common.retry')} variant="line" size="sm" onClick={() => void act(save.retry, { quiet: true })} />
      </span>
    );
  }
  if (save.s === 'saved' && shown === save.revision) {
    return (
      <span class="pg-save" role="status" data-pg-save="saved" data-pg-revision={save.revision}>
        {i18n.t('settings.save.saved')}
      </span>
    );
  }
  return null;
}

function Checklist({ checklist }: { readonly checklist: NonNullable<OptionsVM['checklist']> }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const done = checklist.steps.filter((step) => step.done).length;
  return (
    <section class="pg-check" aria-label={i18n.t('settings.onboarding.title')}>
      <div class="pg-check__head">
        <b>{i18n.t('settings.onboarding.title')}</b>
        <span>{i18n.t('settings.onboarding.progress', { done, total: checklist.steps.length })}</span>
        <Button label={i18n.t('settings.onboarding.hide')} variant="quiet" onClick={() => void act(checklist.dismiss, { quiet: true })} />
      </div>
      <p class="pg-check__lead">{i18n.t('settings.onboarding.lead')}</p>
      <ol class="pg-check__list">
        {checklist.steps.map((step) => (
          <li key={step.id} class={`pg-check__item${step.done ? ' is-done' : ''}`} data-pg-step={step.id}>
            {step.done ? <Icon name="check" size={14} /> : <Dot kind="ring" />}
            <span class="pg-check__t">
              {i18n.text(step.label)}
              <span class="cg-sr"> — {i18n.t(step.done ? 'settings.onboarding.stepDone' : 'settings.onboarding.stepTodo')}</span>
            </span>
            {step.action === null ? <span /> : <ActionButton vm={step.action} variant="quiet" />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Nav({ vm, onGo }: { readonly vm: OptionsVM; readonly onGo: (section: SettingsSection) => void }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const footer = vm.footer;
  return (
    <nav class="pg-nav" aria-label={i18n.t('settings.nav.label')}>
      <div class="pg-brand">
        <ChatGooseLogo class="pg-logo" />
      </div>
      {vm.nav.map((item) => (
        <a
          key={item.section}
          class="pg-nav__a"
          href={`#${item.section}`}
          {...(item.section === vm.section ? { 'aria-current': 'page' as const } : {})}
          onClick={(event) => {
            event.preventDefault();
            onGo(item.section);
          }}
        >
          {i18n.text(item.label)}
          {item.problem ? (
            <>
              <Dot kind="ring" />
              <span class="cg-sr">{i18n.t('settings.nav.problem')}</span>
            </>
          ) : null}
        </a>
      ))}
      {footer === undefined ? null : (
        <div class="pg-nav__foot">
          <span>{i18n.t('popup.version', { v: vm.version })}</span>
          {footer.whatsNew === null ? null : (
            <button type="button" class="pg-link" onClick={() => void act(footer.whatsNew ?? { type: 'Navigate', to: { kind: 'page', page: 'whats-new' } })}>
              {i18n.t('popup.whatsNew')}
              {footer.unseenNotes ? <span class="pg-tag">{i18n.t('settings.nav.new')}</span> : null}
            </button>
          )}
          {footer.changelog === null ? null : (
            <button type="button" class="pg-link" onClick={() => void act(footer.changelog ?? { type: 'Navigate', to: { kind: 'page', page: 'changelog' } })}>
              {i18n.t('popup.history')}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function Section({ vm, anchor, checklist }: { readonly vm: OptionsVM; readonly anchor: string | null; readonly checklist: ComponentChildren }): JSX.Element | null {
  // `section` and `body` come as a pair (OptionsVM is correlated by section).
  if (vm.body === null) return null;
  switch (vm.section) {
    case 'status':
      // The verdict first, the first-run steps under it (X32).
      return <StatusSection body={vm.body} checklist={checklist} />;
    case 'account':
      return <AccountSection body={vm.body} signIn={vm.signIn} anchor={anchor} />;
    case 'personas':
      return <PersonasSection body={vm.body} view={vm.view} readOnly={vm.readOnly} />;
    case 'accounts':
      return <AccountsSection body={vm.body} readOnly={vm.readOnly} />;
    case 'generation':
      return <GenerationSection body={vm.body} readOnly={vm.readOnly} />;
    case 'hotkeys':
      return <HotkeysSection body={vm.body} />;
    case 'appearance':
      return <AppearanceSection body={vm.body} readOnly={vm.readOnly} />;
    case 'diagnostics':
      return <DiagnosticsSection body={vm.body} />;
  }
}

/** The sign-in screen: it reads the hub address and access from «Аккаунт» and the sound switches from «Вид и звук». */
function SignInGate({ vm, helpUrl }: { readonly vm: OptionsVM; readonly helpUrl: string | null }): JSX.Element | null {
  const account = useView({ of: 'options', section: 'account' }).value;
  const appearance = useView({ of: 'options', section: 'appearance' }).value;
  if (vm.signIn === null || vm.view.s !== 'forbidden') return null;
  return (
    <SignInScreen
      signIn={vm.signIn}
      reason={vm.view.error}
      account={account.body}
      appearance={appearance.body}
      version={vm.version}
      readOnly={vm.readOnly}
      helpUrl={helpUrl}
      // ST-012: the first run starts here — the hosts, the sign-in and the consent are still to do.
      checklist={vm.checklist === null ? null : <Checklist checklist={vm.checklist} />}
    />
  );
}

export interface OptionsProps {
  readonly location: ValueSignal<OptionsRoute>;
  /** The page of the site that helps with the sign-in (ST-050). */
  readonly helpUrl?: string | null;
}

export function Options({ location, helpUrl = null }: OptionsProps): JSX.Element {
  const route = useValueSignal(location).value;
  const vm: OptionsVM = useView({ of: 'options', section: route.section }).value;
  const i18n = useI18n();
  const act = useAct();
  const reduced = useReducedMotion();
  const main = useRef<HTMLElement>(null);
  const view = vm.view;
  const anchor = route.code === undefined ? null : (ANCHORS[route.code] ?? null);
  const drawn = vm.body !== null;
  const go = (section: SettingsSection): void => void act({ type: 'OpenSettings', route: { section } }, { quiet: true });

  // ST-009: the target is highlighted for 2 s once it is drawn, and again on every hash change.
  useEffect(() => {
    if (anchor === null || !drawn) return undefined;
    const target = main.current?.querySelector<HTMLElement>(`[data-pg-anchor="${anchor}"]`) ?? null;
    if (target === null) return undefined;
    target.classList.remove('is-target');
    void target.offsetWidth;
    target.classList.add('is-target');
    // Only as far as needed: a target already in view stays where it is, with the plate above it.
    target.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    const timer = setTimeout(() => target.classList.remove('is-target'), 2000);
    return () => {
      clearTimeout(timer);
      target.classList.remove('is-target');
    };
  }, [route.seq, anchor, drawn, vm.section, reduced]);

  const gate = view.s === 'forbidden' && vm.signIn !== null;
  if (gate) {
    return (
      <div class="pg-page" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }} data-pg-gate="">
        <main ref={main} class="pg-main" aria-label={i18n.t('signIn.title')}>
          <SignInGate vm={vm} helpUrl={helpUrl} />
        </main>
        <PageLayers />
      </div>
    );
  }

  const title = i18n.text(vm.nav.find((item) => item.section === vm.section)?.label ?? { key: 'settings.label' });
  const lead = vm.section === 'status' ? statusLead(i18n, vm.body) : i18n.t(LEADS[vm.section]);
  return (
    <div class="pg-page" data-pg-section={vm.section}>
      <Nav vm={vm} onGo={go} />
      <main ref={main} class="pg-main" aria-label={i18n.t('settings.label')}>
        {/* A window of 640 px or less has no section column: the sections are a list above the title (ui-design §10). */}
        <div class="pg-select">
          <Picker
            label={i18n.t('settings.nav.label')}
            text={title}
            value={vm.section}
            options={vm.nav.map((item) => ({ value: item.section, label: i18n.text(item.label) }))}
            onChange={(value) => {
              const next = vm.nav.find((item) => item.section === value);
              if (next !== undefined) go(next.section);
            }}
          />
        </div>
        <div class="pg-head">
          <div>
            <h1 class="pg-h1">{title}</h1>
            <p class="pg-lead">{lead}</p>
          </div>
          <SaveState save={vm.save} />
        </div>
        {vm.readOnly ? (
          // ST-016: the store is newer than this build — look, do not touch.
          <div class="pg-plate" role="status" data-cg-code="CG-STORAGE-VERSION">
            <Dot kind="ring" />
            <div>
              <CodeLine code="CG-STORAGE-VERSION" class="pg-code" />
              <div class="pg-plate__t">{i18n.t('cg.storageVersion.title')}</div>
              <div class="pg-plate__b">{i18n.t('cg.storageVersion.body')}</div>
            </div>
          </div>
        ) : null}
        {vm.highlight === null ? null : (
          // ST-008: the plate of a deep link — the code and what it means.
          <div class="pg-plate" role="status" data-pg-plate={vm.highlight.code} data-cg-code={vm.highlight.code}>
            <Dot kind="ring" />
            <div>
              <CodeLine code={vm.highlight.code} class="pg-code" />
              <div class="pg-plate__t">{vm.highlight.title}</div>
              <div class="pg-plate__b">{vm.highlight.body}</div>
            </div>
            <Button label={i18n.t('common.close')} variant="quiet" icon="x" iconOnly onClick={() => go(vm.section)} />
          </div>
        )}
        {/* Before «Статус» has its body (loading, a failure) the first-run steps stand on their own. */}
        {vm.checklist !== null && vm.section === 'status' && vm.body === null ? <Checklist checklist={vm.checklist} /> : null}
        {view.s === 'loading' ? (
          <div class="cg-state cg-state--loading" role="status" aria-busy="true" style={{ paddingLeft: 0 }}>
            <Spinner />
            <span>{view.stage === null ? i18n.t('common.loading') : i18n.text(view.stage)}</span>
          </div>
        ) : null}
        {view.s === 'error' ? (
          // ST-017: the settings could not be read — never defaults posing as the person's values.
          <ErrorCard tone="failure" error={view.error}>
            {view.retry === null ? null : <Button label={i18n.t('common.retry')} variant="line" onClick={() => void act(view.retry ?? { type: 'ReloadTab' }, { quiet: true })} />}
          </ErrorCard>
        ) : null}
        {view.s === 'offline' ? (
          <ErrorCard tone="failure" error={view.error} alert={false}>
            {view.retry === null ? null : <Button label={i18n.t('common.retry')} variant="line" onClick={() => void act(view.retry ?? { type: 'RecheckStatus' }, { quiet: true })} />}
          </ErrorCard>
        ) : null}
        <Section vm={vm} anchor={anchor} checklist={vm.checklist === null ? null : <Checklist checklist={vm.checklist} />} />
      </main>
      <PageLayers />
    </div>
  );
}
