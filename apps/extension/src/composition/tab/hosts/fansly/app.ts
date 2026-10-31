// The application's half of the Fansly adapter (docs/project-unite/
// architecture.md §1.3, §7.13; tab/adapter.ts): what only Fansly's
// application does with Fansly's host port. It comes in Fansly's `tab-app`
// chunk (lazy/fansly/tab-app.ts) with the first surface of ours on a Fansly
// page — the dock, once the open chat's anchors give it a place (R20 P7d) —
// never in the early bundle.
//
// - No live configuration: nothing of Fansly's host port is switched by the
//   bootstrap (its WS tap is on by itself, FS-WS-4; X8 does not exist here).
// - Fansly's slice of the feature manifest (§1.4) and what its contract report
//   must name (§7.12).
// - Its profile for our interface (§1.5, R20 P8d): the palette of the page's
//   own variables, live with its theme (host-fansly isolated/palette.ts), the
//   dock's variant `fansly` on our hosts with its sheet (ui hosts/fansly), and
//   the phrases that name the site — «на Fansly».
// - Its AI policy (§1.6, F10; R20 P8b1): Fansly's own chunk `ai-fansly`,
//   loaded with the dock — every start's proof is MAIN's generation snapshot
//   (the window check, the fan's known ids, the deletions, a draft's texts),
//   its window cut by the effective messageCount of that start; a start of
//   the deep window asks the background for the person's depth (R20 P8c).
// - Its own surfaces (R20 P13b): the vault's chunk on `/creator/vault`; the floating launcher's clicks (X46) — «Онлайн», Spenders
//   and «Новые» from every page, as the popup opens them; the mark of a chat waiting for a reply in Fansly's own list of
//   chats (2026-10-29), as the settings page holds it.

import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import type { FanslyInboxMark } from '@cg/contracts/settings-ext';
import type { HostUiProfile, MountSurfaceKind } from '@cg/contracts/vm';
import { FANSLY_PHRASES, REGISTRATION_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanslyPaletteSignal } from '@cg/host-fansly/isolated/palette';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';

import type * as AiChunk from '../../../../../lazy/fansly/ai-fansly';
import { fanslyRegistrationDate } from '@cg/core/domain/hosts/fansly/snowflake';
import type * as NotesChunk from '../../../../../lazy/fansly/notes';
import type * as RegistrationChunk from '../../../../../lazy/fansly/registration';
import type * as VaultChunk from '../../../../../lazy/fansly/vault';
import { FANSLY_FEATURE_SLICE } from '../../../features/fansly';
import type { HostAppAdapter, HostThemeSource, SiteAppEnv } from '../../adapter';

/** The page our content script runs in: read only when a surface mounts or the page's theme switches. */
const page = (): Document => document;

/**
 * Fansly's profile for our interface (§1.5, §7.17): the palette of the page's own variables in the theme it shows,
 * live; the variant `fansly` with its sheet; its phrases.
 */
export function fanslyUi(theme: HostThemeSource, doc: () => Document = page): HostUiProfile {
  return {
    palette: fanslyPaletteSignal(theme, doc),
    dock: { variant: 'fansly' },
    sheet: FANSLY_DOCK_SHEET,
    phrases: FANSLY_PHRASES,
  };
}

/** The marks of the list of chats (`settings.ext`), checked here: Fansly's registry stays out of this chunk. */
const INBOX_MARKS: readonly string[] = ['dot', 'we', 'off'] satisfies readonly FanslyInboxMark[];
const INBOX_MARK_TIMEOUT_MS = 10_000;

/**
 * The mark of a chat waiting for a reply in Fansly's own list of chats (2026-10-29): the choice `settings.ext` holds,
 * asked once, then every change of it the background says to all Fansly tabs. A Fansly type over the shared port, its
 * answer checked by hand. Until the answer the list stays Fansly's own.
 */
export function startFanslyInboxMark(env: Pick<SiteAppEnv<FanslyPort>, 'rpc' | 'host' | 'life'>): () => void {
  const take = (payload: unknown): void => {
    const mark = (payload as { readonly mark?: unknown } | null)?.mark;
    if (!env.life.aborted && typeof mark === 'string' && INBOX_MARKS.includes(mark)) env.host.fansly.setInboxMark(mark as FanslyInboxMark);
  };
  const off = (env.rpc.onEvent as unknown as (type: string, listener: (payload: unknown) => void) => () => void)('fansly.inbox.markChanged', take);
  const port = env.rpc as unknown as { request(type: string, payload: unknown, options?: { readonly timeoutMs?: number }): Promise<{ readonly ok: boolean; readonly payload?: unknown }> };
  void port.request('fansly.inbox.mark', {}, { timeoutMs: INBOX_MARK_TIMEOUT_MS }).then((answer) => answer.ok && take(answer.payload), () => undefined);
  return off;
}

/** The vault's page (host-fansly isolated/vault `isVaultPath`: its module is the vault's chunk, not this one). */
const onVault = (path: string): boolean => path === '/creator/vault' || path === '/creator/vault/';

