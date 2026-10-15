// The vault on a Fansly tab, wired (docs/project-unite/architecture.md §7.11, §7.21; FS-VLT-1, FS-PERF-3; VA-001…
// VA-006; R20 P13b): Fansly's vault chunk (`lazy/fansly/vault.js`), loaded by Fansly's application half the first time
// the tab is on `/creator/vault` (composition/tab/hosts/fansly/app.ts), and kept for the life of the application.
//
// - The entry stands on `/creator/vault` only, and only where the page's owner switched the vault on and the host can
//   take a file (the manifest's `vault`: the page's flag `vault`, the host's capability `vault`): the page's binding
//   comes from the boards' page context (the sign-in, the bootstrap, the creator's page). Nothing of it otherwise.
// - The panel's controller (host-fansly isolated/vault/panel.ts) over the page's uploader and the background's
//   checkpoints (`fansly.vault.*`, bg/fansly); its surface (ui/hosts/fansly/vault) in our panel layer, with the site's
//   profile. The port's `uploadToVault` is served by the same uploader while this runs.
// - The page is read again on the port's route and accounts and MAIN's vault facts — never on a timer.

import type { I18nKey } from '@cg/contracts/errors';
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { I18n } from '@cg/contracts/vm';
import { createPageContext } from '@cg/core/application/boards';
import { admittedOn } from '@cg/core/domain/features';
import { FANSLY_VAULT_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import { createLiveI18n } from '@cg/core/domain/i18n/live';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { createVaultPanel, createVaultUploader, isVaultPath, vaultUploadOf, type VaultPanelStore, type VaultTarget } from '@cg/host-fansly/isolated/vault';
import { VAULT_SURFACE, vaultSurface } from '@cg/ui/hosts/fansly/vault';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { overlayRoot } from '../../surfaces';
import { fanslyRequest } from './requests';

/** Above the background's wait for its site's module (10 s, platform rpc-background `DEFAULT_SITE_WAIT_MS`). */
export const VAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The background's checkpoints of the vault, over the tab's port. A read that fails rejects: nothing starts over it.
 * `held` — another open tab holds the album's upload (the background answers so, and keeps nothing of this tab's).
 */
export function vaultStoreOf(rpc: SiteAppEnv['rpc'], timeoutMs = VAULT_REQUEST_TIMEOUT_MS): VaultPanelStore {
  const album = (target: VaultTarget) => ({ hostAccountId: target.hostAccountId, albumId: target.albumId });
  const look = async (target: VaultTarget): Promise<{ readonly checkpoint: VaultCheckpoint | null; readonly held: boolean }> => {
    const answer = await fanslyRequest(rpc, 'fansly.vault.resume', album(target), timeoutMs);
    if (!answer.ok) throw new Error(answer.error.code);
    return { checkpoint: answer.payload.checkpoint, held: answer.payload.held === true };
  };
  return {
    look,
    load: async (target) => (await look(target)).checkpoint,
    async save(checkpoint) {
      const answer = await fanslyRequest(rpc, 'fansly.vault.checkpoint', { checkpoint }, timeoutMs);
      return answer.ok && answer.payload.recorded;
    },
    async clear(target, uploadId) {
      const answer = await fanslyRequest(rpc, 'fansly.vault.clear', { ...album(target), uploadId }, timeoutMs);
      return answer.ok && answer.payload.recorded;
    },
  };
}

/**
 * The tab's I18n with the vault's own texts (`fansly.vault.*`, R20 P13b): they come with this chunk, never in the
 * catalog every Fansly page with our application loads (its budget, §3.1). The vault's keys are answered here in the
 * tab's language at the moment of the call; every other key, number and time is the tab's own port's.
 */
