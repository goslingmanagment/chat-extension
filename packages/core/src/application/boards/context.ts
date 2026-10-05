// Whose page the boards show (architecture.md §8.3 «Привязка», SP-032,
// SP-042, NF-026): the hub sign-in, the bootstrap, the OnlyMonster account
// of the current route bound to exactly one hub page by its
// platformAccountId, the settings and the page's persona. Everything comes
// from the background over the tab protocol and from the host port; nothing
// is guessed by a name. `epoch` grows whenever the sign-in, the hub, the
// account or the binding changes: lists, feeds, leases and pending inserts
// of the previous identity are dropped on it. A read that merely failed (the
// background did not answer, the hub timed out) says nothing about who the
// person is: the identity it could not confirm stays, with the epoch, and
// the views say «нет связи» over what they last showed.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type HostEvent, type HostPort } from '@cg/contracts/host';
import { type Bootstrap, type BootstrapPage, type ClientFeatureFlag, type PersonaCatalog } from '@cg/contracts/hub';
import { type HostAccount, type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { type SettingsV1 } from '@cg/contracts/settings';

import { flagRefusal, flagStateOf, flagUsable, type FlagState } from '../../domain/ops/flags';
import { type TabRpc } from './ports';
import { failureClass } from './views';

export interface PagePersona {
  readonly key: string;
  readonly definitionId: string;
  /** The catalog's display name; null while the catalog is unknown. */
  readonly label: string | null;
}

export interface PageContextState {
  /** `loading` — the first reading has not finished; `blocked` — `blocker` says why nothing can be shown. */
  readonly phase: 'loading' | 'ready' | 'blocked';
  readonly blocker: CgErrorWire | null;
  readonly session: SessionIdentity | null;
  readonly bootstrap: Bootstrap | null;
  readonly account: HostAccount | null;
  readonly binding: HubBinding | null;
  readonly page: BootstrapPage | null;
  readonly settings: SettingsV1 | null;
  readonly persona: PagePersona | null;
  readonly epoch: number;
}

export interface PageContextPort {
  current(): PageContextState;
  subscribe(listener: (state: PageContextState) => void): () => void;
  /** Reads everything again (a human «Повторить», a reconnect). */
  refresh(): Promise<void>;
  dispose(): void;
}

const INITIAL: PageContextState = {
  phase: 'loading',
  blocker: null,
  session: null,
  bootstrap: null,
  account: null,
  binding: null,
  page: null,
  settings: null,
  persona: null,
  epoch: 0,
};

/** The account the boards belong to: the route's own, else the one the host identity names. */
export function currentAccount(host: HostPort): HostAccount | null {
  const snapshot = host.current();
  if (snapshot.route.account !== null) return snapshot.route.account;
  const id = snapshot.identity?.hostAccountId;
  if (id === undefined) return null;
  return snapshot.accounts.find((account) => account.hostAccountId === id) ?? null;
}

/** Whether a flag is usable on the context's page: the PAGE's own feature and the hub capabilities it needs (domain/ops/flags.ts). */
export function pageFlag(state: PageContextState, flag: ClientFeatureFlag): boolean {
  return state.binding !== null && flagUsable(state.bootstrap, state.binding.pageId, flag);
}

/** The same with the reason (the hub's own token: `disabled`, `flag_off`, `hub_not_ready`…); no bound page — `not_granted`. */
export function pageFlagOf(state: PageContextState, flag: ClientFeatureFlag): FlagState {
  return state.binding === null ? { usable: false, reason: 'not_granted' } : flagStateOf(state.bootstrap, state.binding.pageId, flag);
}

/** A switch that is off on the context's page as the error a board shows: the code its reason stands for, the reason in the technical line. */
export function flagFailure(state: PageContextState, flag: ClientFeatureFlag): CgErrorWire {
  return flagRefusal(pageFlagOf(state, flag));
}

function personaOf(settings: SettingsV1 | null, catalog: PersonaCatalog | null, session: SessionIdentity | null, pageId: number | null): PagePersona | null {
  if (settings === null || session === null || pageId === null) return null;
  const scope = settings.personas.scope;
  // Persona choices belong to one hub and one user: another scope is not this person's choice.
  if (scope !== null && (scope.hubOrigin !== session.hubOrigin || scope.userId !== session.userId)) return null;
  const choice = settings.personas.byPageId[String(pageId)];
  if (choice === undefined) return null;
  const entry = catalog?.personas.find((persona) => persona.key === choice.key && persona.definitionId === choice.definitionId);
  return { key: choice.key, definitionId: choice.definitionId, label: entry?.displayName ?? null };
}

const identityKey = (session: SessionIdentity | null, account: HostAccount | null, binding: HubBinding | null): string =>
  [session?.hubOrigin ?? '', session?.userId ?? '', session?.epoch ?? '', account?.hostAccountId ?? '', binding?.pageId ?? '', binding?.bindingRevision ?? ''].join('|');

const sameSession = (a: SessionIdentity, b: SessionIdentity): boolean => a.hubOrigin === b.hubOrigin && a.userId === b.userId && a.epoch === b.epoch;
const sameAccount = (a: HostAccount, b: HostAccount): boolean => a.hostAccountId === b.hostAccountId && a.platformAccountId === b.platformAccountId;

/** What a refresh had read before one of its reads failed. */
interface ReadSoFar {
  readonly session?: SessionIdentity;
  readonly bootstrap?: Bootstrap;
  readonly account?: HostAccount;
  readonly settings?: SettingsV1 | null;
}

export interface PageContextDeps {
  readonly rpc: TabRpc;
  readonly host: HostPort;
}

export function createPageContext(deps: PageContextDeps): PageContextPort {
  const { rpc, host } = deps;
  let state = INITIAL;
  let catalog: PersonaCatalog | null = null;
  let key = identityKey(null, null, null);
  let run = 0;
  let disposed = false;
  const listeners = new Set<(state: PageContextState) => void>();

  const set = (next: Omit<PageContextState, 'epoch'>): void => {
    if (disposed) return;
    const nextKey = identityKey(next.session, next.account, next.binding);
    const epoch = nextKey === key ? state.epoch : state.epoch + 1;
    key = nextKey;
    state = { ...next, epoch };
    for (const listener of [...listeners]) listener(state);
  };

  /**
   * A refresh stopped at `blocker`. A refusal that says something is not the
   * person's to see (no sign-in, no binding, no right — the `forbidden`
   * class) ends the identity. Any other failure is a read that did not
   * happen: when what was read so far still names the same sign-in and
   * account, the bound page stays as it was and the epoch does not move.
   */
  const blocked = (blocker: CgErrorWire, read: ReadSoFar = {}): void => {
    const settings = read.settings ?? state.settings;
    const { session, account, binding } = state;
    if (failureClass(blocker.code) !== 'forbidden' && session !== null && account !== null && binding !== null && sameSession(read.session ?? session, session) && sameAccount(read.account ?? account, account)) {
      const bootstrap = read.bootstrap ?? state.bootstrap;
      const page = bootstrap?.pages.find((p) => p.pageId === binding.pageId) ?? null;
      if (bootstrap !== null && page !== null) {
        set({ phase: 'blocked', blocker, session, bootstrap, account, binding, page, settings, persona: personaOf(settings, catalog, session, binding.pageId) });
        return;
      }
    }
    set({ ...INITIAL, ...read, phase: 'blocked', blocker, settings, persona: null });
  };

  const refresh = async (): Promise<void> => {
    const mine = ++run;
    const stale = (): boolean => disposed || mine !== run;
    const sessionRead = await rpc.request('session.get', {});
    if (stale()) return;
    if (!sessionRead.ok) return blocked(sessionRead.error);
    const session = sessionRead.payload.session;
    if (session === null) return blocked({ code: 'CG-AUTH-REQUIRED' });

    const [bootstrapRead, settingsRead, catalogRead] = await Promise.all([rpc.request('bootstrap.get', {}), rpc.request('settings.get', {}), rpc.request('catalog.get', {})]);
    if (stale()) return;
    const settings = settingsRead.ok ? settingsRead.payload.settings : state.settings;
    if (catalogRead.ok) catalog = catalogRead.payload;
    if (!bootstrapRead.ok) return blocked(bootstrapRead.error, { session, settings });
    const bootstrap = bootstrapRead.payload;

    const account = currentAccount(host);
    if (account === null) return blocked({ code: 'CG-HOST-NOT-READY' }, { session, bootstrap, settings });
    const bindingRead = await rpc.request('binding.resolve', { account });
    if (stale()) return;
    if (!bindingRead.ok) return blocked(bindingRead.error, { session, bootstrap, account, settings });
    const binding = bindingRead.payload.binding;
    const page = bootstrap.pages.find((p) => p.pageId === binding.pageId) ?? null;
    if (page === null) return blocked({ code: 'CG-BINDING-NOT-GRANTED' }, { session, bootstrap, account, settings });
    set({ phase: 'ready', blocker: null, session, bootstrap, account, binding, page, settings, persona: personaOf(settings, catalog, session, binding.pageId) });
  };

  const safeRefresh = (): void => {
    refresh().catch(() => undefined);
  };

  const onHost = (event: HostEvent): void => {
    if (event.type !== 'route' && event.type !== 'accounts') return;
    const account = currentAccount(host);
    if ((account?.hostAccountId ?? null) !== (state.account?.hostAccountId ?? null) || (account?.platformAccountId ?? null) !== (state.account?.platformAccountId ?? null)) safeRefresh();
  };

  const unsubscribe = [
    host.subscribe(onHost),
    rpc.onEvent('session.changed', safeRefresh),
    rpc.onEvent('bootstrap.changed', safeRefresh),
    rpc.onEvent('flags.changed', safeRefresh),
    rpc.onEvent('catalog.changed', safeRefresh),
    rpc.onEvent('settings.changed', (payload) => {
      if (state.phase !== 'ready') {
        state = { ...state, settings: payload.settings };
        return;
      }
      const { epoch: _epoch, ...rest } = state;
      set({ ...rest, settings: payload.settings, persona: personaOf(payload.settings, catalog, state.session, state.binding?.pageId ?? null) });
    }),
  ];

  safeRefresh();

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    dispose() {
      disposed = true;
      for (const off of unsubscribe) off();
      listeners.clear();
    },
  };
}
