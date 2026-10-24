// The fan panel as a surface controller (architecture.md D-29, §10.2
// FanPanelVM; CS-017, CS-031…CS-037, DB-026): the fan of the OPEN chat —
// money by kind and the subscription to this page from the hub
// (`spenderDetail`, the target page's element only), the hub's profile of
// the fan as the bio (`fan.dossier`), the coverage of the hub archive of the
// thread (the first row of its feed — the hub's database only, so nothing is
// marked read), ChatSpace's own memory as decoration when it already holds
// it, and how old and how complete the data is. Each hub read fails on its
// own, as a named gap. Nothing is read from ChatSpace's network, and nothing
// is read at all while the panel is closed. Without an open chat it says
// «Выберите чат».
//
// Chat Memory week 2, «Память» (a hub with `fan-card-v1`): the hub's card of the person across pages — the pages and
// the team's alias on each, the accounts Hub suggests are the same person with «Да» / «Нет», the facts from the chats
// with «Исправить» / «Удалить». Read only while that tab is shown; a decision or a change is one call, never repeated,
// and the card comes back with its answer.
//
// Chat Memory week 3, «Очередь» (./queue.ts): the page of the open tab — who waits, whom to win back, the handoff. It
// does not follow the open chat: a row opens a chat and the panel stays on the queue.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type HostEvent, type HostPort } from '@cg/contracts/host';
import { hasCapability, type Dossier, type FanCard, type SpenderDetail } from '@cg/contracts/hub';
import { HOST_PLATFORM } from '@cg/contracts/hosts';
import { CHAT_IS_FAN, chatKeyOf, type ChatRef } from '@cg/contracts/ids';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type ActionReceipt, type FanPanelVM, type I18n, type PartialGap, type UiAction, type VmView } from '@cg/contracts/vm';

import { memoryModel } from '../../domain/fanpanel/memory';
import { fanPanelModel } from '../../domain/fanpanel/model';
import { recapBlocks, recapHeadingText, recapText } from '../../domain/output/recap';
import { type SpenderRow } from '../../domain/spenders/rows';
import { coverageLevel } from '../../domain/spenders/stats';
import { type PageContextPort, flagFailure, pageFlag } from '../boards/context';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { createQueuePanel } from './queue';
import { dataView, errorOf, failureClass, failureView, loadingView, msg, stamp } from '../boards/views';

/** A card is read again after this long, or on «Повторить». */
export const FAN_CARD_FRESH_MS = 60_000;
/** Cards kept for chats the person goes back and forth between. */
const CARDS_KEPT = 20;

const SELECTOR = { of: 'fan-panel' } as const;
const CLOSE: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: false } };

interface Card {
  lifetime: SpenderDetail | null;
  last30: SpenderDetail | null;
  /** The lifetime read failed: the money block is unknown. */
  error: CgErrorWire | null;
  /** Only the 30-day read failed: «+$N за 30 дней» is unknown. */
  error30: CgErrorWire | null;
  /** The hub's profile of the fan; null — the hub has none (or it was not read yet). */
  dossier: Dossier | null;
  /** The profile read failed: whether the hub has a bio is unknown. */
  dossierError: CgErrorWire | null;
  /** The hub archive of the thread, by the first page of its feed; null — not read (the page has no archive feed), or the read failed. */
  archive: { readonly coverage: CoverageLevel } | null;
  archiveError: CgErrorWire | null;
  loading: boolean;
  since: number | null;
  loadedAt: number | null;
  run: number;
  /** Chat Memory week 2: «Память» — the hub's card of the person, read while that tab is shown. */
  memory: MemoryCard;
}

interface MemoryCard {
  card: FanCard | null;
  error: CgErrorWire | null;
  loading: boolean;
  since: number | null;
  loadedAt: number | null;
  run: number;
  /** Decisions and fact changes on their way (`link:<platform>:<fanRef>`, `fact:<id>`). */
  readonly busy: Set<string>;
  /** The last decision or change failed: said once, until the next one. */
  actionError: CgErrorWire | null;
}

