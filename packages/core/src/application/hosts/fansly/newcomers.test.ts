// «Новые» on Fansly at the controller's level (R20 P10a; docs/project-unite/architecture.md §8.7, §8.17; FS-NEW-1):
// the shared pass controller (application/newcomers/pass.ts) over Fansly's source (./newcomers.ts) and a background
// module played here — every request the window sends and every answer it gets is held to Fansly's registry
// (tab-messages-fansly.ts), as the background holds them. The window, the list, the statuses, the filter, the search,
// the pages, the card, the conversation up to 750, «Открыть в Fansly ↗», the identity guard and a failed list that is
// never an empty one. Browser-level checks come with P10d (`suite-fansly-newcomers`).

import { describe, expect, it } from 'vitest';

import { type CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { type Bootstrap, type BootstrapPage } from '@cg/contracts/hub';
import { type HostAccount, type HubBinding } from '@cg/contracts/ids';
import {
  mayRequestFansly,
  parseFanslyTabPayload,
  type FanslyFollowerRow,
  type FanslyGreetingProof,
  type FanslyTabResponsePayload,
  type FanslyPassView,
  type FanslyPreviewMessage,
  type FanslyTabEventPayload,
  type FanslyTabRequestPayload,
} from '@cg/contracts/tab-messages-fansly';
import { NEWCOMER_CHECK_FILTERS, type NewcomersVM } from '@cg/contracts/vm';
import { NavigationIntentSchema, type HostEvent, type HostPort, type NavigationIntent, type NavigationReceipt } from '@cg/contracts/host';
import { StartOpSchema, type GreetingDraftGeneration, type OpView, type StaleReason, type StartOp } from '@cg/contracts/ops';
import { type FanslySendView } from '@cg/contracts/send-fansly';

import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';

import { createI18n } from '../../../domain/i18n';
import { checkOf, passRowOf } from '../../../domain/hosts/fansly/newcomers';
import { inPassTab, matchesPassSearch, passesCheckFilter } from '../../../domain/newcomers/pass';
import { Surfaces, type PageContextPort, type PageContextState, type TabRpc } from '../../boards';
import { GREETING_DRAFT_DEBOUNCE_MS } from '../../newcomers/greeting';
import { parsePassHandle, passHandle } from '../../newcomers/pass';
import { createPassNewcomersController } from '../../newcomers/pass';
import { createFanslyNewcomersSource, type FanslyFollowersAnswer, type FanslyFollowersPort, type FanslyFollowersRequest } from './newcomers';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const ISO_NOW = new Date(NOW).toISOString();
const CREATOR = '700000000000000017';
const OTHER_CREATOR = '700000000000000099';
const ORIGIN = 'https://fansly.com';
const PAGE_ID = 13;
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const fan = (n: number): string => String(800000000000000000n + BigInt(n));
const group = (n: number): string => String(900000000000000000n + BigInt(n));
const minutesAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString();

const account = (id: string): HostAccount => ({ host: 'fansly-web', hostAccountId: id, platform: 'fansly', platformAccountId: id, username: 'lora_vie', displayName: 'Lora' });
const bindingOf = (id: string): HubBinding => ({
  hubOrigin: 'https://hub.example.test',
  principalId: 7,
  loginEpoch: 3,
  host: 'fansly-web',
  hostAccountId: id,
  platform: 'fansly',
  platformAccountId: id,
  pageId: PAGE_ID,
  pageLabel: 'lora-fansly',
  bindingRevision: 1,
});

/** The pilot's bootstrap with the Fansly page whose owner switched «Новые» on. */
function bootstrapWith(newcomers: boolean): Bootstrap {
  const one = BOOTSTRAP_PILOT_PAGES.pages[0] as BootstrapPage;
  const page: BootstrapPage = { ...one, pageId: PAGE_ID, platform: 'fansly', features: { ...one.features, newcomers: newcomers ? { available: true } : { available: false, reason: 'flag_off' } } };
  return { ...BOOTSTRAP_PILOT_PAGES, pages: [...BOOTSTRAP_PILOT_PAGES.pages.filter((p) => p.pageId !== PAGE_ID), page] };
}

function readyState(id = CREATOR, epoch = 1, newcomers = true): PageContextState {
  const bootstrap = bootstrapWith(newcomers);
  return {
    phase: 'ready',
    blocker: null,
    session: { hubOrigin: 'https://hub.example.test', userId: 7, login: 'chatter1', role: 'chatter', epoch: 3 },
    bootstrap,
    account: account(id),
    binding: bindingOf(id),
    page: bootstrap.pages.find((page) => page.pageId === PAGE_ID) ?? null,
    settings: null,
    persona: null,
    epoch,
  };
}

function fakeContext(initial: PageContextState): PageContextPort & { set(next: PageContextState): void } {
  let state = initial;
  const listeners = new Set<(state: PageContextState) => void>();
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: () => Promise.resolve(),
    dispose: () => listeners.clear(),
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

/** Timers that fire only when the test says so. */
function manualClock() {
  let t = NOW;
  let next = 1;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    setTimer(ms: number, fn: () => void): number {
      const id = next++;
      timers.push({ id, at: t + ms, fn });
      return id;
    },
    clearTimer(handle: number) {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    async advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((item) => item.at <= t)) {
        timers = timers.filter((item) => item.id !== timer.id);
        timer.fn();
      }
      await settle();
    },
  };
}

/** Lets every chain of promises settle: the fakes answer at once, so microtasks are all there is to wait for. */
async function settle(turns = 40): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

const wireRow = (n: number, patch: Partial<FanslyFollowerRow> = {}): FanslyFollowerRow => ({
  fanRef: fan(n),
  groupId: group(n),
  username: `fan_${n}`,
  displayName: `Fan ${n}`,
  followedAt: minutesAgo(n + 1),
  status: 'ready',
  dmClosed: null,
  historyRevision: uuid(0x500 + n),
  checkedAt: minutesAgo(1),
  ...patch,
});

const message = (n: number, patch: Partial<FanslyPreviewMessage> = {}): FanslyPreviewMessage => ({
  messageId: String(600000000000000000n + BigInt(n)),
  fromFan: n % 2 === 0,
  at: minutesAgo(10_000 - n),
  text: `message ${n}`,
  automated: false,
  attachments: 0,
  ...patch,
});

interface PassRecord {
  view: FanslyPassView;
  rows: FanslyFollowerRow[];
  seq: number;
  /** Messages of each fan, oldest first. */
  history: Map<string, FanslyPreviewMessage[]>;
}

/**
 * Fansly's background module as the window meets it: its passes, its answers held to Fansly's registry, the
 * requests the window sent (each held to the registry and to its sender rules — a tab of fansly.com, NF-027).
 */
class FakeFollowers implements FanslyFollowersPort {
  readonly requests: { readonly type: FanslyFollowersRequest; readonly payload: unknown }[] = [];
  readonly passes = new Map<string, PassRecord>();
  /** An answer to give instead of the module's own, once per type. */
  readonly next = new Map<FanslyFollowersRequest, FanslyFollowersAnswer<FanslyFollowersRequest>>();
  /** Requests of these types wait until `release`. */
  readonly held = new Set<FanslyFollowersRequest>();
  private waiting: (() => void)[] = [];
  private listeners = new Set<(change: FanslyTabEventPayload<'fansly.followers.changed'>) => void>();
  private reconnects = new Set<() => void>();
  private nextPass = 0x301;
  rows: FanslyFollowerRow[] = [];
  state: FanslyPassView['state'] = 'queue';
  partial = false;
  // R20 P10c: the card's greeting as the module keeps it.
  readonly drafts = new Map<string, { text: string; revision: number; historyRevision: string | null; generation?: GreetingDraftGeneration }>();
  readonly attempts = new Map<string, FanslySendView>();
  generation: (opId: string) => Omit<GreetingDraftGeneration, 'historyRevision'> | null = () => null;
  readonly proofs = new Map<string, FanslyGreetingProof>();
  sendAnswer: (payload: FanslyTabRequestPayload<'fansly.followers.send'>) => FanslyTabResponsePayload<'fansly.followers.send'> = (payload) => ({
    ok: true,
    attempt: { attemptId: payload.attemptId, fanRef: payload.fanRef, state: 'sent', proof: 'echo', platformMessageId: '830000000000000001' },
  });

  async request<T extends FanslyFollowersRequest>(type: T, payload: FanslyTabRequestPayload<T>): Promise<FanslyFollowersAnswer<T>> {
    // NF-027: what the window asks fits Fansly's registry, and only a tab of fansly.com may ask it.
    expect(parseFanslyTabPayload('req', type, payload), type).toEqual({ ok: true, payload });
    expect(mayRequestFansly(type, 'tab', null, 'fansly-web')).toBe(true);
    this.requests.push({ type, payload });
    if (this.held.has(type)) await new Promise<void>((resolve) => this.waiting.push(resolve));
    const forced = this.next.get(type);
    if (forced !== undefined) {
      this.next.delete(type);
      return forced as FanslyFollowersAnswer<T>;
    }
    const answer = this.answer(type, payload);
    // The background checks its answer by the same registry on the way out.
    expect(parseFanslyTabPayload('res', type, answer), `${type} answer`).toEqual({ ok: true, payload: answer });
    return { ok: true, payload: answer } as FanslyFollowersAnswer<T>;
  }

