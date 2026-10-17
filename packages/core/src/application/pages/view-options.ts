// The options page as one view per section (architecture.md §9.4, §9.5,
// §9.9; ui-design §4.24): the shell around every section — the navigation
// with its problem dots, the deep-link plate, the save state, the read-only
// barrier, the sign-in screen that replaces the settings while nobody is
// signed in (ST-011), and the first-run checklist (ST-012).

import { SETTINGS_SECTIONS, type CgErrorWire, type SettingsSection } from '@cg/contracts/errors';
import { ONBOARDING_STEPS, type OnboardingStep, type OptionsBodyMap, type OptionsVM, type SaveStateVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { accountKeyOf, answered, boundPageOf, button, codeError, currentAccountOf, errorOf, knownAccounts, msg, personaOfPage, sessionUnknownError, valueOf, type PagesModel } from './model';
import { type PagePorts } from './ports';
import { accountBody, accountsBody, appearanceBody, diagnosticsBody, generationBody, hotkeysBody, personasBody, signInVm } from './view-sections';
import { hostReportOf, hubState, statusBody } from './view-status';

const SECTION_LABELS = {
  status: 'settings.section.status',
  account: 'settings.section.account',
  personas: 'settings.section.personas',
  accounts: 'settings.section.accounts',
  generation: 'settings.section.generation',
  hotkeys: 'settings.section.hotkeys',
  appearance: 'settings.section.appearance',
  diagnostics: 'settings.section.diagnostics',
} as const satisfies Record<SettingsSection, string>;

/** Why nobody is signed in: the banner of the sign-in screen (AU-015). */
function signedOutError(model: PagesModel): CgErrorWire {
  if (model.sessionEnd === 'revoked') return { code: 'CG-AUTH-REVOKED' };
  if (model.sessionEnd === 'expired') return { code: 'CG-AUTH-EXPIRED' };
  // The person signed out and the hub did not confirm the revoke: said on the sign-in screen, not hidden (ST-051).
  if (model.sessionEnd === 'sign-out-unconfirmed') return { code: 'CG-AUTH-REQUIRED', detail: 'signed out here; the hub did not confirm the revoke' };
  return { code: 'CG-AUTH-REQUIRED' };
}

/** Which sections carry a dot next to their name (ST-004). */
function sectionProblems(model: PagesModel): ReadonlySet<SettingsSection> {
  const problems = new Set<SettingsSection>();
  if (valueOf(model.session) === null) return problems;
  const status = statusBody(model);
  if (status.readiness.s === 'actions-needed') problems.add('status');
  if (hubState(model) === 'down' || model.hubAccess === false) problems.add('account');
  const pages = valueOf(model.bootstrap)?.pages ?? [];
  if (answered(model.catalog) && pages.some((page) => personaOfPage(model, page.pageId).s !== 'set')) problems.add('personas');
  if (knownAccounts(model).some((entry) => model.bindings.get(accountKeyOf(entry.account))?.ok === false)) problems.add('accounts');
  if (model.sound.error !== null) problems.add('appearance');
  if (valueOf(model.settings)?.readOnly === true || model.save.s === 'failed') problems.add('diagnostics');
  return problems;
}

function saveState(model: PagesModel): SaveStateVM {
  switch (model.save.s) {
    case 'idle':
    case 'saving':
      return { s: model.save.s };
    case 'saved':
      return { s: 'saved', revision: model.save.revision };
    case 'failed':
      return { s: 'failed', error: errorOf(model, model.save.error), retry: { type: 'RetrySettingsWrite' } };
  }
}

const open = (section: SettingsSection): UiAction => ({ type: 'OpenSettings', route: { section } });

/**
 * The steps of the first run a chatter does (decision X55, as the old Fansly extension's three): the site's access,
 * the sign-in, the site open. The others are the team lead's — the persona, the binding, the consent, the sound and
 * the keys — and fold under «Ещё» (`more`). «Установить расширение» is not a step: a page of the extension is open.
 */
const CHATTER_STEPS: readonly OnboardingStep[] = ['host-permission', 'sign-in', 'open-chatspace'];

/**
 * The first-run checklist: the steps of §9.9 but the install, each with what is known
 * about it now — the chatter's three first, the team lead's under «Ещё» (X55). It stands on the sign-in screen too —
 * the first run starts there, with «Дать права на хосты» and «Войти в хаб» still to
 * do; a step that needs a sign-in has no action until there is one.
 */
export function checklistOf(model: PagesModel): OptionsVM['checklist'] {
  if (model.effective === null || model.effective.onboarding.checklistDismissed) return null;
  const session = valueOf(model.session);
  const afterSignIn = (action: UiAction): UiAction | null => (session === null ? null : action);
  const current = currentAccountOf(model);
  const bound = current === null ? null : boundPageOf(model, current.account);
  const hostOpen = (hostReportOf(model)?.tabs ?? 0) > 0 || (valueOf(model.accounts) ?? []).length > 0;
  const access = model.hostAccess === true && model.hubAccess === true;
  const facts: Record<OnboardingStep, { readonly done: boolean; readonly action: UiAction | null; readonly label: Parameters<typeof msg>[0] }> = {
    install: { done: true, action: null, label: 'settings.onboarding.install' },
    'host-permission': {
      done: access,
      action: access ? null : { type: 'RequestPermission', kind: model.hostAccess === true ? 'hub-host' : 'chatspace-host' },
      label: 'settings.onboarding.hosts',
    },
    // On the sign-in screen the step points at the form in front of the person (the deep link highlights it, ST-009).
    'sign-in': { done: session !== null, action: session === null ? { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } } : null, label: 'settings.onboarding.signIn' },
    persona: { done: bound !== null && personaOfPage(model, bound.binding.pageId).s === 'set', action: afterSignIn(open('personas')), label: 'settings.onboarding.persona' },
    'open-chatspace': { done: hostOpen, action: null, label: 'settings.onboarding.openChatSpace' },
    binding: { done: bound !== null, action: afterSignIn(open('accounts')), label: 'settings.onboarding.binding' },
    consent: { done: model.consent === true, action: model.consent === true ? null : { type: 'RequestPermission', kind: 'data-collection' }, label: 'settings.onboarding.consent' },
    'sound-hotkeys': { done: model.sound.tested, action: afterSignIn(open('appearance')), label: 'settings.onboarding.soundAndHotkeys' },
  };
  const actionLabel = (action: UiAction): Parameters<typeof msg>[0] => {
    if (action.type !== 'RequestPermission') return 'common.go';
    return action.kind === 'data-collection' ? 'settings.status.consentAsk' : 'settings.account.grantAccess';
  };
  const step = (id: OnboardingStep): NonNullable<OptionsVM['checklist']>['steps'][number] => {
    const fact = facts[id];
    const action = fact.done || fact.action === null ? null : button(actionLabel(fact.action), fact.action);
    return { id, label: msg(fact.label), done: fact.done, action, ...(CHATTER_STEPS.includes(id) ? {} : { more: true as const }) };
  };
  return {
    steps: [...CHATTER_STEPS, ...ONBOARDING_STEPS.filter((id) => id !== 'install' && !CHATTER_STEPS.includes(id))].map(step),
    dismiss: { type: 'SetPreference', key: 'onboarding.checklistDismissed', value: true },
  };
}