export interface FanPanelControllerDeps {
  readonly registrationOf?: (fanId: string, i18n: I18n) => FanPanelVM['registration'];
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  /** The fan's row of the Spenders board, when one is loaded: its retention status and the number of archived messages. */
  readonly rowOf?: (pageId: number, fanRef: string) => SpenderRow | null;
  /** The board's rows changed (it loaded, or was dropped): the panel reads its row again. */
  readonly rowsChanged?: (listener: () => void) => () => void;
  /**
   * 1.20.0 (decision X47): the site shows a fan panel of its own next to the chat (ChatSpace 0.195: spend, subscription,
   * scores, lists, profile). Ours then shows only what that one lacks: the hub's money by kind, the churn risk, the
   * hub's profile of the fan, Recap.
   */
  readonly besideHostPanel?: boolean;
}

export type FanPanelController = SurfaceController<'fan-panel'>;

export function createFanPanelController(deps: FanPanelControllerDeps): FanPanelController {
  const { rpc, host, i18n, clock, context, surfaces } = deps;
  let tab: FanPanelVM['tab'] = 'fan';
  let cards = new Map<string, Card>();
  let epoch = context.current().epoch;
  let disposed = false;

  const cell = new ViewCell(build);
  const changed = (): void => {
    if (!disposed) cell.invalidate();
  };
  const queue = createQueuePanel({ rpc, clock, context, i18n, changed });
  /** «Очередь» is read and polled only while the panel shows it. */
  const followQueue = (): void => queue.setActive(surfaces.current().fanPanel && tab === 'queue');

  /** The open chat, when it belongs to the account the context is bound to. */
  function openChat(): ChatRef | null {
    const route = host.current().route;
    const binding = context.current().binding;
    if (route.name !== 'chat' || route.chat === null) return null;
    return binding === null || binding.hostAccountId === route.chat.hostAccountId ? route.chat : null;
  }

  /**
   * R20 F6b: the conversation of the open chat when the route names one that is not the fan (Fansly: the group); `{}`
   * on ChatSpace. null — the route names none on a platform where a chat has an id of its own (R20 P8a, FS-IDN-6): the
   * archive is not read by the fan's id in its place, and its state stays unknown.
   */
  function conversationOf(chat: ChatRef): { readonly conversationRef?: string } | null {
    const ref = host.current().route.conversationRef;
    if (ref === undefined) return CHAT_IS_FAN[HOST_PLATFORM[chat.host]] ? {} : null;
    return ref === chat.platformFanId ? {} : { conversationRef: ref };
  }

  const usable = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, 'fanPanel');
  };

  function cardOf(chat: ChatRef): Card {
    const key = chatKeyOf(chat);
    let card = cards.get(key);
    if (card === undefined) {
      card = {
        lifetime: null,
        last30: null,
        error: null,
        error30: null,
        dossier: null,
        dossierError: null,
        archive: null,
        archiveError: null,
        loading: false,
        since: null,
        loadedAt: null,
        run: 0,
        memory: { card: null, error: null, loading: false, since: null, loadedAt: null, run: 0, busy: new Set(), actionError: null },
      };
      cards.set(key, card);
      if (cards.size > CARDS_KEPT) {
        const oldest = cards.keys().next().value;
        if (oldest !== undefined && oldest !== key) cards.delete(oldest);
      }
    }
    return card;
  }

  async function load(chat: ChatRef): Promise<void> {
    const pageId = context.current().binding?.pageId ?? null;
    if (pageId === null || !usable()) return;
    const card = cardOf(chat);
    const run = ++card.run;
    const atEpoch = epoch;
    card.loading = true;
    card.since = clock.now();
    changed();
    const fanRef = chat.platformFanId;
    // The card and the dossier are the fan's; the archive is the conversation's (R20 F6b, architecture §11.1).
    const conversation = conversationOf(chat);
    // The archive feed is the preview's route on the hub (`archive-feed-v1`): without it the archive's state stays unknown, and says so.
    const archiveOn = pageFlag(context.current(), 'preview');
    const [lifetime, last30, dossier, feed] = await Promise.all([
      rpc.request('fan.card', { pageId, fanRef, period: 'lifetime' }),
      rpc.request('fan.card', { pageId, fanRef, period: '30d' }),
      rpc.request('fan.dossier', { pageId, fanRef }),
      // One row is enough: the page carries the archive's coverage. It is the hub's database only — the chat is not read on OnlyFans.
      archiveOn && conversation !== null ? rpc.request('feed.read', { pageId, fanRef, cursor: null, limit: 1, ...conversation }) : Promise.resolve(null),
    ]);
    if (disposed || atEpoch !== epoch || card.run !== run) return;
    card.loading = false;
    card.since = null;
    card.loadedAt = clock.now();
    card.lifetime = lifetime.ok ? lifetime.payload : card.lifetime;
    card.error = lifetime.ok ? null : lifetime.error;
    card.last30 = last30.ok ? last30.payload : card.last30;
    card.error30 = last30.ok ? null : last30.error;
    card.dossier = dossier.ok ? dossier.payload.dossier : card.dossier;
    card.dossierError = dossier.ok ? null : dossier.error;
    if (feed === null) {
      card.archive = null;
      card.archiveError = null;
    } else {
      card.archive = feed.ok ? { coverage: coverageLevel(feed.payload.coverage) } : card.archive;
      card.archiveError = feed.ok ? null : feed.error;
    }
    changed();
  }

  /** Chat Memory week 2: the hub serves the fan's card (`fan-card-v1`). */
  const memoryServed = (): boolean => {
    const bootstrap = context.current().bootstrap;
    return bootstrap !== null && hasCapability(bootstrap.capabilities, 'fan-card-v1');
  };

  async function loadMemory(chat: ChatRef): Promise<void> {
    const pageId = context.current().binding?.pageId ?? null;
    if (pageId === null || !usable() || !memoryServed()) return;
    const memory = cardOf(chat).memory;
    const run = ++memory.run;
    const atEpoch = epoch;
    memory.loading = true;
    memory.since = clock.now();
    changed();
    const answer = await rpc.request('fan.memory', { pageId, fanRef: chat.platformFanId });
    if (disposed || atEpoch !== epoch || memory.run !== run) return;
    memory.loading = false;
    memory.since = null;
    memory.loadedAt = clock.now();
    memory.card = answer.ok ? answer.payload : memory.card;
    memory.error = answer.ok ? null : answer.error;
    changed();
  }

  type MemoryAnswer = { readonly ok: true; readonly payload: { readonly card: FanCard } } | { readonly ok: false; readonly error: CgErrorWire };

  /** A «Да / Нет» or a fact change of the open chat's fan: one call, never repeated; the card comes back with the answer. */
  async function changeMemory(type: UiAction['type'], key: string, send: (pageId: number, fanRef: string) => Promise<MemoryAnswer>): Promise<ActionReceipt> {
    const chat = openChat();
    const pageId = context.current().binding?.pageId ?? null;
    if (chat === null || pageId === null || !memoryServed()) return done(type, 'noop');
    const memory = cardOf(chat).memory;
    if (memory.busy.has(key)) return done(type, 'noop');
    memory.busy.add(key);
    memory.actionError = null;
    changed();
    const atEpoch = epoch;
    const answer = await send(pageId, chat.platformFanId);
    memory.busy.delete(key);
    if (disposed || atEpoch !== epoch) return done(type, 'noop');
    if (answer.ok) {
      memory.card = answer.payload.card;
      memory.loadedAt = clock.now();
    } else memory.actionError = answer.error;
    changed();
    return answer.ok ? done(type) : refused(type, errorOf(answer.error, i18n));
  }

  /** Reads the open chat's card when the panel is open and has none, or an old one. */
  function ensure(): void {
    if (!surfaces.current().fanPanel || !usable()) return;
    const chat = openChat();
    if (chat === null) return;
    const card = cardOf(chat);
    const stale = card.loadedAt === null || clock.now() - card.loadedAt >= FAN_CARD_FRESH_MS;
    if (!card.loading && stale && card.error === null) void load(chat);
    // «Память» is read only while its tab is shown.
    const memory = card.memory;
    const memoryStale = memory.loadedAt === null || clock.now() - memory.loadedAt >= FAN_CARD_FRESH_MS;
    if (tab === 'memory' && memoryServed() && !memory.loading && memoryStale && memory.error === null) void loadMemory(chat);
  }

  /** The chat of a fact's page in this tab, to open (the chat, not the message: the hub has no read around a message). */
  function openOf(card: FanCard, pageLabel: string): UiAction | null {
    const ctx = context.current();
    if (ctx.page?.pageLabel === pageLabel) return null;
    const page = ctx.bootstrap?.pages.find((candidate) => candidate.pageLabel === pageLabel);
    const fanRef = card.pages.find((candidate) => candidate.pageLabel === pageLabel)?.fanRef;
    const account = page === undefined ? undefined : host.current().accounts.find((candidate) => candidate.platformAccountId === page.platformAccountId);
    if (account === undefined || fanRef === undefined) return null;
    return { type: 'Navigate', to: { kind: 'chat', targetHandle: `dock:${account.host}:${account.hostAccountId}:${fanRef}` } };
  }

  /** «Память» of the open chat's fan; absent — the hub does not serve the card. */
  function memoryView(memory: MemoryCard | null): FanPanelVM['memory'] {
    if (!memoryServed()) return undefined;
    const retry: UiAction = { type: 'ReloadView', selector: SELECTOR };
    const nothing = { accounts: [], pages: [], suggestions: [], facts: [] };
    const error = memory?.actionError === null || memory?.actionError === undefined ? null : errorOf(memory.actionError, i18n);
    if (memory === null || memory.card === null) {
      if (memory?.error !== null && memory?.error !== undefined) return { ...nothing, view: failureView(memory.error, i18n, retry), error: null };
      return { ...nothing, view: loadingView(memory?.since ?? null), error: null };
    }
    const card = memory.card;
    const model = memoryModel({ card, busy: memory.busy, openOf: (pageLabel) => openOf(card, pageLabel) });
    // A fan Hub holds nothing about yet: said once, not as three «не знаю».
    const view: VmView = !card.known ? { s: 'empty', why: msg('fanPanel.memory.nobody') } : memory.error !== null ? failureView(memory.error, i18n, retry, memory.loadedAt) : dataView(memory.loading ? [{ kind: 'stale-cache', asOf: new Date(memory.loadedAt ?? clock.now()).toISOString() }] : []);
    return { ...model, view, error };
  }

  function build(): FanPanelVM {
    const ctx = context.current();
    const chat = openChat();
    const queueView = queue.view();
    // «Память» without the hub's card is no tab, nor «Очередь» without the panel's page: the panel shows «Фан».
    const shown = (tab === 'memory' && !memoryServed()) || (tab === 'queue' && queueView === undefined) ? 'fan' : tab;
    const base = { tab: shown, personaLabel: ctx.persona?.label ?? null, close: CLOSE, ...(queueView === undefined ? {} : { queue: queueView }) };
    const nothing = { fan: null, spent: null, subscription: null, host: null, bio: null, lists: [], footer: { stamp: stamp(null, 'unknown'), archiveMessages: null } } as const;
    const retry: UiAction = { type: 'ReloadView', selector: SELECTOR };

    const blocker = ctx.phase === 'blocked' ? (ctx.blocker ?? { code: 'CG-UNKNOWN' as const }) : null;
    // A read of the page identity that merely failed keeps the identity (SP-042): the panel says «нет связи» over the fan
    // it last showed. Any other block — no sign-in, no binding, no right — shows nobody.
    const offlineOver = blocker !== null && ctx.binding !== null && chat !== null && failureClass(blocker.code) === 'offline';
    if (blocker !== null && !offlineOver) return { ...base, ...nothing, view: failureView(blocker, i18n, retry) };
    if (ctx.phase === 'ready' && !pageFlag(ctx, 'fanPanel')) return { ...base, ...nothing, view: failureView(flagFailure(ctx, 'fanPanel'), i18n, retry) };
    // CS-038: no chat is open — nothing to show, and nothing is guessed.
    if (chat === null) return { ...base, ...nothing, view: { s: 'empty', why: msg('fanPanel.empty.title') } };

    const pageId = ctx.binding?.pageId ?? null;
    const card = cards.get(chatKeyOf(chat)) ?? null;
    const row = pageId === null ? null : (deps.rowOf?.(pageId, chat.platformFanId) ?? null);
    const hostFan = host.fan(chat);
    const model = fanPanelModel({
      fanRef: chat.platformFanId,
      pageId: pageId ?? 0,
      lifetime: card?.lifetime ?? null,
      last30: card?.last30 ?? null,
      hostFan,
      dossier: card?.dossier ?? null,
      archive: card?.archive ?? null,
      row: row === null ? null : { retention: row.retention, storedMessages: row.storedMessages, history: row.history },
      now: clock.now(),
    });

    let view: VmView;
    if (blocker !== null) view = failureView(blocker, i18n, retry, card?.loadedAt ?? null);
    else if (ctx.phase === 'loading' || card === null || (card.loadedAt === null && card.error === null)) view = loadingView(card?.since ?? null);
    else {
      const gaps: PartialGap[] = [];
      const fanCapability = host.current().contract.capabilities.fan.state;
      if (hostFan === null && fanCapability !== 'on') gaps.push({ kind: 'host-degraded', capabilities: ['fan'] });
      if (card.error30 !== null && card.error === null) gaps.push({ kind: 'source-failed', source: 'fan.card.30d', code: card.error30.code });
      // CS-035: whether the hub has a profile of the fan is unknown — the bio shown (if any) is ChatSpace's stand-in.
      if (card.dossierError !== null) gaps.push({ kind: 'source-failed', source: 'fan.dossier', code: card.dossierError.code });
      if (card.archiveError !== null) gaps.push({ kind: 'source-failed', source: 'feed', code: card.archiveError.code });
      // DB-026: an archive that is not whole, or whose state nobody told, is said — the panel is never «ready» over an unknown archive.
      if (model.coverage !== 'complete') gaps.push({ kind: 'coverage', level: model.coverage });
      if (card.loading) gaps.push({ kind: 'stale-cache', asOf: model.asOf });
      if (card.error !== null) {
        // The hub's money is unknown; who the fan is still shows from ChatSpace's memory.
        view = failureClass(card.error.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'fan.card', code: card.error.code }]) : failureView(card.error, i18n, retry, card.loadedAt);
      } else view = dataView(gaps);
    }

    const registration = pageFlag(ctx, 'registration') ? deps.registrationOf?.(chat.platformFanId, i18n) : undefined;
    const memory = memoryView(card?.memory ?? null);
    // Beside the site's own panel (X47) ChatSpace's own data is its panel's: no scores, lists or «О себе» of it here.
    const lean = deps.besideHostPanel === true;
    const bioSource = lean && model.bioSource === 'host' ? null : model.bioSource;
    const bio = bioSource === null ? null : model.bio;
    const blocks = bioSource === 'hub' && bio !== null ? dossierBlocks(bio) : null;
    return {
      ...base,
      view,
      fan: { name: model.name, username: model.username, initials: model.initials, lastSeenAt: model.lastSeenAt, online: model.online },
      ...(registration === undefined ? {} : { registration }),
      spent: model.spent,
      subscription: model.subscription,
      host: lean ? null : model.host,
      bio,
      ...(bioSource === null ? {} : { bioSource }),
      ...(blocks === null ? {} : { bioBlocks: blocks }),
      ...(lean ? { besideHostPanel: true as const } : {}),
      ...(memory === undefined ? {} : { memory }),
      lists: lean ? [] : model.lists,
      footer: { stamp: stamp(model.asOf, model.coverage), archiveMessages: model.archiveMessages },
    };
  }

  /** The hub's profile in its headed blocks, its sections named in the reader's language (X47); null — one text. */
  let dossierMemo: { readonly bio: string; readonly language: string; readonly blocks: NonNullable<FanPanelVM['bioBlocks']> | null } | null = null;
  function dossierBlocks(bio: string): NonNullable<FanPanelVM['bioBlocks']> | null {
    if (dossierMemo !== null && dossierMemo.bio === bio && dossierMemo.language === i18n.language) return dossierMemo.blocks;
    const cut = recapBlocks(recapText(bio));
    const blocks = cut === null ? null : cut.map((block) => ({ heading: block.heading === '' ? '' : recapHeadingText(block.heading, (key) => i18n.t(key)), markdown: block.markdown }));
    dossierMemo = { bio, language: i18n.language, blocks };
    return blocks;
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind !== 'surface' || to.surface !== 'fan-panel') return null;
      surfaces.setFanPanel(to.open);
      return Promise.resolve(done(action.type, to.open ? 'opened' : 'done'));
    }
    if (action.type === 'SetFanPanelTab') {
      if (tab !== action.tab) {
        tab = action.tab;
        changed();
        ensure();
        followQueue();
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'SetQueueTab' || action.type === 'PickWinBack') return queue.dispatch(action);
    // Chat Memory week 2: «Да, это он» / «Нет» on a suggested account; «Удалить» / «Исправить» of a fact.
    if (action.type === 'DecideFanLink') {
      const { otherPlatform, otherFanRef, decision } = action;
      return changeMemory(action.type, `link:${otherPlatform}:${otherFanRef}`, (pageId, fanRef) => rpc.request('fan.memory.link', { pageId, fanRef, otherPlatform, otherFanRef, decision }));
    }
    if (action.type === 'ChangeFanFact') {
      const { factId } = action;
      const text = action.text?.trim() ?? '';
      if (action.action === 'correct' && text === '') return Promise.resolve(done(action.type, 'noop'));
      return changeMemory(action.type, `fact:${String(factId)}`, (pageId, fanRef) =>
        rpc.request('fan.memory.fact', action.action === 'delete' ? { pageId, fanRef, factId, action: 'delete' } : { pageId, fanRef, factId, action: 'correct', text }),
      );
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'fan-panel') return null;
      if (tab === 'queue') {
        queue.reload();
        return Promise.resolve(done(action.type));
      }
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(async () => {
        const chat = openChat();
        if (chat !== null) await Promise.all([load(chat), tab === 'memory' ? loadMemory(chat) : Promise.resolve()]);
        return done(action.type);
      });
    }
    return null;
  }

  const offs = [
    context.subscribe((state) => {
      if (state.epoch !== epoch) {
        epoch = state.epoch;
        cards = new Map();
        queue.reset();
      }
      changed();
      ensure();
      followQueue();
    }),
    surfaces.subscribe((state, previous) => {
      if (state.fanPanel === previous.fanPanel) return;
      changed();
      ensure();
      followQueue();
    }),
    host.subscribe((event: HostEvent) => {
      // The open chat changed, or ChatSpace loaded something about the fan: the panel follows.
      if (event.type !== 'route' && event.type !== 'chatCache' && event.type !== 'accounts') return;
      changed();
      if (event.type === 'route') ensure();
    }),
    i18n.subscribe(changed),
    deps.rowsChanged?.(changed) ?? ((): void => undefined),
  ];

  return {
    kinds: ['fan-panel'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    dispose() {
      disposed = true;
      queue.dispose();
      for (const off of offs) off();
      cell.clear();
    },
  };
}