  release(): void {
    this.held.clear();
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  private answer(type: FanslyFollowersRequest, payload: Record<string, unknown>): unknown {
    switch (type) {
      case 'fansly.followers.scan': {
        const passId = uuid(this.nextPass++);
        const view = this.viewOf(passId, payload['hostAccountId'] as string, payload['windowHours'] as number);
        this.passes.set(passId, { view, rows: [...this.rows], seq: 0, history: new Map() });
        return { ok: true, pass: view };
      }
      case 'fansly.followers.read': {
        const record = this.passes.get(payload['passId'] as string);
        if (record === undefined) return { pass: null, rows: [], total: 0 };
        const offset = payload['offset'] as number;
        const limit = payload['limit'] as number;
        const query = payload['query'] as FanslyTabRequestPayload<'fansly.followers.read'>['query'];
        if (query === undefined) return { pass: record.view, rows: record.rows.slice(offset, offset + limit), total: record.rows.length, seq: record.seq };
        const searched = record.rows.filter((row) => matchesPassSearch(passRowOf(row), query.search));
        const inTab = searched.filter((row) => inPassTab(checkOf(row), query.tab));
        const visible = inTab.filter((row) => passesCheckFilter(checkOf(row), query.filter));
        return {
          pass: record.view, rows: visible.slice(offset, offset + limit), total: visible.length, seq: record.seq,
          counts: {
            tabs: { todo: searched.filter((row) => inPassTab(checkOf(row), 'todo')).length, all: searched.length },
            filters: Object.fromEntries(NEWCOMER_CHECK_FILTERS.map((id) => [id, inTab.filter((row) => passesCheckFilter(checkOf(row), id)).length])),
          },
        };
      }
      case 'fansly.followers.history': {
        const record = this.passes.get(payload['passId'] as string);
        const all = record?.history.get(payload['fanRef'] as string) ?? [];
        const before = payload['before'] as string | null;
        const end = before === null ? all.length : all.findIndex((item) => item.messageId === before);
        const limit = payload['limit'] as number;
        const start = Math.max(0, end - limit);
        return { ok: true, messages: all.slice(start, end).reverse(), more: start > 0 };
      }
      case 'fansly.followers.close':
        return { recorded: true };
      // R20 P10b1: the queue's buttons.
      case 'fansly.followers.pause': {
        const record = this.passes.get(payload['passId'] as string);
        return { pass: record === undefined ? null : { ...record.view, state: 'paused' } };
      }
      case 'fansly.followers.resume': {
        const record = this.passes.get(payload['passId'] as string);
        return record === undefined ? { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } } : { ok: true, pass: { ...record.view, state: 'queue' } };
      }
      case 'fansly.followers.prioritize':
        return { recorded: this.rows.some((row) => row.fanRef === payload['fanRef'] && row.status === 'pending') };
      // R20 P10b2: only a fan nobody can write to.
      case 'fansly.followers.exclude':
        return { recorded: this.rows.some((row) => row.fanRef === payload['fanRef'] && (row.status === 'dm-closed' || row.status === 'excluded')) };
      // R20 P10c: the card's greeting.
      case 'fansly.followers.proof': {
        const proof = this.proofs.get(payload['fanRef'] as string);
        return proof === undefined ? { ok: false, error: { code: 'CG-FNEW-UNVERIFIED' } } : { ok: true, proof };
      }
      case 'fansly.followers.draft': {
        const fanRef = payload['fanRef'] as string;
        const now = this.drafts.get(fanRef) ?? { text: '', revision: 0, historyRevision: null };
        const attempt = this.attempts.get(fanRef);
        const status = attempt === undefined ? {} : { attempt };
        if (payload['text'] === undefined) return { ok: true, draft: { ...now, ...status } };
        const text = payload['text'] as string;
        const link = payload['generation'] as { opId: string; historyRevision: string } | undefined;
        const gen = link === undefined ? now.generation : this.generation(link.opId);
        const generation = gen === null || gen === undefined || text === '' ? undefined : { ...gen, historyRevision: link?.historyRevision ?? now.generation?.historyRevision ?? uuid(0x501) };
        const next = { text, revision: now.revision + 1, historyRevision: text === '' ? null : (this.rows.find((row) => row.fanRef === fanRef)?.historyRevision ?? null), ...(generation === undefined ? {} : { generation }) };
        this.drafts.set(fanRef, next);
        return { ok: true, draft: { ...next, ...status } };
      }
      case 'fansly.followers.send': {
        const answer = this.sendAnswer(payload as FanslyTabRequestPayload<'fansly.followers.send'>);
        if (answer.ok) this.attempts.set(answer.attempt.fanRef, answer.attempt);
        return answer;
      }
      case 'fansly.followers.sent':
        return { recorded: true };
    }
  }

  viewOf(passId: string, hostAccountId: string, windowHours: number): FanslyPassView {
    const checked = this.rows.filter((row) => row.status !== 'pending' && row.status !== 'checking').length;
    return {
      passId,
      hostAccountId,
      windowHours,
      state: this.state,
      startedAt: ISO_NOW,
      counts: { total: this.rows.length, checked, ready: 0, greeted: 0, dmClosed: 0, excluded: 0 },
      partial: this.partial,
      cooldownUntil: null,
      error: null,
    };
  }

  /** The background tells the window about rows of a pass that changed. */
  change(passId: string, rows: FanslyFollowerRow[], patch: Partial<FanslyPassView> = {}, seq?: number): void {
    const record = this.passes.get(passId);
    if (record === undefined) throw new Error('no such pass');
    for (const row of rows) {
      const at = record.rows.findIndex((item) => item.fanRef === row.fanRef);
      if (at >= 0) record.rows[at] = row;
      else record.rows.push(row);
    }
    record.seq = seq ?? record.seq + 1;
    record.view = { ...record.view, ...patch, counts: { ...record.view.counts, total: record.rows.length } };
    const payload = { pass: record.view, seq: record.seq, rows };
    expect(parseFanslyTabPayload('evt', 'fansly.followers.changed', payload).ok).toBe(true);
    for (const listener of [...this.listeners]) listener(payload);
  }

  onChanged(listener: (change: FanslyTabEventPayload<'fansly.followers.changed'>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onReconnect(listener: () => void): () => void {
    this.reconnects.add(listener);
    return () => this.reconnects.delete(listener);
  }

  reconnect(): void {
    for (const listener of [...this.reconnects]) listener();
  }

  of(type: FanslyFollowersRequest): unknown[] {
    return this.requests.filter((request) => request.type === type).map((request) => request.payload);
  }

  last(): PassRecord {
    const record = [...this.passes.values()].at(-1);
    if (record === undefined) throw new Error('no pass');
    return record;
  }
}

function world(rows: FanslyFollowerRow[], options: { readonly state?: PageContextState } = {}) {
  const background = new FakeFollowers();
  background.rows = rows;
  const context = fakeContext(options.state ?? readyState());
  const surfaces = new Surfaces();
  const clock = manualClock();
  const i18n = createI18n({ language: 'ru', now: () => NOW, timeZone: 'Europe/Moscow' });
  const controller = createPassNewcomersController({ source: createFanslyNewcomersSource(background, ORIGIN), i18n, clock, context, surfaces });
  const views: NewcomersVM[] = [];
  controller.subscribe({ of: 'newcomers' }, (view) => views.push(view));
  const vm = (): NewcomersVM => controller.getSnapshot({ of: 'newcomers' });
  const open = async (): Promise<void> => {
    await controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } });
    await settle();
  };
  return { background, context, surfaces, clock, controller, vm, views, open };
}

const statuses = (vm: NewcomersVM): string[] => vm.rows.map((row) => `${row.username}:${row.check?.status}`);

