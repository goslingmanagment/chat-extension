// The fan panel as a surface controller (architecture.md D-29, §10.2
// FanPanelVM; CS-017, CS-031…CS-037, DB-026): the fan of the OPEN chat —
// money by kind and the subscription to this page from the hub
// (`spenderDetail`, the target page's element only), ChatSpace's own memory
// as decoration when it already holds it, and how old and how complete the
// data is. Nothing is read from ChatSpace's network, and nothing is read at
// all while the panel is closed. Without an open chat it says «Выберите чат».

import { type CgErrorWire } from '@cg/contracts/errors';
import { type HostEvent, type HostPort } from '@cg/contracts/host';
import { type SpenderDetail } from '@cg/contracts/hub';
import { chatKeyOf, type ChatRef } from '@cg/contracts/ids';
import { type ActionReceipt, type FanPanelVM, type I18n, type PartialGap, type UiAction, type VmView } from '@cg/contracts/vm';

import { fanPanelModel } from '../../domain/fanpanel/model';
import { type SpenderRow } from '../../domain/spenders/rows';
import { type PageContextPort, flagReason, pageFlag } from '../boards/context';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type Surfaces } from '../boards/shared';
import { ViewCell, done, type SurfaceController } from '../boards/surface';
import { dataView, failureClass, failureView, loadingView, msg, stamp } from '../boards/views';

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
  loading: boolean;
  since: number | null;
  loadedAt: number | null;
  run: number;
}

export interface FanPanelControllerDeps {
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  /** The fan's row of the Spenders board, when one is loaded: its retention status and archive coverage. */
  readonly rowOf?: (pageId: number, fanRef: string) => SpenderRow | null;
  /** The board's rows changed (it loaded, or was dropped): the panel reads its row again. */
  readonly rowsChanged?: (listener: () => void) => () => void;
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

  /** The open chat, when it belongs to the account the context is bound to. */
  function openChat(): ChatRef | null {
    const route = host.current().route;
    const binding = context.current().binding;
    if (route.name !== 'chat' || route.chat === null) return null;
    return binding === null || binding.hostAccountId === route.chat.hostAccountId ? route.chat : null;
  }

  const usable = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, 'fanPanel');
  };

  function cardOf(chat: ChatRef): Card {
    const key = chatKeyOf(chat);
    let card = cards.get(key);
    if (card === undefined) {
      card = { lifetime: null, last30: null, error: null, error30: null, loading: false, since: null, loadedAt: null, run: 0 };
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
    const [lifetime, last30] = await Promise.all([
      rpc.request('fan.card', { pageId, fanRef: chat.platformFanId, period: 'lifetime' }),
      rpc.request('fan.card', { pageId, fanRef: chat.platformFanId, period: '30d' }),
    ]);
    if (disposed || atEpoch !== epoch || card.run !== run) return;
    card.loading = false;
    card.since = null;
    card.loadedAt = clock.now();
    card.lifetime = lifetime.ok ? lifetime.payload : card.lifetime;
    card.error = lifetime.ok ? null : lifetime.error;
    card.last30 = last30.ok ? last30.payload : card.last30;
    card.error30 = last30.ok ? null : last30.error;
    changed();
  }

  /** Reads the open chat's card when the panel is open and has none, or an old one. */
  function ensure(): void {
    if (!surfaces.current().fanPanel || !usable()) return;
    const chat = openChat();
    if (chat === null) return;
    const card = cardOf(chat);
    const stale = card.loadedAt === null || clock.now() - card.loadedAt >= FAN_CARD_FRESH_MS;
    if (!card.loading && stale && card.error === null) void load(chat);
  }

  function build(): FanPanelVM {
    const ctx = context.current();
    const chat = openChat();
    const base = { tab, personaLabel: ctx.persona?.label ?? null, close: CLOSE };
    const nothing = { fan: null, spent: null, subscription: null, host: null, bio: null, lists: [], footer: { stamp: stamp(null, 'unknown'), archiveMessages: null } } as const;
    const retry: UiAction = { type: 'ReloadView', selector: SELECTOR };

    if (ctx.phase === 'blocked') return { ...base, ...nothing, view: failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, retry) };
    if (ctx.phase === 'ready' && !pageFlag(ctx, 'fanPanel')) {
      const why = flagReason(ctx, 'fanPanel');
      return { ...base, ...nothing, view: failureView(why === null ? { code: 'CG-FEATURE-DISABLED' } : { code: 'CG-FEATURE-DISABLED', detail: why }, i18n, retry) };
    }
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
      row: row === null ? null : { retention: row.retention, storedMessages: row.storedMessages, history: row.history },
      now: clock.now(),
    });

    let view: VmView;
    if (ctx.phase === 'loading' || card === null || (card.loadedAt === null && card.error === null)) view = loadingView(card?.since ?? null);
    else {
      const gaps: PartialGap[] = [];
      const fanCapability = host.current().contract.capabilities.fan.state;
      if (hostFan === null && fanCapability !== 'on') gaps.push({ kind: 'host-degraded', capabilities: ['fan'] });
      if (card.error30 !== null && card.error === null) gaps.push({ kind: 'source-failed', source: 'fan.card.30d', code: card.error30.code });
      if (row !== null && row.history !== 'complete') gaps.push({ kind: 'coverage', level: 'partial' });
      if (card.loading) gaps.push({ kind: 'stale-cache', asOf: model.asOf });
      if (card.error !== null) {
        // The hub's money is unknown; who the fan is still shows from ChatSpace's memory.
        view = failureClass(card.error.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'fan.card', code: card.error.code }]) : failureView(card.error, i18n, retry, card.loadedAt);
      } else view = dataView(gaps);
    }

    return {
      ...base,
      view,
      fan: { name: model.name, username: model.username, initials: model.initials, lastSeenAt: model.lastSeenAt, online: model.online },
      spent: model.spent,
      subscription: model.subscription,
      host: model.host,
      bio: model.bio,
      lists: model.lists,
      footer: { stamp: stamp(model.asOf, model.coverage), archiveMessages: model.archiveMessages },
    };
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
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'fan-panel') return null;
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(async () => {
        const chat = openChat();
        if (chat !== null) await load(chat);
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
      }
      changed();
      ensure();
    }),
    surfaces.subscribe((state, previous) => {
      if (state.fanPanel === previous.fanPanel) return;
      changed();
      ensure();
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
      for (const off of offs) off();
      cell.clear();
    },
  };
}