/**
 * Fansly's own surfaces (R20 P11a/P11b/P13b): registration and «Заметки» first on /messages, then kept for their caches and drafts; the vault's chunk the first time the tab is on `/creator/vault` (FS-PERF-3), kept
 * from then on — it says itself where its entry stands. A chunk that did not load is asked again on the next visit.
 */
export function startFanslySurfaces(env: SiteAppEnv<FanslyPort>): () => void {
  let offOps: () => void = () => undefined;
  if (__CG_TEST_HOSTS__ && env.probe !== null) void import('./ops-probe').then((probe) => { if (!env.life.aborted) offOps = probe.startFanslyOpsProbe(env); }, () => undefined);
  let registration: Promise<(() => void) | null> | null = null;
  let notes: Promise<(() => void) | null> | null = null;
  let vault: Promise<(() => void) | null> | null = null;
  const sync = (): void => {
    if (env.life.aborted) return;
    if (registration === null && /^\/messages(?:\/[1-9]\d*)?$/.test(env.win.location.pathname)) {
      // The header's chunk: «Регистрация» and, after it, the fan's warning marks.
      registration = env.lazy<typeof RegistrationChunk>('registration').then((chunk) => {
        if (env.life.aborted) return null;
        const stops = [chunk.startFanslyRegistration(env), chunk.startFanslyFanMarks(env)];
        return () => { for (const stop of stops) stop(); };
      }, () => {
        registration = null;
        env.report({ kind: 'render', surface: 'header-slot' as MountSurfaceKind, code: 'CG-UI-FAILED', name: 'RegistrationChunk' });
        return null;
      });
    }
    if (notes === null && /^\/messages(?:\/[1-9]\d*)?$/.test(env.win.location.pathname)) {
      notes = env.lazy<typeof NotesChunk>('notes').then((chunk) => (env.life.aborted ? null : chunk.startFanslyNotes(env)), () => {
        notes = null;
        env.report({ kind: 'render', surface: 'notes' as MountSurfaceKind, code: 'CG-UI-FAILED', name: 'NotesChunk' });
        return null;
      });
    }
    if (vault !== null || !onVault(env.win.location.pathname)) return;
    vault = env.lazy<typeof VaultChunk>('vault').then(
      (chunk) => (env.life.aborted ? null : chunk.startFanslyVault(env)),
      (error: unknown) => {
        vault = null;
        env.report({ kind: 'render', surface: 'vault' as MountSurfaceKind, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
        return null;
      },
    );
  };
  const off = env.host.subscribe((event) => {
    if (event.type === 'route') sync();
  });
  sync();
  // X46: the floating launcher's click opens its window as the popup's command does (`Navigate` to the surface): the
  // click kept while the application loaded at once, every next one in its own click — the gate sees it through our root.
  // A refusal speaks for itself where the router says it (a toast, the window's own state), as for the popup's command.
  const offLauncher = env.host.launcher.serve((surface) => {
    void env.deps.client.dispatch({ type: 'Navigate', to: { kind: 'surface', surface, open: true } }).catch(() => undefined);
  });
  // The buttons wear the scheme of our surfaces, so they stay the dock's chips under «Тема» (2026-10-20).
  const offScheme = env.host.launcher.follow(env.deps.scheme);
  const offInboxMark = startFanslyInboxMark(env);
  return () => {
    offInboxMark();
    offOps();
    offLauncher();
    offScheme();
    off();
    void registration?.then((stop) => stop?.());
    void notes?.then((stop) => stop?.());
    void vault?.then((stop) => stop?.());
  };
}

/**
 * The application's half of Fansly's adapter. Its AI policy takes each start's effective count from the shared
 * controller (FS-TAIL-1); settings are owned and refreshed by the tab environment alone.
 */
export function fanslyApp(): HostAppAdapter<FanslyPort, null> {
  return {
    liveConfigOf: () => null,
    configure: () => Promise.resolve(),
    features: FANSLY_FEATURE_SLICE,
    contract: FANSLY_CONTRACT,
    ui: (theme) => fanslyUi(theme),
    ai: (lazy, rpc) => lazy<typeof AiChunk>('ai-fansly').then((chunk) => chunk.startFanslyAi(rpc)),
    // «Онлайн»: Fansly's followers active lately, read by the background and told to the hub (its answer is not needed
    // here: the hub's list says the rest). A Fansly type over the shared port, unchecked on the way back by design.
    online: ({ rpc }) => ({
      async seen(pageId, hostAccountId) {
        const port = rpc as unknown as { request(type: string, payload: unknown, options?: { readonly timeoutMs?: number }): Promise<unknown> };
        await port.request('fansly.online.seen', { pageId, hostAccountId }, { timeoutMs: 30_000 }).catch(() => undefined);
      },
    }),
    start: (env) => startFanslySurfaces(env),
    registrationOf: (fanId, i18n) => {
      const at = fanslyRegistrationDate(fanId);
      return at === null ? undefined : { label: REGISTRATION_TEXTS[i18n.language].label, at };
    },
  };
}

export const FANSLY_APP: HostAppAdapter<FanslyPort, null> = fanslyApp();