describe('[host:fansly] «Новые» on Fansly: the window over the background’s pass (R20 P10a)', () => {
  it('[NF-001] [NF-002] [NF-004] opening the window opens the pass of the tab’s creator for 48 hours and reads its first page; nothing is asked while it is closed', async () => {
    const w = world([wireRow(1), wireRow(2)]);
    await w.clock.advance(600_000);
    expect(w.background.requests).toEqual([]);
    expect(w.vm().pass?.stage).toBe('connecting');

    await w.open();
    expect(w.surfaces.current().newcomers).toBe(true);
    // The card opens on the first fan to write to, with the conversation the pass read.
    expect(w.background.requests.map((request) => request.type)).toEqual(['fansly.followers.scan', 'fansly.followers.read', 'fansly.followers.history']);
    expect(w.background.of('fansly.followers.scan')).toEqual([{ hostAccountId: CREATOR, windowHours: 48 }]);
    expect(w.background.of('fansly.followers.read')).toEqual([{ passId: uuid(0x301), offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'any' } }]);
    expect(w.vm().view.s).toBe('ready');
    expect(w.vm().rows.map((row) => row.username)).toEqual(['fan_1', 'fan_2']);
  });

  it('[NF-004] the window hears the rows that change — in place, the new ones at the end — and never polls; a gap in the changes reads the list again', async () => {
    const w = world([wireRow(1, { status: 'pending', historyRevision: null, checkedAt: null }), wireRow(2, { status: 'checking', historyRevision: null, checkedAt: null })]);
    await w.open();
    const passId = w.background.last().view.passId;
    expect(statuses(w.vm())).toEqual(['fan_1:pending', 'fan_2:checking']);

    w.background.change(passId, [wireRow(2, { status: 'greeted' })]);
    w.background.change(passId, [wireRow(3, { status: 'pending', historyRevision: null })]);
    await settle();
    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    expect(statuses(w.vm())).toEqual(['fan_1:pending', 'fan_2:greeted', 'fan_3:pending']);

    // A change of another pass is nobody's; an old one is dropped.
    w.background.change(passId, [wireRow(1, { status: 'checking' })], {}, 1);
    await settle();
    expect(w.vm().rows[0]?.check?.status).toBe('pending');

    // Ten minutes of nothing: no read at all (the old window asked for the whole snapshot every 700 ms).
    const before = w.background.requests.length;
    await w.clock.advance(600_000);
    expect(w.background.requests.length).toBe(before);

    // Changes 3 and 4 were lost (the port did not deliver them): change 5 is a gap — the rows on screen are read again.
    w.background.passes.get(passId)!.rows[0] = wireRow(1, { status: 'ready' });
    w.background.change(passId, [wireRow(2, { status: 'greeted' })], {}, 5);
    await settle();
    expect(w.background.of('fansly.followers.read').at(-1)).toEqual({ passId, offset: 0, limit: 100, query: { search: '', tab: 'all', filter: 'any' } });
    expect(statuses(w.vm())).toEqual(['fan_1:ready', 'fan_2:greeted', 'fan_3:pending']);

    // The port to the background came back: what is on screen is read again.
    const reads = w.background.of('fansly.followers.read').length;
    w.background.reconnect();
    await settle();
    expect(w.background.of('fansly.followers.read')).toHaveLength(reads + 1);
  });

  it('[NF-004] changes heard while the first page is on its way: only those after the page’s own change apply', async () => {
    const w = world([wireRow(1, { status: 'pending', historyRevision: null }), wireRow(2, { status: 'pending', historyRevision: null })]);
    w.background.held.add('fansly.followers.read');
    const opened = w.open();
    await settle();
    const passId = w.background.last().view.passId;
    // The page will hold change 1 (fan 1 checked); change 2 comes after it.
    w.background.change(passId, [wireRow(1, { status: 'ready' })]);
    w.background.change(passId, [wireRow(2, { status: 'dm-closed', dmClosed: 'paid' })]);
    // Before the first page the counts are unknown, never 0.
    expect([w.vm().tabs.map((tab) => tab.count), w.vm().pass?.filters[0]?.count]).toEqual([[null, null], null]);
    w.background.release();
    await opened;
    await settle();
    expect(statuses(w.vm())).toEqual(['fan_1:ready', 'fan_2:dm-closed']);
    expect(w.vm().tabs.map((tab) => tab.count)).toEqual([2, 2]);
  });

  it('[NF-003] the period: 1 hour to 30 days, 48 hours first; another period is another pass — the old one is let go', async () => {
    const w = world([wireRow(1)]);
    expect([w.vm().windowHours, w.vm().windowOptions]).toEqual([48, [1, 3, 6, 12, 24, 48, 72, 168, 336, 720]]);
    await w.open();
    const first = w.background.last().view.passId;
    expect(await w.controller.dispatch({ type: 'SetNewcomersWindow', hours: 48 })).toMatchObject({ ok: true, outcome: 'noop' });
    await w.controller.dispatch({ type: 'SetNewcomersWindow', hours: 720 });
    await settle();
    expect(w.background.of('fansly.followers.scan')).toEqual([
      { hostAccountId: CREATOR, windowHours: 48 },
      { hostAccountId: CREATOR, windowHours: 720 },
    ]);
    expect(w.background.of('fansly.followers.close')).toEqual([{ passId: first }]);
    expect(w.vm().windowHours).toBe(720);
    expect(w.vm().pass?.range).toEqual({ from: new Date(NOW - 720 * 3_600_000).toISOString(), to: ISO_NOW });
  });

  it('[NF-005] the statuses of the old window: queued, checking, not written to, waiting for a reply, not checked, written to, can’t be messaged, excluded, couldn’t check', async () => {
    const failure: CgAnyErrorWire = { code: 'CG-FAN-REQUEST', httpStatus: 500 };
    const w = world([
      wireRow(1, { status: 'pending', historyRevision: null, checkedAt: null }),
      wireRow(2, { status: 'checking', historyRevision: null, checkedAt: null }),
      wireRow(3),
      wireRow(4, { fanWrote: true }),
      wireRow(5, { historyRevision: null }),
      wireRow(6, { status: 'greeted' }),
      wireRow(7, { status: 'dm-closed', dmClosed: 'permissions' }),
      wireRow(8, { status: 'excluded', dmClosed: 'paid' }),
      wireRow(9, { status: 'failed', historyRevision: null, error: failure }),
    ]);
    await w.open();
    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    expect(statuses(w.vm())).toEqual(['fan_1:pending', 'fan_2:checking', 'fan_3:ready', 'fan_4:reply', 'fan_5:unverified', 'fan_6:greeted', 'fan_7:dm-closed', 'fan_8:excluded', 'fan_9:failed']);
    expect(w.vm().rows.find((row) => row.username === 'fan_7')?.check?.dmClosed).toBe('permissions');
    expect(w.vm().rows.find((row) => row.username === 'fan_6')?.greeting).toEqual({ s: 'greeted', at: null });
  });

  it('[NF-006] «К обработке / Все», status filters with counts, the search by name, @username, own name or id, pages of 100', async () => {
    const rows = [
      wireRow(1),
      wireRow(2, { fanWrote: true, displayName: 'Tomasz', customName: 'Томас из Варшавы' }),
      wireRow(3, { status: 'greeted' }),
      wireRow(4, { status: 'excluded', dmClosed: 'paid' }),
      wireRow(5, { status: 'pending', historyRevision: null }),
      wireRow(6, { status: 'dm-closed', dmClosed: 'paid' }),
      ...Array.from({ length: 244 }, (_, i) => wireRow(100 + i, { status: 'pending', historyRevision: null, username: `bulk_${i}`, displayName: `Bulk ${i}` })),
    ];
    const w = world(rows);
    await w.open();
    // Pages of 100 matches (NF-006): written-to and excluded fans are filtered before the background slices a page.
    expect([w.vm().rows.length, w.vm().canLoadMore]).toEqual([100, true]);
    await w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
    await w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
    expect(w.background.of('fansly.followers.read').map((payload) => (payload as { offset: number }).offset)).toEqual([0, 100, 200]);
    expect([w.vm().footer.count, w.vm().canLoadMore]).toEqual([250, false]);
    expect(await w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' })).toMatchObject({ outcome: 'noop' });

    // «К обработке»: neither written to nor excluded; «Все»: everyone.
    expect(w.vm().tabs.map((tab) => [tab.id, tab.count])).toEqual([
      ['todo', 248],
      ['all', 250],
    ]);
    const counts = (vm: NewcomersVM) => Object.fromEntries((vm.pass?.filters ?? []).map((filter) => [filter.id, filter.count]));
    expect(counts(w.vm())).toEqual({ any: 248, ready: 1, pending: 245, reply: 1, unchecked: 245, 'dm-closed': 1, contacted: 0 });
    expect(w.vm().pass?.filters.map((filter) => filter.id)).toEqual([...NEWCOMER_CHECK_FILTERS]);

    await w.controller.dispatch({ type: 'SetNewcomersCheckFilter', filter: 'dm-closed' });
    expect(statuses(w.vm())).toEqual(['fan_6:dm-closed']);
    // Closing the window keeps its filter: a later greeting must choose «Все статусы» to see ready fans.
    w.surfaces.setList('newcomers', false);
    await w.open();
    expect(w.vm().pass?.filters.find((filter) => filter.pressed)?.id).toBe('dm-closed');
    expect(statuses(w.vm())).toEqual(['fan_6:dm-closed']);
    await w.controller.dispatch({ type: 'SetNewcomersCheckFilter', filter: 'any' });
    expect(statuses(w.vm())).toContain('fan_1:ready');
    // «Уже писали» is never «К обработке»: choosing it shows «Все».
    await w.controller.dispatch({ type: 'SetNewcomersCheckFilter', filter: 'contacted' });
    expect([w.vm().tab, statuses(w.vm())]).toEqual(['all', ['fan_3:greeted']]);
    // Another tab starts from «Все статусы».
    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'todo' });
    expect(w.vm().pass?.filters.find((filter) => filter.pressed)?.id).toBe('any');

    for (const [query, expected] of [
      ['Tomasz', ['fan_2:reply']],
      ['@fan_1', ['fan_1:ready']],
      ['варшав', ['fan_2:reply']],
      [fan(6), ['fan_6:dm-closed']],
    ] as const) {
      await w.controller.dispatch({ type: 'Search', list: 'newcomers', query });
      expect(statuses(w.vm()).slice(0, 3), query).not.toEqual(expected);
      await w.clock.advance(150);
      expect(statuses(w.vm()), query).toEqual(expected);
    }
    await w.controller.dispatch({ type: 'ResetFilters', list: 'newcomers' });
    expect([w.vm().query, w.vm().rows.length]).toEqual(['', 100]);
  });

  it('[NF-006] search finds fan 150 of a 30-day pass before the second page is loaded, including after an empty search', async () => {
    const w = world(Array.from({ length: 150 }, (_, i) => wireRow(i + 1)));
    await w.open();
    await w.controller.dispatch({ type: 'SetNewcomersWindow', hours: 720 });
    expect(w.vm().rows).toHaveLength(100);
    for (const [query, count] of [['no such fan', 0], [fan(150), 1]] as const) {
      await w.controller.dispatch({ type: 'Search', list: 'newcomers', query });
      await w.clock.advance(150);
      expect(w.vm().rows).toHaveLength(count);
    }
    expect(w.vm().view.s).toBe('ready');
    expect(statuses(w.vm())).toEqual(['fan_150:ready']);
    expect(w.vm().tabs.map((tab) => tab.count)).toEqual([1, 1]);
    expect(w.background.of('fansly.followers.read').at(-1)).toMatchObject({ offset: 0, limit: 100, query: { search: fan(150), tab: 'todo', filter: 'any' } });
  });

  it('[NF-006] tabs and filter counts include 50 pending fans after the first 100 greeted fans, before scrolling', async () => {
    const w = world(Array.from({ length: 150 }, (_, i) => wireRow(i + 1, { status: i < 100 ? 'greeted' : 'pending', historyRevision: null })));
    await w.open();
    expect(w.vm().tabs.map((tab) => tab.count)).toEqual([50, 150]);
    expect(w.vm().pass?.filters.find((filter) => filter.id === 'pending')?.count).toBe(50);
    expect(w.vm().rows).toHaveLength(50);
    expect(w.vm().rows[0]?.username).toBe('fan_101');
    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    expect(w.vm().rows).toHaveLength(100);
    expect(w.vm().pass?.filters.find((filter) => filter.id === 'contacted')?.count).toBe(100);
    await w.controller.dispatch({ type: 'SetNewcomersCheckFilter', filter: 'pending' });
    expect(w.vm().rows).toHaveLength(50);
    expect(w.vm().canLoadMore).toBe(false);
    expect(w.vm().rows.at(-1)?.username).toBe('fan_150');
  });

  it('[NF-003] [NF-006] a new 200-row pass loads offset 100 after the previous pass already loaded it', async () => {
    const w = world(Array.from({ length: 200 }, (_, i) => wireRow(i + 1)));
    await w.open();
    await w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
    await w.controller.dispatch({ type: 'SetNewcomersWindow', hours: 720 });
    expect([w.vm().rows.length, w.vm().canLoadMore]).toEqual([100, true]);
    const passId = w.background.last().view.passId;
    await w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
    expect(w.background.of('fansly.followers.read').at(-1)).toMatchObject({ passId, offset: 100, limit: 100 });
    expect([w.vm().rows.length, w.vm().canLoadMore]).toEqual([200, false]);
  });

  it('[NF-004] [NF-006] an off-page change refreshes whole-pass counts and can populate an empty filter', async () => {
    const w = world(Array.from({ length: 150 }, (_, i) => wireRow(i + 1)));
    await w.open();
    const passId = w.background.last().view.passId;
    await w.controller.dispatch({ type: 'SetNewcomersCheckFilter', filter: 'pending' });
    expect(w.vm().view.s).toBe('empty');
    w.background.change(passId, [wireRow(150, { status: 'pending', historyRevision: null })]);
    await settle();
    expect(statuses(w.vm())).toEqual(['fan_150:pending']);
    expect(w.vm().pass?.filters.find((filter) => filter.id === 'pending')?.count).toBe(1);
    expect(w.vm().pass?.filters.find((filter) => filter.id === 'ready')?.count).toBe(149);
    expect(w.vm().tabs.map((tab) => tab.count)).toEqual([150, 150]);
  });

  it('[NF-006] a late second page of the old query cannot replace the search result or its counts', async () => {
    const w = world(Array.from({ length: 150 }, (_, i) => wireRow(i + 1)));
    await w.open();
    w.background.held.add('fansly.followers.read');
    const loading = w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
    await w.controller.dispatch({ type: 'Search', list: 'newcomers', query: fan(150) });
    await w.clock.advance(150);
    w.background.release();
    await loading;
    await settle();
    expect(statuses(w.vm())).toEqual(['fan_150:ready']);
    expect(w.vm().tabs.map((tab) => tab.count)).toEqual([1, 1]);
    expect(w.vm().canLoadMore).toBe(false);
  });

  it('[NF-007] [NF-008] [NF-009] a row and the header: the name, @username, when they followed; the creator, the stage, the dates; the card of the first fan to write to', async () => {
    const w = world([
      wireRow(1, { status: 'pending', historyRevision: null }),
      wireRow(2, { bio: 'NYC · gym', customName: 'Алекс', checkedAt: minutesAgo(3) }),
      wireRow(3),
    ]);
    w.background.state = 'scanning';
    await w.open();
    const vm = w.vm();
    expect(vm.rows[0]).toMatchObject({ name: 'Fan 1', username: 'fan_1', subscribedAt: minutesAgo(2), kind: 'new' });
    expect(vm.pass).toMatchObject({ creator: 'lora_vie', stage: 'scanning', checked: 2, total: 3, range: { from: new Date(NOW - 48 * 3_600_000).toISOString(), to: ISO_NOW } });
    w.background.change(w.background.last().view.passId, [], { phase: 'profiles' });
    await settle();
    expect(w.vm().pass?.phase).toBe('profiles');
    // The card is on the first fan a greeting may be written to (the old window's choice), not on the queued one.
    expect(w.vm().pass?.card).toMatchObject({ name: 'Fan 2', username: 'fan_2', customName: 'Алекс', bio: 'NYC · gym', followedAt: minutesAgo(3), checkedAt: minutesAgo(3), check: 'ready' });
    expect(w.vm().rows.map((row) => row.selected)).toEqual([false, true, false]);
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: w.vm().rows[2]?.handle ?? '' });
    expect(w.vm().pass?.card?.name).toBe('Fan 3');
  });

  it('[NF-009] a fan written to already: «Уже писали» with the personal message that proves it', async () => {
    const proof = message(41, { fromFan: false, text: 'hey, thanks for following ❤️' });
    const w = world([wireRow(1, { status: 'greeted', proof })]);
    await w.open();
    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    expect(w.vm().pass?.card).toMatchObject({ check: 'greeted', proof: { id: proof.messageId, fromFan: false, text: proof.text, automated: false } });
  });

  it('[NF-010] the conversation as the pass read it: 250 a read, oldest first, automation marked, earlier ones on request, never more than 750', async () => {
    const w = world([wireRow(1), wireRow(2, { status: 'pending', historyRevision: null, groupId: null })]);
    await w.open();
    const passId = w.background.last().view.passId;
    const all = Array.from({ length: 900 }, (_, i) => message(i, { automated: i === 0 }));
    w.background.last().history.set(fan(1), all);
    // The card's fan was chosen before the module had their messages: read again on «Повторить».
    await settle();
    const card = () => w.vm().pass?.card;
    expect(w.background.of('fansly.followers.history')[0]).toEqual({ passId, fanRef: fan(1), before: null, limit: 250 });
    await w.controller.dispatch({ type: 'RefreshArchive', targetHandle: card()?.handle ?? '' });
    expect(card()?.history).toMatchObject({ s: 'ready', more: true, capped: false, cap: 750 });
    expect(card()?.history.messages.map((item) => item.text).slice(0, 1)).toEqual(['message 650']);
    expect(card()?.history.messages.at(-1)?.text).toBe('message 899');

    await w.controller.dispatch({ type: 'LoadOlder', targetHandle: card()?.handle ?? '' });
    expect(w.background.of('fansly.followers.history').at(-1)).toEqual({ passId, fanRef: fan(1), before: all[650]?.messageId, limit: 250 });
    await w.controller.dispatch({ type: 'LoadOlder', targetHandle: card()?.handle ?? '' });
    expect(card()?.history).toMatchObject({ s: 'ready', more: false, capped: true });
    expect(card()?.history.messages).toHaveLength(750);
    expect(card()?.history.messages[0]?.text).toBe('message 150');
    expect(await w.controller.dispatch({ type: 'LoadOlder', targetHandle: card()?.handle ?? '' })).toMatchObject({ ok: true });
    expect(w.background.of('fansly.followers.history')).toHaveLength(4);

    // A fan the pass has not checked: nothing to read, nothing asked.
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: w.vm().rows[1]?.handle ?? '' });
    await settle();
    expect(card()?.history.s).toBe('unchecked');
    expect(w.background.of('fansly.followers.history')).toHaveLength(4);

    // Automation is marked (§5.8): a welcome is not a personal message.
    const w2 = world([wireRow(1)]);
    await w2.open();
    w2.background.last().history.set(fan(1), [message(0, { automated: true, fromFan: false }), message(1, { fromFan: true })]);
    await w2.controller.dispatch({ type: 'RefreshArchive', targetHandle: w2.vm().pass?.card?.handle ?? '' });
    expect(w2.vm().pass?.card?.history.messages.map((item) => [item.fromFan, item.automated])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('[NF-010] the tab keeps the conversations of the fans looked at last; an older one is read again when it is chosen again', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => wireRow(i + 1));
    const w = world(rows);
    await w.open();
    for (const row of w.vm().rows) {
      await w.controller.dispatch({ type: 'OpenPreview', targetHandle: row.handle });
      await settle();
    }
    expect(w.background.of('fansly.followers.history')).toHaveLength(15);
    // The first fan's chat was let go (12 kept): looked at again, it is read again; the last one is not.
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: w.vm().rows[14]?.handle ?? '' });
    await settle();
    expect(w.background.of('fansly.followers.history')).toHaveLength(15);
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: w.vm().rows[0]?.handle ?? '' });
    await settle();
    expect(w.background.of('fansly.followers.history')).toHaveLength(16);
  });

  it('[NF-010] a read of the conversation that failed is a failure with «Повторить», never an empty chat', async () => {
    const w = world([wireRow(1)]);
    w.background.next.set('fansly.followers.history', { ok: true, payload: { ok: false, error: { code: 'CG-FAN-RATE-LIMIT', retryAt: NOW + 30_000 } } });
    await w.open();
    await settle();
    expect(w.vm().pass?.card?.history).toMatchObject({ s: 'failed', messages: [], failure: { code: 'CG-FAN-RATE-LIMIT', retryAt: NOW + 30_000 } });
    await w.controller.dispatch({ type: 'RefreshArchive', targetHandle: w.vm().pass?.card?.handle ?? '' });
    expect(w.vm().pass?.card?.history).toMatchObject({ s: 'ready', failure: null });
  });

  it('[NF-011] «Открыть в Fansly ↗»: the group’s chat on the page’s own origin — never the fan’s id —, opened by the person in a new tab; nothing else changes', async () => {
    const w = world([wireRow(1), wireRow(2, { status: 'pending', historyRevision: null, groupId: null })]);
    await w.open();
    expect(w.vm().pass?.card?.openHref).toBe(`${ORIGIN}/messages/${group(1)}`);
    expect(w.vm().pass?.card?.openHref).not.toContain(fan(1));
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: w.vm().rows[1]?.handle ?? '' });
    expect(w.vm().pass?.card?.openHref).toBeNull();
    // The link is the page's own anchor: the window stays open, no request is made for it.
    expect(w.surfaces.current().newcomers).toBe(true);
  });

  it('[NF-025] «Результат неполный»: the pass did not finish — the list says so and is not shown as whole', async () => {
    const w = world([wireRow(1)]);
    w.background.partial = true;
    await w.open();
    expect(w.vm().view).toEqual({ s: 'partial', gaps: [{ kind: 'coverage', level: 'partial' }] });
    expect(w.vm().incomplete).not.toBeNull();
    expect(w.vm().footer.stamp.coverage).toBe('partial');
  });

  it('[NF-026] the identity guard: another account or sign-in lets the pass go and opens the new creator’s; a pass of another account is nobody’s; closing the window drops what is late', async () => {
    const w = world([wireRow(1)]);
    await w.open();
    const first = w.background.last().view.passId;
    w.context.set(readyState(OTHER_CREATOR, 2));
    await settle();
    expect(w.background.of('fansly.followers.close')).toEqual([{ passId: first }]);
    expect(w.background.of('fansly.followers.scan').at(-1)).toEqual({ hostAccountId: OTHER_CREATOR, windowHours: 48 });

    // The background answers a pass of another creator: refused, the list is not shown.
    const stray = world([wireRow(1)]);
    stray.background.next.set('fansly.followers.scan', { ok: true, payload: { ok: true, pass: stray.background.viewOf(uuid(0x777), OTHER_CREATOR, 48) } });
    await stray.open();
    expect([stray.vm().pass?.stage, stray.vm().pass?.failure?.code, stray.vm().rows]).toEqual(['failed', 'CG-CONTEXT-CHANGED', []]);
    expect(stray.background.of('fansly.followers.read')).toEqual([]);

    // Closed while the first page was on its way: its answer is dropped, the pass let go.
    const late = world([wireRow(1)]);
    late.background.held.add('fansly.followers.read');
    const opening = late.open();
    await settle();
    await late.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
    late.background.release();
    await opening;
    await settle();
    expect(late.vm().rows).toEqual([]);
    expect(late.background.of('fansly.followers.close')).toHaveLength(1);
    // A handle of a pass that is gone acts on nothing.
    expect(await late.controller.dispatch({ type: 'OpenPreview', targetHandle: passHandle(uuid(0x301), fan(1)) })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
  });

  it('[FX-017] a list that was not read is a failure, never «nobody new»: the scan, the first page, a pass stopped before it read anyone', async () => {
    const scan = world([wireRow(1)]);
    scan.background.next.set('fansly.followers.scan', { ok: true, payload: { ok: false, error: { code: 'CG-FAN-SESSION' } } });
    await scan.open();
    expect([scan.vm().pass?.stage, scan.vm().pass?.failure?.code, scan.vm().view.s]).toEqual(['failed', 'CG-FAN-SESSION', 'error']);

    const page = world([wireRow(1)]);
    page.background.next.set('fansly.followers.read', { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    await page.open();
    expect([page.vm().pass?.stage, page.vm().pass?.failure?.code]).toEqual(['failed', 'CG-RUNTIME-UNREACHABLE']);
    expect(page.vm().view.s).not.toBe('empty');
    // «Повторить» reads it again.
    await page.controller.dispatch({ type: 'ReloadView', selector: { of: 'newcomers' } });
    expect([page.vm().pass?.stage, page.vm().rows.length]).toEqual(['queue', 1]);

    const stopped = world([]);
    stopped.background.state = 'stopped';
    await stopped.open();
    stopped.background.change(stopped.background.last().view.passId, [], { state: 'stopped', error: { code: 'CG-FAN-EXPIRED' } });
    await settle();
    expect([stopped.vm().pass?.stage, stopped.vm().pass?.failure?.code, stopped.vm().view.s]).toEqual(['failed', 'CG-FAN-EXPIRED', 'error']);

    // Only a pass that read the list to its end and found nobody is empty.
    const empty = world([]);
    empty.background.state = 'done';
    await empty.open();
    expect([empty.vm().pass?.stage, empty.vm().view.s]).toEqual(['done', 'empty']);
  });

  it('[FX-017] [NF-026] the owner’s switch off on the page: the window says so; nothing is asked; switched off while open, the pass is let go', async () => {
    const w = world([wireRow(1)], { state: readyState(CREATOR, 1, false) });
    await w.open();
    expect(w.vm().view.s).toBe('forbidden');
    expect(w.background.requests).toEqual([]);

    const live = world([wireRow(1)]);
    await live.open();
    const passId = live.background.last().view.passId;
    live.context.set(readyState(CREATOR, 1, false));
    await settle();
    expect(live.background.of('fansly.followers.close')).toEqual([{ passId }]);
    expect([live.vm().view.s, live.vm().rows]).toEqual(['forbidden', []]);
  });

  it('[NF-010] a fan chosen before the pass checked them: their chat is read once their verdict comes', async () => {
    const w = world([wireRow(1, { status: 'pending', historyRevision: null })]);
    await w.open();
    expect(w.vm().pass?.card?.history.s).toBe('unchecked');
    expect(w.background.of('fansly.followers.history')).toEqual([]);
    w.background.change(w.background.last().view.passId, [wireRow(1)]);
    await settle();
    expect(w.background.of('fansly.followers.history')).toHaveLength(1);
    expect(w.vm().pass?.card?.history.s).toBe('ready');
  });

  it('the handles of a pass are the window’s own: the preview and the AI never take them for a fan of theirs', () => {
    const handle = passHandle(uuid(0x301), fan(1));
    expect(parsePassHandle(handle)).toEqual({ passId: uuid(0x301), fanRef: fan(1) });
    expect(/^(spenders|newcomers|palette):/.test(handle)).toBe(false);
    expect(handle.split(':')).toHaveLength(3);
  });
});

describe('[host:fansly] «Новые» on Fansly: the queue’s buttons (R20 P10b1)', () => {
  it.each(['change', 'page'] as const)('[FS-NEW-4] [NF-026] [NF-038] another window replaces the pass during a %s: adopt its period and fresh conversation, then send the buttons to its id', async (during) => {
    const pending = (n: number) => wireRow(n, { status: 'pending', historyRevision: null });
    const w = world(during === 'page' ? Array.from({ length: 101 }, (_, i) => pending(i + 1)) : [pending(1)]);
    await w.open();
    const old = w.background.last();
    const oldId = old.view.passId;
    old.history.set(fan(1), [message(1, { text: 'old pass' })]);
    w.background.change(oldId, [wireRow(1)]);
    await settle();
    expect(w.vm().pass?.card?.history.messages[0]?.text).toBe('old pass');

    const liveId = uuid(0x900);
    w.background.rows = [wireRow(1, { groupId: group(99) }), wireRow(2, { status: 'pending', historyRevision: null })];
    w.background.passes.set(liveId, {
      view: w.background.viewOf(liveId, CREATOR, 24),
      rows: [...w.background.rows], seq: 0,
      history: new Map([[fan(1), [message(2, { text: 'current pass' })]]]),
    });
    // The terminal event prompts a read of the old id; the background redirects it to the live pass.
    w.background.next.set('fansly.followers.read', await w.background.request('fansly.followers.read', { passId: liveId, offset: during === 'page' ? 100 : 0, limit: 100, query: { search: '', tab: 'todo', filter: 'any' } }));
    let loading: ReturnType<typeof w.controller.dispatch> = null;
    if (during === 'page') {
      w.background.held.add('fansly.followers.read');
      loading = w.controller.dispatch({ type: 'LoadMore', list: 'newcomers' });
      await settle();
    }
    w.background.change(oldId, [], { state: 'stopped', error: { code: 'CG-CONTEXT-CHANGED' } });
    w.background.release();
    await loading;
    await settle();
    expect(w.vm().windowHours).toBe(24);
    expect(w.vm().pass).toMatchObject({ passId: liveId, stage: 'queue', card: { history: { messages: [{ text: 'current pass' }] } } });
    expect(w.background.of('fansly.followers.scan')).toHaveLength(1);
    expect(await w.controller.dispatch({ type: 'OpenPreview', targetHandle: passHandle(oldId, fan(1)) })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(await w.controller.dispatch({ type: 'SetNewcomersPassRunning', running: false })).toMatchObject({ ok: true });
    expect(w.background.of('fansly.followers.pause')).toEqual([{ passId: liveId }]);
    w.background.change(liveId, [], { state: 'paused' });
    await settle();
    expect(w.vm().pass?.stage).toBe('paused');
    expect(await w.controller.dispatch({ type: 'SetNewcomersPassRunning', running: true })).toMatchObject({ ok: true });
    expect(w.background.of('fansly.followers.resume')).toEqual([{ passId: liveId }]);
    await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
    expect(w.background.of('fansly.followers.close')).toEqual([{ passId: liveId }]);
  });

  it('[NF-038] «Пауза» while the queue runs, «Проверить оставшихся: N» while it stands; «Проверить следующим» / «Проверить чат» on the card of a fan not checked yet — each one request, the rest comes as the pass’s changes', async () => {
    const w = world([wireRow(1, { status: 'pending', historyRevision: null, checkedAt: null }), wireRow(2), wireRow(3, { status: 'failed', historyRevision: null, error: { code: 'CG-FAN-REQUEST' } })]);
    await w.open();
    const passId = w.background.last().view.passId;
    const handle = passHandle(passId, fan(1));
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: handle });
    await settle();
    // The fake background counts the failed fan as checked: one left.
    expect(w.vm().pass?.run).toEqual({ pause: true, resume: false, remaining: 1, busy: false });
    expect(w.vm().pass?.card?.checkNext).toBe('next');

    w.background.held.add('fansly.followers.pause');
    const pausing = w.controller.dispatch({ type: 'SetNewcomersPassRunning', running: false });
    await settle();
    expect(w.vm().pass?.run?.busy).toBe(true);
    w.background.release();
    expect(await pausing).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.background.of('fansly.followers.pause')).toEqual([{ passId }]);
    // The state comes as the background's change, not from the answer.
    w.background.change(passId, [], { state: 'paused' });
    await settle();
    expect(w.vm().pass?.run).toEqual({ pause: false, resume: true, remaining: 1, busy: false });
    expect(w.vm().pass?.card?.checkNext).toBe('now');

    expect(await w.controller.dispatch({ type: 'CheckNewcomerNext', targetHandle: handle })).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.background.of('fansly.followers.prioritize')).toEqual([{ passId, fanRef: fan(1) }]);
    // A fan the queue does not take: nothing happens, and the window says so quietly.
    expect(await w.controller.dispatch({ type: 'CheckNewcomerNext', targetHandle: passHandle(passId, fan(3)) })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(await w.controller.dispatch({ type: 'SetNewcomersPassRunning', running: true })).toMatchObject({ ok: true });
    expect(w.background.of('fansly.followers.resume')).toEqual([{ passId }]);
    // A handle of another pass is nobody's.
    expect(await w.controller.dispatch({ type: 'CheckNewcomerNext', targetHandle: passHandle(uuid(0x999), fan(1)) })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });

    // A checked fan has nothing to check; a pass done with nobody left offers no button.
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: passHandle(passId, fan(2)) });
    const record = w.background.last();
    record.view = { ...record.view, counts: { ...record.view.counts, checked: 3 } };
    w.background.change(passId, [wireRow(1), wireRow(3)], { state: 'done' });
    await settle();
    expect(w.vm().pass?.card?.checkNext).toBeNull();
    expect(w.vm().pass?.run).toMatchObject({ pause: false, resume: false });
  });
});