function bodyOf<S extends SettingsSection>(model: PagesModel, ports: Pick<PagePorts, 'catalog'>, section: S): OptionsBodyMap[S] | null {
  const bodies: { readonly [K in SettingsSection]: () => OptionsBodyMap[K] | null } = {
    status: () => statusBody(model),
    account: () => accountBody(model),
    personas: () => personasBody(model),
    accounts: () => accountsBody(model),
    generation: () => generationBody(model),
    hotkeys: () => hotkeysBody(model, ports),
    appearance: () => appearanceBody(model),
    diagnostics: () => diagnosticsBody(model),
  };
  return bodies[section]();
}

/** Sections the sign-in screen itself reads: the hub address and access, and the sound switches (ST-011, ST-134). */
const SIGNED_OUT_BODIES: readonly SettingsSection[] = ['account', 'appearance'];

export function optionsView<S extends SettingsSection>(model: PagesModel, ports: Pick<PagePorts, 'catalog'>, section: S): OptionsVM<S> {
  const selector = { of: 'options', section } as const;
  const reload: UiAction = { type: 'ReloadView', selector };
  const session = valueOf(model.session);
  const settingsKnown = valueOf(model.settings) !== null;
  const unknown = sessionUnknownError(model);
  let view: VmView;
  let body: OptionsBodyMap[S] | null = null;
  let signIn: OptionsVM['signIn'] = null;
  // The checklist stands where the page is drawn: over a section or on the sign-in screen, not over an error or a spinner.
  let drawn = false;
  if (model.unreachable) {
    view = { s: 'error', error: codeError(model, 'CG-RUNTIME-UNREACHABLE'), retry: reload };
  } else if (model.settings.s === 'error' && !settingsKnown) {
    // ST-017 «настройки недоступны»: never defaults posing as the person's values.
    view = { s: 'error', error: errorOf(model, model.settings.error), retry: reload };
  } else if (unknown !== null) {
    // The sign-in state could not be read: neither the settings nor the sign-in screen — a failed read is not a sign-out (PU-002, ST-042).
    view = { s: 'error', error: errorOf(model, unknown), retry: reload };
  } else if (!settingsKnown || model.session.s === 'idle' || (model.session.s === 'loading' && model.session.last === null && session === null)) {
    view = { s: 'loading', since: model.settings.s === 'loading' ? model.settings.since : null, stage: null };
  } else if (session === null) {
    view = { s: 'forbidden', error: errorOf(model, signedOutError(model)), remedy: null };
    signIn = signInVm(model);
    body = SIGNED_OUT_BODIES.includes(section) ? bodyOf(model, ports, section) : null;
    drawn = true;
  } else {
    body = bodyOf(model, ports, section);
    drawn = true;
    // «Войти заново» (ST-048): the same form inside «Аккаунт», the sign-in stays as it is until the hub answers.
    if (section === 'account') signIn = signInVm(model);
    if (hubState(model) === 'down') {
      const wire = model.bootstrap.s === 'error' ? model.bootstrap.error : { code: 'CG-HUB-UNAVAILABLE' as const };
      view = { s: 'offline', error: errorOf(model, wire), retry: { type: 'RecheckStatus' }, lastGoodAt: model.bootstrap.s === 'error' && model.bootstrap.last !== null ? model.bootstrap.at : null };
    } else {
      view = { s: 'ready' };
    }
  }
  const problems = sectionProblems(model);
  const lastSeen = model.effective?.onboarding.lastSeenVersion ?? null;
  const vm = {
    view,
    section,
    version: model.env.version,
    nav: SETTINGS_SECTIONS.map((entry) => ({ section: entry, label: msg(SECTION_LABELS[entry]), problem: problems.has(entry) })),
    highlight: model.location.code === undefined ? null : codeError(model, model.location.code),
    save: saveState(model),
    readOnly: valueOf(model.settings)?.readOnly ?? false,
    signIn,
    checklist: drawn ? checklistOf(model) : null,
    body,
    footer: {
      whatsNew: model.env.links.whatsNew === null ? null : ({ type: 'Navigate', to: { kind: 'page', page: 'whats-new' } } satisfies UiAction),
      changelog: model.env.links.changelog === null ? null : ({ type: 'Navigate', to: { kind: 'page', page: 'changelog' } } satisfies UiAction),
      unseenNotes: model.effective !== null && lastSeen !== model.env.version,
    },
  };
  // `section` and `body` are correlated by `bodyOf`; the union of sections cannot express that for a generic S.
  return vm as unknown as OptionsVM<S>;
}
