// A background for the AI controller tests: the real operation scheduler
// (R10) with R11's feature drivers, real action tokens and the real dossier
// saver, over the scripted hub of these tests — behind a fake tab RPC that
// checks every request, response and event against the tab protocol's
// schemas, the way the real client does. Hub data the scheduler does not
// serve (shared recaps, the recap status, the feed head, the dossier link
// write) is scripted per test. Imports only @cg/contracts and @cg/core.

import {
  parseTabPayload,
  type Bootstrap,
  type CgErrorWire,
  type FeedPage,
  type HostAccount,
  type HubBinding,
  type HubFrame,
  type HubStreamRequest,
  type OpView,
  type PersonaCatalog,
  type RecapStatus,
  type ResolveHubError,
  type SessionIdentity,
  type SettingsPatch,
  type SettingsState,
  type SettingsV1,
  type SharedRecaps,
  type TabEventPayload,
  type TabEventType,
  type TabRequestPayload,
  type TabResponsePayload,
} from '@cg/contracts';
import { type RpcAnswer, type RpcConnection, type TabRequestName, type TabRpcPort } from '@cg/core/application/ai';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, OpScheduler, RecapProfileSaver } from '@cg/core/services';
import { applySettingsPatch } from '@cg/core/domain';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './clock';
import { FakeHub } from './fake-hub';
import { type AbortSignalLike } from '@cg/contracts/hub';
import { WORLD, session as worldSession, uuid } from './world';

export const TAB = uuid(0xa1);
export const OTHER_TAB = uuid(0xa2);

export const PERSONA_LABEL = 'Лора · VIP';

export const CATALOG: PersonaCatalog = {
  personas: [
    { key: WORLD.persona.key, displayName: PERSONA_LABEL, version: 3, definitionId: WORLD.persona.definitionId, status: 'active' },
    { key: 'other', displayName: 'Мира', version: 1, definitionId: WORLD.persona.otherDefinitionId, status: 'active' },
  ],
};

export function settingsWithPersona(over: Partial<SettingsV1> = {}): SettingsV1 {
  return {
    ...DEFAULT_SETTINGS,
    personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId } } },
    ...over,
  };
}

type Scripted<T> = T | { readonly error: CgErrorWire };
const isError = <T,>(value: Scripted<T>): value is { readonly error: CgErrorWire } => typeof value === 'object' && value !== null && 'error' in value;

export interface BackgroundOptions {
  readonly bootstrap: Bootstrap;
  readonly resolve: ResolveHubError;
  readonly clock?: FakeClock;
  readonly session?: SessionIdentity | null;
  readonly settings?: SettingsV1;
}

class ContractViolation extends Error {}

/**
 * The scripted hub, with every stream addressed to the operation that asked
 * for it: `meta.clientRequestId` is the request's, and each stream is its own
 * generation (`meta.requestId` = uuid(0x200 + n)), as on the real hub.
 */
export class AddressedHub extends FakeHub {
  private streamsPlayed = 0;

  override stream(request: HubStreamRequest, sink: (frame: HubFrame) => void, signal: AbortSignalLike): Promise<void> {
    const generation = uuid(0x200 + this.streamsPlayed);
    this.streamsPlayed += 1;
    return super.stream(
      request,
      (frame) => {
        if (frame.type === 'meta') sink({ ...frame, clientRequestId: request.body.clientRequestId, requestId: generation });
        else if (frame.type === 'context_v1') sink({ ...frame, generationRef: generation });
        else sink(frame);
      },
      signal,
    );
  }
}

export class FakeBackground {
  readonly clock: FakeClock;
  readonly hub: AddressedHub;
  readonly scheduler: OpScheduler;
  readonly tokens: ActionTokens;
  readonly saver: RecapProfileSaver;
  readonly log = new LogRecorder();
  /** Every request a tab made, in order. */
  readonly calls: { readonly tab: string; readonly type: string; readonly payload: unknown }[] = [];

