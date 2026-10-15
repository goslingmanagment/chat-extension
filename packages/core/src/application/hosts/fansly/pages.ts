// Fansly on the settings page — its controller (R20 P14b1; docs/project-unite/architecture.md §4, §12; FS-SET-1,
// FS-PERM-1; ST-012, ST-067…ST-079, AU-035). The pages' composition root makes one and hands it out twice: as the
// control Fansly's surface draws from (ui/hosts/fansly/pages) and as the site's port of «Аккаунты» to the shared
// pages controller (`PagePorts.siteAccounts`), which names no site.
//
// - «Включить Fansly» and the tabs waiting for a reload are the shared `site.access` (P9a, `SiteAccessControl`): the
//   browser's prompt runs inside the click, before anything is awaited.
// - Fansly's part of `settings.ext` («Fansly через вкладку», the tones on Fansly, the Recap depth above 3000) is read
//   and written through Fansly's module (`fansly.settings.*`), whose one owner of the key is the core's. Read only
//   while Fansly is on — off, the module does not run and the part is not shown. «Сохранено ✓» only with the revision
//   the background answered; a write that failed waits for «Повторить» or the next change, never goes by itself.
//   Writes go one after another, in the order they were made.
// - «Аккаунты»: the captured sessions of the background (`fansly.accounts.read`) as the shared controller takes a
//   site's facts — an account goes by its creator's id once a tab of ours named it, its legacy id an alias (ST-079);
//   «к вкладке» by the tab's registration or session (`fansly.accounts.focus`, ST-076). The tabs no account is known
//   for (ST-077) and how many are open stay in this control's view for Fansly's card.
// - The first run (ST-012): Fansly's three steps — switch it on, open Fansly as the model, reload the tabs.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import type { FanslyPageFacts, FanslyPagesControl, FanslyPagesView, FanslySaveState, FanslyStep } from '@cg/contracts/pages-fansly';
import type { ToneId } from '@cg/contracts/settings';
import type { SettingsExtPatch, SettingsExtState } from '@cg/contracts/settings-ext';
import type { SiteAccessControl } from '@cg/contracts/site-access';
import type { FanslyAccountSession, FanslyAccountsView, FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';

import type { PageAnswer, PageSiteAccounts, SiteSessionFact } from '../../pages/ports';

/** The settings page's own types of Fansly's registry. */
export type FanslyPageRequestType = 'fansly.settings.read' | 'fansly.settings.write' | 'fansly.accounts.read' | 'fansly.accounts.focus';

export interface FanslyPagesDeps {
  /** `site.access` of Fansly (core application/pages `createSiteAccessControl`). */
  readonly access: SiteAccessControl;
  /** A request of Fansly's registry over the page's port (the core routes it to Fansly's module while Fansly is on). */
  request<T extends FanslyPageRequestType>(type: T, payload: FanslyTabRequestPayload<T>): Promise<PageAnswer<FanslyTabResponsePayload<T>>>;
  /** `sound.preview` of the shared protocol: a tone at a volume. */
  preview(tone: ToneId, volume: number): Promise<PageAnswer<{ readonly played: boolean; readonly code?: CgCode | undefined }>>;
}

export interface FanslyPages {
  readonly control: FanslyPagesControl;
  /** Fansly's port of «Аккаунты» for the shared pages controller. */
  readonly accounts: PageSiteAccounts;
}

const UNREACHABLE: CgErrorWire = { code: 'CG-RUNTIME-UNREACHABLE' };
const unreachable = <T>(): PageAnswer<T> => ({ ok: false, error: UNREACHABLE });

/** A session as the shared «Аккаунты» takes a site's facts: by the creator's id once known, its legacy id an alias (ST-079). */
export function sessionFact(session: FanslyAccountSession): SiteSessionFact {
  const id = session.canonicalId ?? session.legacyId;
  return {
    id,
    aliases: session.legacyId === id ? [] : [session.legacyId],
    // On Fansly the host's account and the platform's are the same creator (`/account/me`): known with the canonical id only.
    platformAccountId: session.canonicalId,
    tabs: session.tabs,
    observedAt: session.observedAt,
  };
}

/** Switched on and granted: Fansly's module answers the page only then. */
export const fanslyOn = (access: SiteAccessControl['value']): boolean => access.state?.enabled === true && access.state.granted;

export function createFanslyPages(deps: FanslyPagesDeps): FanslyPages {
  let settings: SettingsExtState | null = null;
  let settingsError: CgErrorWire | null = null;
  let save: FanslySaveState = { s: 'idle' };
  let accounts: FanslyAccountsView | null = null;
  /** The patch of the write that failed, for «Повторить». */
  let failed: SettingsExtPatch | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const view = (): FanslyPagesView => ({ access: deps.access.value, on: fanslyOn(deps.access.value), settings, settingsError, save, accounts });
  let value = view();
  const notify = (): void => {
    value = view();
    for (const listener of [...listeners]) listener();
  };
  /** Off: nothing of Fansly's part is shown any more (its module does not run). */
  const forgetIfOff = (): void => {
    if (fanslyOn(deps.access.value)) return;
    settings = null;
    settingsError = null;
    accounts = null;
    failed = null;
    save = { s: 'idle' };
  };
  deps.access.subscribe(() => {
    forgetIfOff();
    notify();
  });

  /** A newer revision only: an answer that comes late never takes back a later one. */
  const adopt = (next: SettingsExtState): void => {
    if (settings === null || next.revision >= settings.revision) settings = next;
  };

  async function readSettings(): Promise<void> {
    const answer = await deps.request('fansly.settings.read', {}).catch(unreachable<SettingsExtState>);
    if (answer.ok) {
      adopt(answer.payload);
      settingsError = null;
    } else settingsError = answer.error;
    forgetIfOff();
    notify();
  }

  /** The access state, read once before the first question of a page that came before it. */
  async function accessKnown(): Promise<boolean> {
    if (deps.access.value.state === null) await deps.access.refresh();
    return fanslyOn(deps.access.value);
  }

  function write(patch: SettingsExtPatch): Promise<boolean> {
    const run = writes.then(async (): Promise<boolean> => {
      if (!fanslyOn(deps.access.value)) return false;
      if (settings?.readOnly === true) {
        save = { s: 'failed', error: { code: 'CG-STORAGE-VERSION' } };
        notify();
        return false;
      }
      save = { s: 'saving' };
      notify();
      const answer = await deps.request('fansly.settings.write', { patch }).catch(unreachable<SettingsExtState>);
      if (answer.ok) {
        adopt(answer.payload);
        save = { s: 'saved', revision: answer.payload.revision };
        failed = null;
      } else {
        save = { s: 'failed', error: answer.error };
        failed = patch;
      }
      notify();
      return answer.ok;
    });
    writes = run.catch(() => false);
    return run;
  }

  const control: FanslyPagesControl = {
    get value() {
      return value;
    },
    concerns: (facts) => fanslyConcerns(value, facts),
    steps: (facts) => fanslySteps(value, facts),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      await deps.access.refresh();
      if (fanslyOn(deps.access.value)) await readSettings();
      else {
        forgetIfOff();
        notify();
      }
    },
    // The browser's prompt is asked synchronously inside `access.enable()`: nothing before it here.
    async enable() {
      await deps.access.enable();
      if (fanslyOn(deps.access.value)) await readSettings();
    },
    disable: () => deps.access.disable(),
    reload: () => deps.access.reload(),
    setViaTab: (on) => write({ hosts: { 'fansly-web': { viaTab: on } } }),
    setTone: (which, tone) => write({ hosts: { 'fansly-web': { sound: which === 'messagesTone' ? { messagesTone: tone } : { subscribersTone: tone } } } }),
    // 3000 and below is v1's own depth: the wish above it goes.
    setDeep: (deep) => write({ windows: { deep: deep === null || deep <= 3000 ? null : deep } }),
    retry: () => (failed === null ? Promise.resolve(false) : write(failed)),
    async preview(tone, volume) {
      const answer = await deps.preview(tone, volume).catch(unreachable<{ readonly played: boolean; readonly code?: CgCode }>);
      if (!answer.ok) return answer.error;
      return answer.payload.played ? null : { code: answer.payload.code ?? 'CG-AUDIO-BLOCKED' };
    },
  };

  const siteAccounts: PageSiteAccounts = {
    host: 'fansly-web',
    async read() {
      if (!(await accessKnown())) {
        accounts = null;
        notify();
        return { ok: true, payload: null };
      }
      const answer = await deps.request('fansly.accounts.read', {}).catch(unreachable<FanslyAccountsView>);
      if (!answer.ok) return answer;
      accounts = answer.payload;
      forgetIfOff();
      notify();
      return { ok: true, payload: { sessions: answer.payload.sessions.map(sessionFact) } };
    },
    async focus(hostAccountId) {
      if (!(await accessKnown())) return { ok: true, payload: false };
      const answer = await deps.request('fansly.accounts.focus', { hostAccountId }).catch(unreachable<{ readonly focused: boolean }>);
      return answer.ok ? { ok: true, payload: answer.payload.focused } : answer;
    },
  };

  return { control, accounts: siteAccounts };
}