describe('[host:fansly] «Новые» on Fansly: «Нельзя написать» and «Исключить из очереди» (R20 P10b2)', () => {
  it('[FX-003] [FS-NEW-2] a fan nobody can write to: the reason on the card and «Исключить из очереди» — one request; the row leaves «К обработке» as the pass’s change; «Вернуть в очередь» under «Все»', async () => {
    const w = world([wireRow(1, { status: 'dm-closed', dmClosed: 'paid', dmPriceMills: 1700 }), wireRow(2), wireRow(3, { status: 'excluded', dmClosed: 'permissions' })]);
    await w.open();
    const passId = w.background.last().view.passId;
    const handle = passHandle(passId, fan(1));
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: handle });
    await settle();
    expect(w.vm().pass?.card).toMatchObject({ check: 'dm-closed', dmClosed: 'paid', dmPriceMills: 1700, exclude: 'exclude', checkNext: null });
    // «К обработке» holds the fan nobody can write to until the person takes them out; the excluded one is under «Все».
    expect([statuses(w.vm()), w.vm().tabs.map((tab) => tab.count)]).toEqual([['fan_1:dm-closed', 'fan_2:ready'], [2, 3]]);

    expect(await w.controller.dispatch({ type: 'ExcludeNewcomer', targetHandle: handle, excluded: true })).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.background.of('fansly.followers.exclude')).toEqual([{ passId, fanRef: fan(1), excluded: true }]);
    // The row comes back as the background's change, not from the answer.
    w.background.change(passId, [wireRow(1, { status: 'excluded', dmClosed: 'paid', dmPriceMills: 1700 })]);
    await settle();
    expect([statuses(w.vm()), w.vm().tabs.map((tab) => tab.count)]).toEqual([['fan_2:ready'], [1, 3]]);
    // The card goes on to a fan the person can write to.
    expect(w.vm().pass?.card).toMatchObject({ check: 'ready', exclude: null });

    await w.controller.dispatch({ type: 'SetNewcomersTab', tab: 'all' });
    await w.controller.dispatch({ type: 'OpenPreview', targetHandle: handle });
    await settle();
    expect(w.vm().pass?.card).toMatchObject({ check: 'excluded', dmClosed: 'paid', dmPriceMills: 1700, exclude: 'restore' });
    expect(await w.controller.dispatch({ type: 'ExcludeNewcomer', targetHandle: handle, excluded: false })).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.background.of('fansly.followers.exclude').at(-1)).toEqual({ passId, fanRef: fan(1), excluded: false });

    // A fan who can be written to is not taken out: the background says so, quietly; another pass's handle is nobody's.
    expect(await w.controller.dispatch({ type: 'ExcludeNewcomer', targetHandle: passHandle(passId, fan(2)), excluded: true })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(await w.controller.dispatch({ type: 'ExcludeNewcomer', targetHandle: passHandle(uuid(0x999), fan(1)), excluded: true })).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(w.background.of('fansly.followers.exclude')).toHaveLength(3);
  });
});

