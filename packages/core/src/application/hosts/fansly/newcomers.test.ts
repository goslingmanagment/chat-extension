// «Новые» on Fansly at the controller's level (R20 P10c, X59): the card's greeting and the batch's row sends over
// Fansly's source (./newcomers.ts) and a background module played here — one click, one attempt; an uncertain or
// sent greeting is never sent again; every request and answer is held to Fansly's registry (tab-messages-fansly.ts).

import { describe, expect, it } from 'vitest';

import { type Bootstrap, type BootstrapPage } from '@cg/contracts/hub';
import { type HostAccount, type HubBinding } from '@cg/contracts/ids';
import {
  FANSLY_TAB_LIMITS,
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
import { passHandle } from '../../newcomers/pass';
import { createPassNewcomersController } from '../../newcomers/pass';
import { createFanslyNewcomersSource, type FanslyFollowersAnswer, type FanslyFollowersPort, type FanslyFollowersRequest } from './newcomers';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const ISO_NOW = new Date(NOW).toISOString();
const CREATOR = '700000000000000017';
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
  /** X59: the period the background remembers — the person's last choice, the default before any. */
  remembered: number = FANSLY_TAB_LIMITS.windowHoursDefault;
  rows: FanslyFollowerRow[] = [];
  state: FanslyPassView['state'] = 'queue';
  partial = false;
  /** The background's own rule (`scan`): the window opened again goes on with the creator's pass of that period; off — a new pass each time. */
  keepPass = false;
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
        const chosen = payload['windowHours'] as number | null;
        if (chosen !== null) this.remembered = chosen;
        const open = this.keepPass ? [...this.passes.values()].at(-1) : undefined;
        if (open !== undefined && open.view.hostAccountId === payload['hostAccountId'] && open.view.windowHours === this.remembered) return { ok: true, pass: open.view };
        const passId = uuid(this.nextPass++);
        const view = this.viewOf(passId, payload['hostAccountId'] as string, chosen ?? this.remembered);
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
      // 2026-10-25: Hi's own read of the history alongside the generation — nobody wrote meanwhile.
      case 'fansly.followers.recheck': {
        const revision = this.rows.find((row) => row.fanRef === payload['fanRef'])?.historyRevision ?? null;
        return revision === null ? { ok: false, error: { code: 'CG-FNEW-UNVERIFIED' } } : { ok: true, historyRevision: revision };
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
      // 2026-10-22: the newest attempt of each fan, for the list's word before a card opens; nothing refused.
      case 'fansly.followers.outcomes':
        return { ok: true, attempts: [...this.attempts.values()].filter((attempt) => attempt.state !== 'refused') };
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
    fanAccount: { username: `fan_${n}`, displayName: `Fan ${n}` },
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

  it('[FS-NEW-3] sent and uncertain survive reopening and another tab: a sent greeting is never sent or inserted again (X5); an unknown one says so and lets the person send again by their own click', async () => {
    for (const state of ['uncertain', 'sent'] as const) {
      const w = greetingWorld();
      await w.open();
      await w.type(1, 'Hi!');
      w.background.sendAnswer = (click) => ({ ok: true, attempt: state === 'uncertain' ? { attemptId: click.attemptId, fanRef: click.fanRef, state, code: 'CG-SEND-UNCERTAIN', cause: 'network' } : { attemptId: click.attemptId, fanRef: click.fanRef, state, proof: 'echo', platformMessageId: '830000000000000001' } });
      await w.send(1);
      await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
      await w.open();
      const open = state === 'uncertain';
      expect(w.greeting()).toMatchObject({ state: { s: state }, canSend: open, canInsert: open, canGenerate: open });
      const other = greetingWorld(undefined, { background: w.background });
      await other.open();
      expect(other.greeting()).toMatchObject({ state: { s: state }, canSend: open, canInsert: open });
      // Nothing is sent again by itself: one click so far.
      expect(w.background.of('fansly.followers.send')).toHaveLength(1);
      if (state === 'sent') {
        expect(await other.controller.dispatch({ type: 'InsertNewcomerGreeting', targetHandle: other.handle(1) })).toMatchObject({ ok: false });
        expect(await other.send(1)).toMatchObject({ ok: false });
        expect(other.site.navigations).toHaveLength(0);
        expect(w.background.of('fansly.followers.send')).toHaveLength(1);
      } else {
        // «Отправить ещё раз» is the person's own new click: one more request.
        await other.send(1);
        expect(w.background.of('fansly.followers.send')).toHaveLength(2);
      }
    }
  });

  it('[FS-NEW-3] a greeting whose outcome is unknown says so in the list as the window opens — before its card is opened, never «Не писали»; one that went is «Отправлено»', async () => {
    const w = greetingWorld([wireRow(1), wireRow(2), wireRow(3)]);
    w.background.attempts.set(fan(2), { attemptId: uuid(0xb1), fanRef: fan(2), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' });
    w.background.attempts.set(fan(3), { attemptId: uuid(0xb2), fanRef: fan(3), state: 'requestStarted' });
    await w.open();
    // Only the first fan's card is open; the others' words come from the kept attempts.
    expect(w.background.of('fansly.followers.draft')).toHaveLength(1);
    expect(w.vm().rows.map((row) => row.greeting.s)).toEqual(['none', 'stopped', 'stopped']);
    // The card says the same once opened, and lets the person send again by their own click.
    await w.pick(2);
    expect(w.greeting()).toMatchObject({ state: { s: 'uncertain' }, canSend: false, canGenerate: true });
    expect(w.background.of('fansly.followers.send')).toHaveLength(0);
  });

  it('[FS-NEW-3] a background refusal because another tab already sent keeps the native-insert ban; an unknown outcome there holds nothing', async () => {
    for (const code of ['CG-SEND-UNCERTAIN', 'CG-SEND-PART'] as const) {
      const w = greetingWorld();
      await w.open();
      await w.type(1, 'Hi!');
      w.background.sendAnswer = () => ({ ok: false, error: { code } });
      await w.send(1);
      const sent = code === 'CG-SEND-PART';
      expect(w.greeting()).toMatchObject({ state: { s: sent ? 'sent' : 'uncertain' }, canSend: !sent, canInsert: !sent });
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
      // Unknown: said, never sent again by itself — the person may check the chat and send again.
      expect(w.greeting()).toMatchObject({ state: { s: 'uncertain' }, canSend: true, canInsert: true });
      await w.controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } });
      await w.open();
      expect(w.greeting()).toMatchObject({ state: { s: 'uncertain' } });
      w.background.attempts.set(fan(1), { attemptId: click.attemptId, fanRef: fan(1), state: 'sent', proof: 'resolved-sent' });
      w.background.reconnect();
      await settle();
      expect(w.greeting()).toMatchObject({ state: { s: 'sent' }, canSend: false, canInsert: false });
      expect(w.background.of('fansly.followers.send')).toHaveLength(1);
    }
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
      fanAccount: { username: 'fan_1', displayName: 'Fan 1' },
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

  it('[NF-014] before the hub is asked: a fan whose history the pass has not read to its start gets no generation', async () => {
    const w = greetingWorld([wireRow(1, { status: 'ready', historyRevision: null })]);
    await w.open();
    await w.pick(1);
    expect(w.card()?.check).toBe('unverified');
    expect(w.greeting()).toMatchObject({ waiting: true, canGenerate: false, canSend: false });
    expect(await w.generate(1)).toMatchObject({ ok: false, code: 'CG-DATA-NOT-READY' });
    expect(w.tab.started).toEqual([]);
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
      // No draft came of it: «Черновик не создан», never «Не отправлено» (nothing was sent).
      expect(v.greeting()).toMatchObject({ text: '', ai: false, state: { s: 'not-drafted', failure: { code: 'CG-OUTPUT-UNUSABLE' } } });
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

  it('[X69] [NF-018] a freshness warning is advisory, and a history that changed after the AI draft is a note: the draft goes on the history the card shows (as the old window)', async () => {
    const w = greetingWorld();
    await w.open();
    const run = w.generate(1);
    await settle();
    w.marks.set(uuid(0xc1), 'unverified');
    w.tab.done(uuid(0xc1), ['Hey Fan 1!']);
    await run;
    await settle();
    expect(w.greeting()).toMatchObject({ mark: 'unverified', canSend: true });
    w.background.change(w.background.last().view.passId, [wireRow(1, { historyRevision: uuid(0x777) })]);
    await settle();
    expect(w.greeting()).toMatchObject({ canSend: true, sendBlocked: null, stale: true, ai: true });
    await w.send(1);
    expect(w.background.of('fansly.followers.send')).toMatchObject([{ text: 'Hey Fan 1!', historyRevision: uuid(0x777), admission: { kind: 'ai' } }]);
  });

  it('[NF-018] [NF-024] [NF-023] the background’s refusal names its reason and nothing is repeated by itself — the history changed between the click and the send, a colleague’s lease, an unknown outcome; a second click while one runs is busy', async () => {
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
    expect(w.greeting()).toMatchObject({ state: { s: 'uncertain', failure: { code: 'CG-SEND-UNCERTAIN' } }, canSend: true });
    // Unknown: never sent again by itself; «Отправить ещё раз» is the person's own click.
    expect(w.background.of('fansly.followers.send')).toHaveLength(3);
    await w.send(1);
    expect(w.background.of('fansly.followers.send')).toHaveLength(4);

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

describe('[host:fansly] «Новые» on Fansly: a batch generated for many, each draft sent by its own click in the list (X59)', () => {
  /** Three ready fans, a batch of Hi for all of them, each generation done: their drafts wait in the list. */
  async function batchReady(rows: FanslyFollowerRow[] = [wireRow(1), wireRow(2), wireRow(3)]) {
    const w = greetingWorld(rows);
    await w.open();
    const handles = rows.map((_, at) => w.handle(at + 1));
    await w.controller.dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: handles, picked: true });
    await w.controller.dispatch({ type: 'GenerateBatch', list: 'newcomers' });
    await settle();
    for (const [at] of rows.entries()) w.tab.done(uuid(0xc1 + at), [`Hey Fan ${at + 1}!`]);
    await settle();
    expect(w.vm().rows.map((row) => row.batch?.state)).toEqual(rows.map(() => 'ready'));
    w.tab.tokens.length = 0;
    return w;
  }
  const sentTo = (w: Awaited<ReturnType<typeof batchReady>>): string[] => w.background.of('fansly.followers.send').map((payload) => (payload as { fanRef: string }).fanRef);

  it('[X59] [NF-019] a row with the batch’s draft has its own «Отправить»: one click sends that fan’s draft — the card’s send, without opening the card; the row says it went', async () => {
    const w = await batchReady();
    expect(w.vm().rows.map((row) => row.send)).toEqual([{ can: true, refused: null }, { can: true, refused: null }, { can: true, refused: null }]);
    // The card shows fan 1; fan 2 is sent from its row.
    expect(w.card()?.handle).toBe(w.handle(1));
    expect(await w.send(2)).toMatchObject({ ok: true });
    expect(sentTo(w)).toEqual([fan(2)]);
    expect(w.tab.tokens).toEqual(['send']);
    const sends = w.background.of('fansly.followers.send') as { admission: { kind: string }; text: string }[];
    expect(sends.map((send) => [send.admission.kind, send.text])).toEqual([['ai', 'Hey Fan 2!']]);
    expect(w.card()?.handle).toBe(w.handle(1));
    const row = w.vm().rows[1];
    expect([row?.greeting.s, row?.batch?.state, row?.send]).toEqual(['greeted', 'sent', undefined]);
    // Nothing else went: each fan is its own click.
    await w.clock.advance(600_000);
    expect(sentTo(w)).toEqual([fan(2)]);
    // Sent: never again.
    expect(await w.send(2)).toMatchObject({ ok: false, code: 'CG-SEND-PART' });
  });

  it('[X59] [NF-024] [NF-018] a row whose draft cannot go as it is says so: the click is refused with its reason, nothing went; the draft stays', async () => {
    const w = await batchReady();
    w.background.sendAnswer = () => ({ ok: false, error: { code: 'CG-FNEW-HISTORY' } });
    expect(await w.send(3)).toMatchObject({ ok: false });
    expect(w.vm().rows[2]?.send).toEqual({ can: true, refused: { code: 'CG-FNEW-HISTORY', retryAt: null } });
    expect(w.vm().rows[2]?.batch).toMatchObject({ state: 'ready', text: 'Hey Fan 3!' });
    // X69: the row uses the same send policy as the card; an AI warning does not require an edit.
    const marked = greetingWorld([wireRow(1)]);
    await marked.open();
    await marked.controller.dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [marked.handle(1)], picked: true });
    await marked.controller.dispatch({ type: 'GenerateBatch', list: 'newcomers' });
    await settle();
    marked.marks.set(uuid(0xc1), 'unverified');
    marked.tab.done(uuid(0xc1), ['Hey!']);
    await settle();
    expect(marked.vm().rows[0]?.send).toEqual({ can: true, refused: null });
    expect(marked.background.of('fansly.followers.send')).toHaveLength(0);
    expect(await marked.send(1)).toMatchObject({ ok: true });
    expect(marked.background.of('fansly.followers.send')[0]).toMatchObject({ text: 'Hey!', admission: { kind: 'ai', generationRef: GEN } });
  });
});