  session: SessionIdentity | null;
  bootstrap: Scripted<Bootstrap>;
  catalog: Scripted<PersonaCatalog> = CATALOG;
  settings: SettingsState;
  bindingError: CgErrorWire | null = null;
  /** Hold the answers of these request types until `release()`: an RPC that is slow. */
  readonly held = new Set<string>();
  /** Handle these request types at once but hold their answers until `release()`: what the background emits meanwhile arrives first. */
  readonly slow = new Set<string>();
  private readonly waiting: (() => void)[] = [];

  sharedRecaps: Scripted<SharedRecaps> = { full: null, short: null, fullSavedToProfile: false };
  recapStatus: Scripted<RecapStatus> = { full: null, short: null };
  feed: Scripted<FeedPage> | null = null;
  /** What `op.list` answers instead of the scheduler's own list (a background that forgot its runs). */
  opList: { readonly ops: OpView[]; readonly truncated: boolean } | null = null;
  /** Failures of the next `op.list` requests, in order. */
  readonly opListErrors: CgErrorWire[] = [];
  /** Failures of the next `op.start` requests, in order: the background refused before any admission (its journal could not be written, its settings are not read). */
  readonly startErrors: CgErrorWire[] = [];
  /** Answers of `recap.save`, in order; an empty queue answers `saved`. */
  readonly saveAnswers: ({ readonly state: 'saved' | 'not-ready' | 'rejected'; readonly savedAt: string | null } | { readonly error: CgErrorWire })[] = [];

  private readonly ids;
  private readonly events = new EventLog();
  private readonly listeners = new Map<string, Map<string, Set<(payload: unknown) => void>>>();
  private readonly stateListeners = new Map<string, Set<(state: RpcConnection, tab: string | null) => void>>();
  private connection: RpcConnection = 'ready';
  private readonly openTabs = new Set<string>([TAB, OTHER_TAB]);

  constructor(options: BackgroundOptions) {
    this.clock = options.clock ?? new FakeClock(Date.parse('2026-10-03T10:00:00.000Z'));
    this.hub = new AddressedHub(this.clock);
    this.ids = sequentialIds(0x100);
    this.session = options.session === undefined ? worldSession : options.session;
    this.bootstrap = options.bootstrap;
    this.settings = { settings: options.settings ?? settingsWithPersona(), revision: 1, readOnly: false };
    this.tokens = new ActionTokens(this.clock, this.ids);
    const sink = {
      emit: <T extends TabEventType>(to: string | null, type: T, payload: TabEventPayload<T>): void => {
        this.events.emit(to, type, payload);
        this.deliver(to, type, payload);
      },
    };
    this.saver = new RecapProfileSaver({ clock: this.clock, ids: this.ids, hub: this.hub, events: sink, tabOpen: (tab) => this.openTabs.has(tab), log: this.log });
    this.scheduler = new OpScheduler({
      clock: this.clock,
      ids: this.ids,
      hub: this.hub,
      resolve: options.resolve,
      environment: () => this.environment(),
      tokens: this.tokens,
      events: sink,
      store: new MemoryStore(),
      presence: () => null,
      log: this.log,
      drivers: AI_FEATURE_DRIVERS,
      hooks: { recapDone: (view, ownerTab) => this.saver.save(view, ownerTab) },
    });
  }

  environment(): OpsEnvironment {
    const bootstrap = isError(this.bootstrap) ? null : this.bootstrap;
    return {
      session: this.session,
      bootstrap,
      persona: (pageId) => this.settings.settings.personas.byPageId[String(pageId)] ?? null,
      debug: this.settings.settings.debug.enabled,
      settingsLoaded: true,
    };
  }

  /** The id the next admitted operation gets. */
  get issuedIds(): readonly string[] {
    return this.ids.issued;
  }

  // ── what the background pushes ───────────────────────────────────────────

  emit<T extends TabEventType>(to: string | null, type: T, payload: TabEventPayload<T>): void {
    this.deliver(to, type, payload);
  }