// ── R20 P10c: the card's greeting ──

const GEN = '00000000-0000-4000-8000-000000000601';
const TOKEN = 'a'.repeat(32);
const AVATAR = 'https://cdn3.fansly.com/a/300.jpeg?Key-Pair-Id=K1&Policy=P1&Signature=S1';

/** The pass's proof of fan `n`: two messages of its group (the welcome, the fan's), its start, its avatar. */
function proofOf(n: number, personal = 1): FanslyGreetingProof {
  const welcome = String(600000000000000000n + BigInt(n * 10));
  const fans = String(600000000000000000n + BigInt(n * 10 + 1));
  return {
    groupId: group(n),
    historyRevision: uuid(0x500 + n),
    window: [{ id: welcome, dir: 'model' }, { id: fans, dir: 'fan' }],
    knownFanMessageIds: [fans],
    startProof: { v: 1, source: 'pass-empty-page', groupId: group(n), startWitnessId: welcome, coveredCount: Math.max(2, personal + 1), personalCount: personal, automatedIds: [welcome] },
    fanAvatarUrl: AVATAR,
  };
}

/** The tab's port as the greeting uses it: action tokens, `op.start` held to its schema, the ends the test emits. */
function fakeRpc() {
  const started: StartOp[] = [];
  const tokens: string[] = [];
  const listeners = new Set<(payload: { view: OpView }) => void>();
  const views = new Map<string, OpView>();
  const state = { existingOpId: null as string | null, onStart: null as ((opId: string) => void) | null };
  let next = 0xc1;
  const rpc = {
    request(type: string, payload: unknown): Promise<unknown> {
      if (type === 'token.issue') {
        tokens.push((payload as { kind: string }).kind);
        return Promise.resolve({ ok: true, payload: { actionToken: TOKEN, expiresAt: NOW + 60_000 } });
      }
      if (type === 'op.start') {
        expect(StartOpSchema.safeParse(payload).success, JSON.stringify(StartOpSchema.safeParse(payload).error)).toBe(true);
        started.push(payload as StartOp);
        const opId = state.existingOpId ?? uuid(next++);
        state.onStart?.(opId);
        return Promise.resolve({ ok: true, payload: { ok: true, opId } });
      }
      if (type === 'op.list') return Promise.resolve({ ok: true, payload: { ops: [...views.values()], truncated: false } });
      return Promise.reject(new Error(`unexpected ${type}`));
    },
    onEvent(type: string, listener: (payload: { view: OpView }) => void) {
      if (type === 'op.done') listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as TabRpc;
  /** The background's end of a Hi: the one variant's parts. */
  const done = (opId: string, parts: string[], patch: Partial<OpView> = {}, emit = true): void => {
    const view = { opId, feature: 'hi', surface: 'newcomers', state: 'done', result: { kind: 'variants', variants: [parts] }, generationRef: GEN, toneUsed: null, ...patch } as unknown as OpView;
    views.set(opId, view);
    if (emit) for (const listener of [...listeners]) listener({ view });
  };
  return { rpc, started, tokens, done, views, state };
}

/** The host as the card uses it: the document, the person's own sends, «Открыть и вставить». */
function fakeHost() {
  const listeners = new Set<(event: HostEvent) => void>();
  const navigations: NavigationIntent[] = [];
  const host = {
    current: () => ({ identity: { documentEpoch: 'doc-1' } }),
    subscribe(listener: (event: HostEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate(intent: NavigationIntent): Promise<NavigationReceipt> {
      expect(NavigationIntentSchema.safeParse(intent).success).toBe(true);
      navigations.push(intent);
      return Promise.resolve({ state: 'navigated', routeEpoch: 2, insert: { state: 'applied', draftRevision: 1, draftDigest: 'ab'.repeat(8), ms: 4 } });
    },
  } as unknown as HostPort;
  const sent = (intentId: string, platformMessageId: string, chat = { host: 'fansly-web' as const, hostAccountId: CREATOR, platformFanId: fan(1) }, edited = false): void => {
    const event = {
      type: 'humanSend',
      fact: { chat, pendingId: 'p-1', platformMessageId, textDigest: 'ab'.repeat(8), draft: { revision: 3, provenance: edited ? 'mixed' : 'our-insert', insertIntentId: intentId, editedSinceInsert: edited } },
    } as unknown as HostEvent;
    for (const listener of [...listeners]) listener(event);
  };
  return { host, navigations, sent };
}

function greetingWorld(rows: FanslyFollowerRow[] = [wireRow(1), wireRow(2)], options: { readonly state?: PageContextState; readonly background?: FakeFollowers } = {}) {
  const background = options.background ?? new FakeFollowers();
  background.rows = rows;
  for (const row of rows) background.proofs.set(row.fanRef, proofOf(Number(BigInt(row.fanRef) - 800000000000000000n)));
  const context = fakeContext(options.state ?? readyState());
  const surfaces = new Surfaces();
  const clock = manualClock();
  const i18n = createI18n({ language: 'ru', now: () => NOW, timeZone: 'Europe/Moscow' });
  const tab = fakeRpc();
  const site = fakeHost();
  /** The site's verdict over a generation (spec §3.5), by operation: fresh unless the test says otherwise. */
  const marks = new Map<string, StaleReason>();
  background.generation = (opId) => {
    const view = tab.views.get(opId);
    const parts = view?.result?.kind === 'variants' ? view.result.variants[0] : undefined;
    return parts?.length === 1 ? { opId, generationRef: view?.generationRef ?? null, text: (parts[0] ?? '').trim(), mark: marks.get(opId) ?? null } : null;
  };
  let id = 0xa00;
  const controller = createPassNewcomersController({
    source: createFanslyNewcomersSource(background, ORIGIN),
    i18n,
    clock,
    context,
    surfaces,
    greeting: { rpc: tab.rpc, host: site.host, ids: { uuid: () => uuid(id++) }, verdict: (view) => marks.get(view.opId) ?? null },
  });
  const vm = (): NewcomersVM => controller.getSnapshot({ of: 'newcomers' });
  const card = () => vm().pass?.card ?? null;
  const greeting = () => card()?.greeting ?? null;
  const open = async (): Promise<void> => {
    await controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } });
    await settle();
  };
  const handle = (n: number): string => passHandle(background.last().view.passId, fan(n));
  const pick = async (n: number): Promise<void> => {
    await controller.dispatch({ type: 'OpenPreview', targetHandle: handle(n) });
    await settle();
  };
  const type = async (n: number, text: string): Promise<void> => {
    await controller.dispatch({ type: 'SetPreviewDraft', targetHandle: handle(n), text });
    await clock.advance(GREETING_DRAFT_DEBOUNCE_MS);
  };
  const generate = (n: number) => controller.dispatch({ type: 'Generate', targetHandle: handle(n), feature: 'hi', options: {} });
  const send = (n: number) => controller.dispatch({ type: 'SendNewcomerGreeting', targetHandle: handle(n) });
  return { background, context, surfaces, clock, controller, vm, card, greeting, open, handle, pick, type, generate, send, tab, site, marks };
}

describe('[host:fansly] «Новые» on Fansly: the card’s greeting (R20 P10c)', () => {
  it('[FS-TAIL-8] an unverified AI draft stays AI and blocked after close/open, a reload or another tab; only a changed text becomes own', async () => {
    const w = greetingWorld();
    await w.open();
    const run = w.generate(1);
    await settle();
    w.marks.set(uuid(0xc1), 'unverified');
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await run;
    await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
    await w.open();
    expect(w.greeting()).toMatchObject({ text: 'Hey Fan 1!', ai: true, mark: 'unverified', canSend: false });
    const other = greetingWorld(undefined, { background: w.background });
    await other.open();
    expect(other.greeting()).toMatchObject({ ai: true, mark: 'unverified', canSend: false });
    expect(await other.send(1)).toMatchObject({ ok: false, code: 'CG-SEND-FRESHNESS' });
    expect(w.background.of('fansly.followers.send')).toHaveLength(0);
    await other.type(1, 'Hey Fan 1, welcome!');
    expect(other.greeting()).toMatchObject({ ai: false, mark: null, canSend: true });
    await other.send(1);
    expect(w.background.of('fansly.followers.send').at(-1)).toMatchObject({ admission: { kind: 'ai-edited', generationRef: GEN }, text: 'Hey Fan 1, welcome!' });
  });

  it('[FS-NEW-3] uncertain and sent survive reopening and another tab, disabling both send and native insert', async () => {
    for (const state of ['uncertain', 'sent'] as const) {
      const w = greetingWorld();
      await w.open();
      await w.type(1, 'Hi!');
      w.background.sendAnswer = (click) => ({ ok: true, attempt: state === 'uncertain' ? { attemptId: click.attemptId, fanRef: click.fanRef, state, code: 'CG-SEND-UNCERTAIN', cause: 'network' } : { attemptId: click.attemptId, fanRef: click.fanRef, state, proof: 'echo', platformMessageId: '830000000000000001' } });
      await w.send(1);
      await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
      await w.open();
      expect(w.greeting()).toMatchObject({ state: { s: state }, canSend: false, canInsert: false, canGenerate: false });
      const other = greetingWorld(undefined, { background: w.background });
      await other.open();
      expect(other.greeting()).toMatchObject({ state: { s: state }, canSend: false, canInsert: false });
      expect(await other.controller.dispatch({ type: 'InsertNewcomerGreeting', targetHandle: other.handle(1) })).toMatchObject({ ok: false });
      expect(await other.send(1)).toMatchObject({ ok: false });
      expect(other.site.navigations).toHaveLength(0);
      expect(w.background.of('fansly.followers.send')).toHaveLength(1);
    }
  });

  it('[FS-TAIL-8] reconnect cannot relabel an unsaved unverified result when the generation’s draft write lost its answer', async () => {
    const w = greetingWorld();
    await w.open();
    const run = w.generate(1);
    await settle();
    w.marks.set(uuid(0xc1), 'unverified');
    w.background.next.set('fansly.followers.draft', { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await run;
    w.background.reconnect();
    await settle();
    expect(w.greeting()).toMatchObject({ text: 'Hey Fan 1!', ai: true, mark: 'unverified', canSend: false });
    expect(await w.send(1)).toMatchObject({ ok: false, code: 'CG-SEND-FRESHNESS' });
    expect(w.background.of('fansly.followers.send')).toHaveLength(0);
  });

  it('[FS-NEW-3] a background refusal because another tab already sent or is uncertain keeps the native-insert ban', async () => {
    for (const code of ['CG-SEND-UNCERTAIN', 'CG-SEND-PART'] as const) {
      const w = greetingWorld();
      await w.open();
      await w.type(1, 'Hi!');
      w.background.sendAnswer = () => ({ ok: false, error: { code } });
      await w.send(1);
      expect(w.greeting()).toMatchObject({ state: { s: code === 'CG-SEND-PART' ? 'sent' : 'uncertain' }, canSend: false, canInsert: false });
    }
  });

  it('[FS-NEW-3] a send answer lost to timeout/port loss is uncertain; reopen reads the running attempt and reconnect reads its durable resolution without another send', async () => {
    for (const code of ['CG-RUNTIME-UNREACHABLE', 'CG-RUNTIME-RELOADED', 'CG-TIMEOUT'] as const) {
      const w = greetingWorld();
      await w.open();
      await w.type(1, 'Hi!');
      w.background.held.add('fansly.followers.send');
      const send = w.send(1);
      await settle();
      const click = w.background.of('fansly.followers.send')[0] as FanslyTabRequestPayload<'fansly.followers.send'>;
      expect(click).toBeDefined();
      w.background.attempts.set(fan(1), { attemptId: click.attemptId, fanRef: fan(1), state: 'requestStarted' });
      w.background.next.set('fansly.followers.send', { ok: false, error: { code } });
      w.background.release();
      await send;
      expect(w.greeting()).toMatchObject({ state: { s: 'uncertain' }, canSend: false, canInsert: false });
      await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
      await w.open();
      expect(w.greeting()).toMatchObject({ state: { s: 'uncertain' }, canInsert: false });
      w.background.attempts.set(fan(1), { attemptId: click.attemptId, fanRef: fan(1), state: 'sent', proof: 'resolved-sent' });
      w.background.reconnect();
      await settle();
      expect(w.greeting()).toMatchObject({ state: { s: 'sent' }, canSend: false, canInsert: false });
      expect(w.background.of('fansly.followers.send')).toHaveLength(1);
    }
  });

  it('[NF-013] re-generate bypasses the cache and names the previous operation; an already-finished returned opId is consumed immediately', async () => {
    const w = greetingWorld();
    await w.open();
    const first = w.generate(1);
    await settle();
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await first;
    const second = w.generate(1);
    await settle();
    expect(w.tab.started[1]).toMatchObject({ force: true, regenerateOf: uuid(0xc1) });
    w.tab.done(uuid(0xc2), ['Welcome back!']);
    await second;
    // A different tab's cached operation: no op.done event in this window at all.
    const cached = greetingWorld();
    await cached.open();
    cached.tab.done(uuid(0xc3), ['Already finished'], {}, false);
    cached.tab.state.existingOpId = uuid(0xc3);
    const reopened = cached.generate(1);
    await settle();
    expect(cached.greeting()).toMatchObject({ text: 'Already finished', state: { s: 'idle' } });
    expect(await reopened).toMatchObject({ ok: true });
    // Completion may also beat the admission answer.
    const fast = greetingWorld();
    await fast.open();
    fast.tab.state.onStart = (opId) => fast.tab.done(opId, ['Finished before admission']);
    const early = fast.generate(1);
    await settle();
    expect(fast.greeting()?.text).toBe('Finished before admission');
    expect(await early).toMatchObject({ ok: true });
  });

  it('[NF-012] [NF-028] the draft is the field: read once when the card opens, written after a pause — not on every key; the card sends nothing by itself', async () => {
    const w = greetingWorld();
    w.background.drafts.set(fan(1), { text: 'saved yesterday', revision: 4, historyRevision: uuid(0x501) });
    await w.open();
    expect(w.background.of('fansly.followers.draft')).toEqual([{ passId: w.background.last().view.passId, fanRef: fan(1) }]);
    expect(w.greeting()).toMatchObject({ text: 'saved yesterday', maxChars: 5000, ai: false, canSend: true, canInsert: true, state: { s: 'idle' } });
    await w.controller.dispatch({ type: 'SetPreviewDraft', targetHandle: w.handle(1), text: 'H' });
    await w.controller.dispatch({ type: 'SetPreviewDraft', targetHandle: w.handle(1), text: 'Hi' });
    expect(w.greeting()?.text).toBe('Hi');
    expect(w.background.of('fansly.followers.draft')).toHaveLength(1);
    await w.clock.advance(GREETING_DRAFT_DEBOUNCE_MS);
    expect(w.background.of('fansly.followers.draft').at(-1)).toEqual({ passId: w.background.last().view.passId, fanRef: fan(1), text: 'Hi' });
    expect(w.background.drafts.get(fan(1))).toEqual({ text: 'Hi', revision: 5, historyRevision: uuid(0x501) });
    // NF-028: nothing went anywhere by itself — no generation, no send.
    await w.clock.advance(600_000);
    expect([w.tab.started, w.background.of('fansly.followers.send')]).toEqual([[], []]);
  });

  it('[NF-013] [NF-034] «Сгенерировать»: one Hi of one variant on the pass’s proof — the group as the conversation (never the fan’s id), the history’s ids, the start and the fan’s avatar; the result goes into the field with «AI»', async () => {
    const w = greetingWorld();
    await w.open();
    const generating = w.generate(1);
    await settle();
    expect(w.greeting()?.state).toEqual({ s: 'generating' });
    const [start] = w.tab.started;
    const proof = proofOf(1);
    expect(start).toMatchObject({
      feature: 'hi',
      surface: 'newcomers',
      variantCount: 1,
      split: false,
      tone: null,
      cause: { kind: 'click', actionToken: TOKEN },
      target: { fanRef: fan(1), conversationRef: group(1), chat: { hostAccountId: CREATOR, platformFanId: fan(1) } },
      proof: { kind: 'pass', conversationRef: group(1), completeness: 'complete', window: proof.window, knownFanMessageIds: proof.knownFanMessageIds, deletedIds: [] },
      startProof: proof.startProof,
      personalMessageCount: 1,
      fanAvatarUrl: AVATAR,
    });
    expect(start?.target.conversationRef).not.toBe(fan(1));
    expect(w.tab.tokens).toEqual(['generate']);
    w.tab.done(uuid(0xc1), ['  Hey Fan 1, welcome! 💕 ']);
    expect(await generating).toMatchObject({ ok: true });
    await settle();
    expect(w.greeting()).toMatchObject({ text: 'Hey Fan 1, welcome! 💕', ai: true, mark: null, canSend: true, state: { s: 'idle' } });
    // The result is the draft at once.
    expect(w.background.drafts.get(fan(1))?.text).toBe('Hey Fan 1, welcome! 💕');
  });

  it('[NF-014] [NF-015] before the hub is asked: a fan whose history the pass has not read to its start gets no generation; more than ten personal messages among the last 30 — a dialogue, Reply’s: refused without a request', async () => {
    const w = greetingWorld([wireRow(1, { status: 'ready', historyRevision: null }), wireRow(2)]);
    w.background.proofs.set(fan(2), proofOf(2, 11));
    await w.open();
    await w.pick(1);
    expect(w.card()?.check).toBe('unverified');
    expect(w.greeting()).toMatchObject({ waiting: true, canGenerate: false, canSend: false });
    expect(await w.generate(1)).toMatchObject({ ok: false, code: 'CG-DATA-NOT-READY' });
    await w.pick(2);
    expect(await w.generate(2)).toMatchObject({ ok: false, code: 'CG-GATE-HI' });
    expect(w.greeting()?.state).toEqual({ s: 'refused', failure: { code: 'CG-GATE-HI', retryAt: null } });
    expect(w.tab.started).toEqual([]);
    expect(w.background.of('fansly.followers.proof')).toHaveLength(1);
  });

  it('[NF-016] [NF-017] the sign-in, the binding and the persona are the same around the generation — else its result is not taken; an empty, split or marked result is unusable', async () => {
    const w = greetingWorld();
    await w.open();
    const first = w.generate(1);
    await settle();
    // Another persona meanwhile (the same page): the result is not this card's.
    w.context.set({ ...readyState(), persona: { key: 'p2', definitionId: 9, label: 'Lora · VIP' } as unknown as PageContextState['persona'] });
    w.tab.done(uuid(0xc1), ['Hey!']);
    expect(await first).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(w.greeting()?.text).toBe('');
    // The owner edited the persona meanwhile (its key stays, the choice followed): the same persona — the result is taken.
    const edited = greetingWorld();
    const lora = (definitionId: string) => ({ ...readyState(), persona: { key: 'lora', definitionId, label: 'Lora' } as PageContextState['persona'] });
    edited.context.set(lora('pdef_0000000000000001'));
    await edited.open();
    const kept = edited.generate(1);
    await settle();
    edited.context.set(lora('pdef_0000000000000002'));
    edited.tab.done(uuid(0xc1), ['Hey!']);
    expect(await kept).toMatchObject({ ok: true });
    expect(edited.greeting()?.text).toBe('Hey!');
    for (const parts of [[''], ['Hey', 'there'], ['Hey [NEXT] there'], ['x'.repeat(5001)]]) {
      const v = greetingWorld();
      await v.open();
      const run = v.generate(1);
      await settle();
      v.tab.done(uuid(0xc1), parts);
      expect(await run, JSON.stringify(parts).slice(0, 40)).toMatchObject({ ok: false });
      expect(v.greeting()).toMatchObject({ text: '', ai: false, state: { s: 'refused', failure: { code: 'CG-OUTPUT-UNUSABLE' } } });
    }
  });

  it('[NF-019] [FS-NEW-6] «Отправить»: one click, one attempt of the background’s send — the field’s text trimmed, its revision, the history the card shows, the person’s own admission; it went — «Отправлено»', async () => {
    const w = greetingWorld();
    await w.open();
    await w.type(1, '  Hi Fan 1!  ');
    expect(await w.send(1)).toMatchObject({ ok: true });
    expect(w.background.of('fansly.followers.send')).toEqual([
      {
        attemptId: uuid(0xa00),
        passId: w.background.last().view.passId,
        hostAccountId: CREATOR,
        fanRef: fan(1),
        // The group the pass resolved, never the fan's id (FS-IDN-6).
        groupId: group(1),
        text: 'Hi Fan 1!',
        draftRevision: 1,
        historyRevision: uuid(0x501),
        admission: { kind: 'own' },
        cause: { kind: 'click', actionToken: TOKEN },
      },
    ]);
    expect(w.tab.tokens).toEqual(['send']);
    expect(w.greeting()).toMatchObject({ state: { s: 'sent', at: new Date(NOW + GREETING_DRAFT_DEBOUNCE_MS).toISOString() }, canSend: false, canGenerate: false });
    // Sent: never again from this card.
    expect(await w.send(1)).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
    expect(w.background.of('fansly.followers.send')).toHaveLength(1);
  });

  it('[FS-NEW-6] the three admissions: an unchanged AI result as its generation (its operation, the history it was made on); an edited one as the person’s own with no «AI» mark', async () => {
    const w = greetingWorld();
    await w.open();
    const run = w.generate(1);
    await settle();
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await run;
    await settle();
    await w.send(1);
    expect(w.background.of('fansly.followers.send').at(-1)).toMatchObject({ text: 'Hey Fan 1!', admission: { kind: 'ai', generationRef: GEN, variant: 0 }, opId: uuid(0xc1), historyRevision: uuid(0x501) });

    const e = greetingWorld();
    await e.open();
    const again = e.generate(1);
    await settle();
    e.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await again;
    await settle();
    await e.type(1, 'Hey Fan 1! Boston, right?');
    expect(e.greeting()).toMatchObject({ ai: false, mark: null });
    await e.send(1);
    const edited = e.background.of('fansly.followers.send').at(-1) as Record<string, unknown>;
    expect(edited).toMatchObject({ text: 'Hey Fan 1! Boston, right?', admission: { kind: 'ai-edited', generationRef: GEN, variant: 0 } });
    expect(edited['opId']).toBeUndefined();
  });

  it('[FS-TAIL-8] [NF-018] the hub caught up after an unverified generation — the old result is still not sent, only a new one; the pass checked the history again — the old result is not this history’s', async () => {
    const w = greetingWorld();
    await w.open();
    const run = w.generate(1);
    await settle();
    // Its own verdict: the hub could not say it saw the last messages.
    w.marks.set(uuid(0xc1), 'unverified');
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await run;
    await settle();
    expect(w.greeting()).toMatchObject({ ai: true, mark: 'unverified', canSend: false, sendBlocked: { code: 'CG-SEND-FRESHNESS' } });
    expect(await w.send(1)).toMatchObject({ ok: false, code: 'CG-SEND-FRESHNESS' });
    expect(w.background.of('fansly.followers.send')).toEqual([]);
    // A new generation with a fresh verdict may go.
    const fresh = w.generate(1);
    await settle();
    w.tab.done(uuid(0xc2), ['Hey Fan 1, welcome!']);
    await fresh;
    await settle();
    expect(w.greeting()).toMatchObject({ mark: null, canSend: true });
    // The pass read the history again and it changed: the unchanged result waits for a new one (NF-018).
    w.background.change(w.background.last().view.passId, [wireRow(1, { historyRevision: uuid(0x777) })]);
    await settle();
    expect(w.greeting()).toMatchObject({ canSend: false, sendBlocked: { code: 'CG-FNEW-HISTORY' } });
    expect(await w.send(1)).toMatchObject({ ok: false });
    expect(w.background.of('fansly.followers.send')).toEqual([]);
  });

  it('[NF-018] [NF-024] [NF-023] the background’s refusal names its reason and nothing is repeated — the history changed after the review, a colleague’s lease, an unknown outcome; a second click while one runs is busy', async () => {
    const w = greetingWorld();
    await w.open();
    await w.type(1, 'Hi!');
    w.background.sendAnswer = () => ({ ok: false, error: { code: 'CG-FNEW-HISTORY' } });
    await w.send(1);
    expect(w.greeting()?.state).toEqual({ s: 'refused', failure: { code: 'CG-FNEW-HISTORY', retryAt: null } });
    w.background.sendAnswer = (payload) => ({ ok: true, attempt: { attemptId: payload.attemptId, fanRef: payload.fanRef, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' } });
    await w.send(1);
    expect(w.greeting()?.state).toEqual({ s: 'refused', failure: { code: 'CG-CLAIM-BUSY', retryAt: null } });
    w.background.sendAnswer = (payload) => ({ ok: true, attempt: { attemptId: payload.attemptId, fanRef: payload.fanRef, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' } });
    await w.send(1);
    expect(w.greeting()).toMatchObject({ state: { s: 'uncertain', failure: { code: 'CG-SEND-UNCERTAIN' } }, canSend: false });
    // Unknown: never sent again from here.
    expect(await w.send(1)).toMatchObject({ ok: false });
    expect(w.background.of('fansly.followers.send')).toHaveLength(3);

    const v = greetingWorld();
    await v.open();
    await v.type(1, 'Hi!');
    v.background.held.add('fansly.followers.send');
    const first = v.send(1);
    await settle();
    expect(await v.send(1)).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    v.background.release();
    await first;
    expect(v.background.of('fansly.followers.send')).toHaveLength(1);
  });

  it('[FS-NEW-3] «Открыть и вставить»: the fan’s chat opens in this tab by its group with the field’s text; the person’s own send of it with Fansly’s button marks the fan greeted for everyone', async () => {
    const w = greetingWorld();
    await w.open();
    await w.type(1, 'Hi Fan 1!');
    expect(await w.controller.dispatch({ type: 'InsertNewcomerGreeting', targetHandle: w.handle(1) })).toMatchObject({ ok: true, outcome: 'opened' });
    const [navigation] = w.site.navigations;
    // The conversation is the group, never the fan's id (FS-IDN-6).
    expect(navigation?.target).toEqual({ hostAccountId: CREATOR, platformFanId: fan(1), conversationRef: group(1) });
    expect(navigation?.thenInsert).toMatchObject({ text: 'Hi Fan 1!', mode: 'replace', expected: { kind: 'deferred', documentEpoch: 'doc-1' } });
    expect(w.tab.tokens).toEqual(['navigate']);
    // The window gets out of the way of the chat.
    expect(w.surfaces.current().newcomers).toBe(false);
    // A send not linked to our insert is not ours to register.
    w.site.sent(uuid(0x999), '830000000000000003');
    w.site.sent(navigation?.thenInsert?.intentId ?? '', '830000000000000004', { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: fan(2) });
    await settle();
    expect(w.background.of('fansly.followers.sent')).toEqual([]);
    w.site.sent(navigation?.thenInsert?.intentId ?? '', '830000000000000005');
    await settle();
    expect(w.background.of('fansly.followers.sent')).toEqual([
      { passId: w.background.last().view.passId, hostAccountId: CREATOR, fanRef: fan(1), groupId: group(1), platformMessageId: '830000000000000005', text: 'Hi Fan 1!', admission: { kind: 'own' } },
    ]);
    // No request of ours sent anything.
    expect(w.background.of('fansly.followers.send')).toEqual([]);
  });
});