/**
 * Fansly's steps of the first run (ST-012, FS-PERM-1, FS-IDN-4): «Включить Fansly» (the prompt in the click), «Открыть
 * Fansly под моделью» (done once this browser has seen a Fansly account: a tab named its creator, or a session of it was
 * captured), «Перезагрузить вкладки Fansly» (done when none waits; its action reloads them).
 */
export function fanslySteps(view: FanslyPagesView, facts: FanslyPageFacts): readonly FanslyStep[] {
  const waiting = view.access.state?.waitingReload ?? 0;
  return [
    { id: 'fansly-enable', done: view.on, action: view.on ? null : 'enable' },
    { id: 'fansly-open', done: facts.seenAccount || (view.accounts?.sessions.length ?? 0) > 0, action: null },
    { id: 'fansly-reload', done: view.on && waiting === 0, action: view.on && waiting > 0 ? 'reload' : null },
  ];
}

/**
 * Whom Fansly concerns on the settings page: Fansly is switched on (granted or not), a page of the sign-in is on Fansly,
 * or this browser has seen a Fansly account. Nobody else sees Fansly's card, rows or steps — a ChatSpace chatter's
 * settings stay as they were.
 */
export function fanslyConcerns(view: FanslyPagesView, facts: FanslyPageFacts): boolean {
  return view.access.state?.enabled === true || view.access.state?.granted === true || facts.fanslyPage || facts.seenAccount;
}