export function withVaultTexts(base: I18n): I18n {
  const own = createLiveI18n((language) => FANSLY_VAULT_TEXTS[language], { language: base.language });
  const mine = (key: I18nKey): boolean => (key as string).startsWith('fansly.vault.');
  const now = (): typeof own => {
    if (own.language !== base.language) own.setLanguage(base.language);
    return own;
  };
  return {
    get language() {
      return base.language;
    },
    t: (key, params) => (mine(key) ? now().t(key, params) : base.t(key, params)),
    plural: (key, count, params) => (mine(key) ? now().plural(key, count, params) : base.plural(key, count, params)),
    text: (msg) => (mine(msg.key) ? now().text(msg) : base.text(msg)),
    formatMoneyMills: (mills, format) => base.formatMoneyMills(mills, format),
    ...(base.formatMoneySpoken === undefined ? {} : { formatMoneySpoken: (mills: Parameters<I18n['formatMoneyMills']>[0], format?: Parameters<I18n['formatMoneyMills']>[1]) => base.formatMoneySpoken?.(mills, format) ?? '' }),
    formatAge: (from, at) => base.formatAge(from, at),
    formatTime: (at, style) => base.formatTime(at, style),
    ...(base.formatTimeIn === undefined ? {} : { formatTimeIn: (at: Parameters<I18n['formatTime']>[0], zone: string, style?: Parameters<I18n['formatTime']>[1]) => base.formatTimeIn?.(at, zone, style) ?? '' }),
    formatDuration: (ms, style) => base.formatDuration(ms, style),
    subscribe: (listener) => base.subscribe(listener),
  };
}

export function startFanslyVault(env: SiteAppEnv<FanslyPort>): () => void {
  const { win, host: port, rpc, mounts } = env;
  const uploader = createVaultUploader({ win, port });
  const context = createPageContext({ rpc, host: port });
  const listeners = new Set<() => void>();
  const page = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const panel = createVaultPanel({
    uploader,
    store: vaultStoreOf(rpc),
    // Fansly's page names its creator by id alone: the hub page bound to it gives the name the person knows.
    account() {
      const creator = port.current().accounts[0];
      return creator === undefined ? null : { username: creator.username, displayName: creator.displayName ?? context.current().page?.title ?? null };
    },
    onPage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const deps = { ...env.deps, i18n: withVaultTexts(env.deps.i18n) };
  const upload = vaultUploadOf(win, uploader);

  /** On the vault page, the feature admitted on the page this tab's creator is bound to. */
  const shown = (): boolean => {
    if (!isVaultPath(win.location.pathname)) return false;
    const state = context.current();
    const report = port.probe();
    return admittedOn(env.features, 'vault', null, state.bootstrap, state.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  let mount: KitMount | null = null;
  /** Test builds: what the panel shows, for the e2e (no text of the page's, the person's file names only). */
  const report = (): void => {
    if (env.probe === null) return;
    const { shown: on, mode, account, album, uploader: form, order, selection, run, question, resume, note, controls } = panel.view();
    env.probe.set('vault', { shown: on, mode, account, album, uploader: form, order, items: selection?.items ?? null, run, question, resume, note, controls, mounted: mount !== null });
  };
  const sync = (): void => {
    const now = shown();
    if (now && mount === null) mount = mountKitSurface(VAULT_SURFACE, overlayRoot(mounts, 'panel'), deps, vaultSurface(panel), { report: env.report });
    // Away from the vault: the surface goes, unless a file is still in flight (the run stops by itself, and says why).
    else if (!now && mount !== null && !panel.running()) {
      mount.unmount();
      mount = null;
    }
    panel.setShown(now);
    report();
  };

  const offs = [
    // The port's single file goes only where the panel's entry stands: off the vault, or the owner's switch off — refused.
    port.vault.serve((file) => (shown() ? upload(file) : Promise.resolve({ state: 'refused', reason: 'anchor-missing' }))),
    port.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') {
        sync();
        page();
      }
    }),
    port.vault.onFact(page),
    port.vault.onLost(page),
    port.onContract(sync),
    context.subscribe(() => {
      sync();
      page();
    }),
    panel.subscribe((view) => {
      mounts.setDismissibleOpen('panel', 'vault', view.shown && view.mode === 'open');
      // A run that held the surface away from the vault has settled: it goes now.
      if (!view.shown && mount !== null && !panel.running()) sync();
      else report();
    }),
  ];
  sync();

  return () => {
    for (const off of offs.splice(0)) off();
    panel.dispose();
    context.dispose();
    mounts.setDismissibleOpen('panel', 'vault', false);
    mount?.unmount();
    mount = null;
  };
}