  private deliver(to: string | null, type: string, payload: unknown): void {
    if (!parseTabPayload('evt', type, payload).ok) throw new ContractViolation(`event ${type} breaks its schema: ${JSON.stringify(payload)}`);
    // A port that is down carries nothing: what is emitted meanwhile is lost for the tabs.
    if (this.connection !== 'ready') return;
    for (const [tab, byType] of this.listeners) {
      if (to !== null && to !== tab) continue;
      for (const listener of [...(byType.get(type) ?? [])]) listener(payload);
    }
  }

  changeSettings(patch: SettingsPatch, restricted = true): void {
    const applied = applySettingsPatch(this.settings.settings, patch, { restricted });
    if (!applied.ok) throw new Error(`settings patch ${applied.reason}`);
    this.settings = { settings: applied.settings, revision: this.settings.revision + 1, readOnly: false };
    this.deliver(null, 'settings.changed', this.settings);
  }

  /** A sign-in change: the scheduler cancels what belonged to the old one, the tabs hear it. */
  changeSession(session: SessionIdentity | null, reason: TabEventPayload<'session.changed'>['reason']): void {
    this.session = session;
    this.scheduler.environmentChanged({ kind: 'session', next: session });
    this.deliver(null, 'session.changed', { session, reason });
  }

  changePersona(pageId: number, next: { key: string; definitionId: string } | null): void {
    this.scheduler.environmentChanged({ kind: 'persona', pageId, next });
    this.changeSettings({ personas: { byPageId: { [String(pageId)]: next } } });
  }

  setConnection(state: RpcConnection): void {
    this.connection = state;
    for (const [tab, listeners] of this.stateListeners) for (const listener of [...listeners]) listener(state, tab);
  }

  /** Lets the answers held by `held` go. */
  release(): void {
    for (const resume of this.waiting.splice(0)) resume();
  }

  // ── the tab client ───────────────────────────────────────────────────────

  rpc(tab: string = TAB): TabRpcPort {
    const byType = this.listeners.get(tab) ?? new Map<string, Set<(payload: unknown) => void>>();
    this.listeners.set(tab, byType);
    const states = this.stateListeners.get(tab) ?? new Set<(state: RpcConnection, tab: string | null) => void>();
    this.stateListeners.set(tab, states);
    return {
      request: async <T extends TabRequestName>(type: T, payload: TabRequestPayload<T>): Promise<RpcAnswer<TabResponsePayload<T>>> => {
        if (!parseTabPayload('req', type, payload).ok) throw new ContractViolation(`request ${type} breaks its schema: ${JSON.stringify(payload)}`);
        this.calls.push({ tab, type, payload });
        if (this.connection === 'reloaded') return { ok: false, error: { code: 'CG-RUNTIME-RELOADED' } };
        if (this.held.has(type)) await new Promise<void>((resume) => this.waiting.push(resume));
        const answer = (await this.answer(tab, type, payload)) as RpcAnswer<TabResponsePayload<T>>;
        if (this.slow.has(type)) await new Promise<void>((resume) => this.waiting.push(resume));
        if (answer.ok && !parseTabPayload('res', type, answer.payload).ok) throw new ContractViolation(`response of ${type} breaks its schema: ${JSON.stringify(answer.payload)}`);
        return answer;
      },
      onEvent: (type, listener) => {
        const set = byType.get(type) ?? new Set<(payload: unknown) => void>();
        byType.set(type, set);
        const wrapped = listener as (payload: unknown) => void;
        set.add(wrapped);
        return () => {
          set.delete(wrapped);
        };
      },
      onState: (listener) => {
        states.add(listener);
        return () => {
          states.delete(listener);
        };
      },
      state: () => this.connection,
      tabSessionId: () => tab,
    };
  }

  callsOf(type: string): unknown[] {
    return this.calls.filter((call) => call.type === type).map((call) => call.payload);
  }

  private bindingOf(account: HostAccount): RpcAnswer<{ binding: HubBinding }> {
    if (this.bindingError !== null) return { ok: false, error: this.bindingError };
    const bootstrap = isError(this.bootstrap) ? null : this.bootstrap;
    const session = this.session;
    if (bootstrap === null || session === null) return { ok: false, error: { code: 'CG-AUTH-REQUIRED' } };
    const page = bootstrap.pages.find((candidate) => candidate.platform === 'onlyfans' && candidate.platformAccountId !== null && candidate.platformAccountId === account.platformAccountId);
    if (page === undefined || page.platformAccountId === null) return { ok: false, error: { code: 'CG-BINDING-MISSING' } };
    return {
      ok: true,
      payload: {
        binding: {
          hubOrigin: session.hubOrigin,
          principalId: session.userId,
          loginEpoch: session.epoch,
          host: account.host,
          hostAccountId: account.hostAccountId,
          platform: 'onlyfans',
          platformAccountId: page.platformAccountId,
          pageId: page.pageId,
          pageLabel: page.pageLabel,
          bindingRevision: page.bindingRevision,
        },
      },
    };
  }

  private async answer(tab: string, type: string, payload: unknown): Promise<RpcAnswer<unknown>> {
    const ok = <P,>(value: P): RpcAnswer<P> => ({ ok: true, payload: value });
    const scripted = <P,>(value: Scripted<P>): RpcAnswer<P> => (isError(value) ? { ok: false, error: value.error } : ok(value));
    const request = payload as Record<string, unknown>;
    switch (type) {
      case 'session.get':
        return ok({ session: this.session });
      case 'settings.get':
        return ok(this.settings);
      case 'settings.patch': {
        const applied = applySettingsPatch(this.settings.settings, request['patch'] as SettingsPatch, { restricted: false });
        if (!applied.ok) return { ok: false, error: { code: 'CG-STORAGE-WRITE' } };
        this.settings = { settings: applied.settings, revision: this.settings.revision + 1, readOnly: false };
        this.deliver(null, 'settings.changed', this.settings);
        return ok(this.settings);
      }
      case 'bootstrap.get':
        return this.session === null ? { ok: false, error: { code: 'CG-AUTH-REQUIRED' } } : scripted(this.bootstrap);
      case 'catalog.get':
        return scripted(this.catalog);
      case 'binding.resolve':
        return this.bindingOf(request['account'] as HostAccount);
      case 'quota.get':
        return ok({ quota: this.scheduler.quota(request['pageId'] as number) });
      case 'token.issue': {
        const issued = this.tokens.issue(tab, request['kind'] as 'generate', request['surface'] as 'dock');
        return ok({ actionToken: issued.actionToken, expiresAt: issued.expiresAt });
      }
      case 'op.start': {
        const refusal = this.startErrors.shift();
        if (refusal !== undefined) return { ok: false, error: refusal };
        const outcome = await this.scheduler.start(tab, payload as TabRequestPayload<'op.start'>);
        return outcome.kind === 'admission' ? ok(outcome.admission) : { ok: false, error: { code: outcome.code } };
      }
      case 'op.cancel': {
        const state = this.scheduler.cancel(request['opId'] as string);
        return state === null ? { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } } : ok({ state });
      }
      case 'op.list': {
        const failure = this.opListErrors.shift();
        if (failure !== undefined) return { ok: false, error: failure };
        return ok(this.opList ?? this.scheduler.list(tab, request['scope'] as 'tab', request['chatKey'] as never));
      }
      case 'op.reportShown':
      case 'op.reportCopy':
      case 'op.reportInsert':
      case 'op.reportSent':
        return ok({ recorded: true });
      case 'recap.status':
        return scripted(this.recapStatus);
      case 'recap.read':
        return scripted(this.sharedRecaps);
      case 'recap.save': {
        const next = this.saveAnswers.shift() ?? { state: 'saved' as const, savedAt: new Date(this.clock.now()).toISOString() };
        return isError(next) ? { ok: false, error: next.error } : ok(next);
      }
      case 'feed.read':
        return this.feed === null ? { ok: false, error: { code: 'CG-HUB-CAPABILITY' } } : scripted(this.feed);
      default:
        throw new ContractViolation(`the AI controllers are not expected to send ${type}`);
    }
  }
}
