// The isolated half of the R20 P7a/P7c harness, injected by a WebDriver BiDi
// preload script into a SANDBOX realm of the Fansly stand page (Firefox gives
// it Xray access to the page, as an isolated content script has), connected
// to the MAIN world of the test build. Two consumers, chosen before the page
// loads (`globalThis.__cgFanslyTapConsumer`, support/fansly-tap.ts):
// - `raw` (P7a): the shared client of host-kit over Fansly's schemas
//   (`connectFanslyMain`) and a consumer of MAIN's stream the spec drives —
//   it asks `fx.state`, acknowledges every batch (or none: a blocked
//   consumer) and keeps what came;
// - `port` (P7c): Fansly's own start (`startFanslyTab`), exactly as the
//   extension's isolated script starts it — the route by signals, the
//   anchors' observers, Fansly's HostPort over the stream — and what the port
//   says: its route, identity, accounts, composer, header slot, report and
//   counts. And its writes (P7e): the insert built the way the dock builds
//   it, «Открыть и вставить», the insertion record; the background's
//   `token.redeem` is a stand-in that says yes unless the spec turns it off.
//   And the person's sends the port linked to a draft (P7f, `humanSend`: ids,
//   digests, the draft's link — no text). Texts only of the spec's own drafts.
//   Over that port, the vault's uploader (R20 P13a,
//   `@cg/host-fansly/isolated/vault`) as the vault's panel will run it: a run
//   of files the spec names, its checkpoints kept here in memory.
// Every frame from MAIN passed the three stages of checks first; a frame that
// did not is in the client's counts.
//
// The spec drives it through `globalThis.__cgFanslyTap.call(method, argsJson)`.
// Nothing here talks to the network; the e2e network trap would catch it.

import type { FanslyBatch, FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { HostEvent, HumanSendFact, InsertIntent, InsertReceipt, InsertWire, NavigationReceipt } from '@cg/contracts/host';
import type { DraftSnapshot, HostIdentity } from '@cg/contracts/ids';
import { connectFanslyMain, startFanslyTab, type FanslyDiagnostic, type FanslyMainBridgeClient, type FanslyPort, type StartedFanslyTab } from '@cg/host-fansly/isolated';
import * as validation from '@cg/host-fansly/isolated/validation';
import { createVaultRun, createVaultUploader, vaultTargetOf, type VaultCheckpointStore, type VaultRun, type VaultUploader } from '@cg/host-fansly/isolated/vault';

/** How long the handshake waits: MAIN may come late (the late-install case). */
const HANDSHAKE_MS = 60_000;

const consumer = (globalThis as { readonly __cgFanslyTapConsumer?: unknown }).__cgFanslyTapConsumer === 'port' ? 'port' : 'raw';
const load = (): Promise<typeof validation> => Promise.resolve(validation);

const batches: FanslyBatch[] = [];
const gaps: unknown[] = [];
const faults: unknown[] = [];
let acking = true;
let client: FanslyMainBridgeClient | null = null;
let failure: string | null = null;
let states = 0;

// ── raw: P7a's consumer ──

if (consumer === 'raw') {
  connectFanslyMain(window, load, HANDSHAKE_MS).then(
    (connected) => {
      client = connected;
      connected.onEvent((event) => {
        if (event.t === 'fx.batch') {
          batches.push(event.payload);
          if (acking) connected.request('fx.ack', { n: event.payload.n }).catch((error: unknown) => (failure = `ack: ${String(error)}`));
        } else if (event.t === 'fx.gap') gaps.push(event.payload);
        else faults.push(event.payload);
      });
      // The stream starts with the isolated side's first `fx.state`.
      connected.request('fx.state', {}).then(
        () => (states += 1),
        (error: unknown) => (failure = `fx.state: ${String(error)}`),
      );
    },
    (error: unknown) => (failure = String(error)),
  );
}

// ── port: Fansly's own start (P7c) ──

let started: StartedFanslyTab | null = null;
let port: FanslyPort | null = null;
/** What the port said, in order: the event's type and, for a route, its epoch and group — no text, no fan. */
const said: Array<{ readonly type: HostEvent['type']; readonly epoch?: number; readonly group?: string | null }> = [];
/** The person's sends the port linked (P7f): what the tab would report (`op.reportSent`). */
const humanSends: HumanSendFact[] = [];
const diagnostics: FanslyDiagnostic[] = [];
const TOKEN = 'tok_e2e_fansly_harness_0';
let redeemAllowed = true;
const redeemed: string[] = [];
let navInsertTimeoutMs: number | undefined;

if (consumer === 'port') {
  started = startFanslyTab({
    win: window,
    validation: load,
    redeem: (request) => {
      redeemed.push(request.kind);
      return Promise.resolve(redeemAllowed);
    },
    navInsertTimeoutMs: () => navInsertTimeoutMs,
    handshakeTimeoutMs: HANDSHAKE_MS,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  void started.bridge.then((connected) => {
    client = connected;
    if (connected === null) failure = 'no MAIN';
  });
  started.host.then(
    (ready) => {
      port = ready;
      ready.subscribe((event) => {
        said.push(event.type === 'route' ? { type: 'route', epoch: event.route.epoch, group: event.route.conversationRef ?? null } : { type: event.type });
        if (event.type === 'humanSend') humanSends.push(event.fact);
      });
    },
    (error: unknown) => (failure = String(error)),
  );
}

// ── the vault's uploader over the port (P13a) ──

let vaultUploader: VaultUploader | null = null;
let vaultRun: VaultRun | null = null;
/** Every checkpoint the run wrote, in order, and the uploads it cleared — the background's part, here in memory. */
const vaultSaves: VaultCheckpoint[] = [];
const vaultClears: string[] = [];
const vaultStore: VaultCheckpointStore = {
  load: (target) => Promise.resolve([...vaultSaves].reverse().find((saved) => saved.hostAccountId === target.hostAccountId && saved.albumId === target.albumId) ?? null),
  save: (checkpoint) => {
    vaultSaves.push(checkpoint);
    return Promise.resolve(true);
  },
  clear: (_target, uploadId) => {
    vaultClears.push(uploadId);
    return Promise.resolve(true);
  },
};
const vault = (): VaultUploader => (vaultUploader ??= createVaultUploader({ win: window, port: needPort() }));

const need = (): FanslyMainBridgeClient => {
  if (client === null) throw new Error(`not connected to MAIN${failure === null ? '' : `: ${failure}`}`);
  return client;
};
const needPort = (): FanslyPort => {
  if (port === null) throw new Error(`no host port${failure === null ? '' : `: ${failure}`}`);
  return port;
};

/** What the spec says about one insert; the rest is filled in the way the dock's insert service does. */
interface InsertOptions {
  readonly text: string;
  readonly mode?: 'replace' | 'append';
  /** One-time consent for the draft read just now (Б2). */
  readonly confirm?: boolean;
  /** A draft read earlier (`snapshotDraft`): its identity, revision and digest — a stale CAS. */
  readonly from?: DraftSnapshot;
  readonly ttlMs?: number;
  /** Hold the intent this long before handing it over (an expired intent). */
  readonly holdMs?: number;
  /** The neighbour's widget clicked in the microtask right after our write's `input`: its write inside our check. */
  readonly follower?: 'templates' | 'emoji';
}

const FIELD = 'app-messages-conversation-route > app-group-message-container > app-group-message-input textarea.message-input';
const NEIGHBOUR_WIDGETS = { templates: 'fb-text-templates-ui', emoji: 'fb-emoji-picker-ui' } as const;

const identityNow = (): HostIdentity => {
  const identity = needPort().identity();
  if (identity === null) throw new Error('no identity');
  return identity;
};

function buildIntent(draft: DraftSnapshot, options: InsertOptions): InsertIntent {
  const base = draft.identity;
  if (base.chat === null || base.composerInstanceId === null) throw new Error('no open field');
  const now = Date.now();
  return {
    intentId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    part: { index: 0 },
    target: base.chat,
    expected: { kind: 'open', documentEpoch: base.documentEpoch, routeEpoch: base.routeEpoch, composerInstanceId: base.composerInstanceId, draftRevision: draft.revision, draftDigest: draft.digest },
    mode: options.mode ?? 'replace',
    text: options.text,
    confirmationId: options.confirm === true ? crypto.randomUUID() : null,
    createdAt: now,
    expiresAt: now + (options.ttlMs ?? 20_000),
    cause: { kind: 'click', actionToken: TOKEN },
  };
}

/** Clicks the neighbour's widget on the main composer (its open shadow root): its own write, through its own button. */
function clickNeighbour(widget: 'templates' | 'emoji'): void {
  const host = document.querySelector(`app-messages-conversation-route app-group-message-input ${NEIGHBOUR_WIDGETS[widget]}`);
  const button = host?.shadowRoot?.querySelector('button');
  if (button === null || button === undefined) throw new Error(`no ${widget} widget of the neighbour on the main composer`);
  button.click();
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
/** The inbox row's link of a group (the person's click). */
const clickRow = (groupId: string): void => {
  const link = document.querySelector<HTMLElement>(`.messages-list-wrapper a[href="/messages/${groupId}"]`);
  if (link === null) throw new Error(`the inbox row of ${groupId} is not rendered`);
  link.click();
};

const navigations = new Map<string, NavigationReceipt | 'pending'>();
let raceSkipped = 0;

const methods: Record<string, (...args: never[]) => unknown> = {
  ready: () => ({ connected: client !== null, started: consumer === 'port' ? port !== null : states > 0, failure }),
  probe: () => need().probe(),
  state: (): Promise<FanslyState> => need().request('fx.state', {}).finally(() => (states += 1)),
  health: (): Promise<FanslyHealth> => need().request('fx.health', {}),
  /** The events of every batch so far, from the `from`-th on, each with its batch's number. */
  events: (from = 0) => batches.flatMap((batch) => batch.events.map((event) => ({ n: batch.n, t: event.t, p: event.p }))).slice(from),
  batches: () => batches.map((batch) => ({ n: batch.n, events: batch.events.length })),
  gaps: () => gaps,
  faults: () => faults,
  setAcking: (on: boolean) => {
    acking = on;
    return acking;
  },
  ack: (n: number) => need().request('fx.ack', { n }),
  /** The isolated side's route (P7b): MAIN answers with `fx.chat` of the group. */
  focus: (groupId: string | null, routeEpoch: number) => need().request('fx.focus', { groupId, routeEpoch }),
  windowMeta: (groupId: string) => need().request('fx.windowMeta', { groupId }),
  /** A generation snapshot as a click asks it (§5.8), with the round trip the isolated side sees. */
  snapshot: async (request: { groupId: string; feature: 'reply' | 'hi' | 'recap'; window: number; withText: boolean }) => {
    const started = performance.now();
    const snapshot = await need().request('fx.generationSnapshot', request);
    return { snapshot, roundTripMs: performance.now() - started };
  },
  /** What the client dropped: frames refused at its first two stages, events and answers its schemas refused. */
  stats: () => need().stats(),

  // ── the port (P7c) ──
  /** What the port says now: route, identity, accounts, the composer's shape, the header slot, the anchors found. */
  port: () => {
    const now = needPort().current();
    const anchors = started?.anchors.current();
    return {
      route: now.route,
      identity: now.identity,
      accounts: now.accounts,
      composer: now.composer === null ? null : { instanceId: now.composer.instanceId, ready: now.composer.ready, hidden: now.composer.hidden },
      slot: needPort().fansly.headerSlot(),
      anchors: {
        conversation: Boolean(anchors?.conversation),
        container: Boolean(anchors?.conversation?.container),
        textarea: Boolean(anchors?.conversation?.textarea),
        gallery: anchors?.conversation?.gallery === true,
      },
    };
  },
  /** Where Fansly's start put our dock host (P7d): its moves and removals, and the mount points the port says. */
  dock: () => ({ stats: started?.mounts.stats() ?? null, points: needPort().mounts() }),
  report: () => needPort().probe(),
  portHealth: () => needPort().health(),
  /** A verification without a signal, as an action of our UI makes one (FS-RTE-3); the route's counts after it. */
  verify: () => {
    started?.route.verify('ui');
    return started?.route.stats() ?? null;
  },
  said: (from = 0) => said.slice(from),
  /** The open chat's generation snapshot through the port, as a click asks it — its shape only, never a text. */
  portSnapshot: async (feature: 'reply' | 'recap', withText: boolean) => {
    const now = needPort().current().route;
    if (now.chat === null || now.conversationRef === undefined) return null;
    const snapshot = await needPort().freshness.snapshot(now.chat, { conversationRef: now.conversationRef, feature, window: 60, withText });
    return snapshot === null
      ? null
      : { feature: snapshot.feature, group: snapshot.identity.groupId, fan: snapshot.identity.fanId, completeness: snapshot.completeness, window: snapshot.window.length, tail: snapshot.tail?.length ?? null };
  },
  diagnostics: () => diagnostics,
  activation: async () => ({ ready: await started?.activation.ready, stopped: started?.activation.stopped.aborted }),

  // ── the writes (P7e) ──
  /** The open field's draft as the port reads it, with the identity it was read under. */
  snapshotDraft: (): Promise<DraftSnapshot> => needPort().readDraft(identityNow()),
  async insert(options: InsertOptions): Promise<InsertReceipt> {
    const intent = buildIntent(options.from ?? (await needPort().readDraft(identityNow())), options);
    if (options.holdMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.holdMs));
    const follower = options.follower;
    if (follower !== undefined) document.querySelector(FIELD)?.addEventListener('input', () => queueMicrotask(() => clickNeighbour(follower)), { once: true });
    return needPort().insert(intent);
  },
  focusComposer: () => needPort().focusComposer(identityNow()),
  setRedeem(allowed: boolean) {
    redeemAllowed = allowed;
    return allowed;
  },
  redeemed: () => redeemed,
  setNavInsertTimeout(ms: number | null) {
    navInsertTimeoutMs = ms ?? undefined;
    return ms;
  },
  /** «Открыть и вставить» (with `text`) or a plain opening of a group's fan; its receipt later by `navigation(id)`. */
  navigate(options: { readonly group: string; readonly fan: string; readonly text?: string; readonly ttlMs?: number; readonly abortAfterMs?: number }) {
    const id = crypto.randomUUID();
    const port = needPort();
    const creator = port.current().accounts[0]?.hostAccountId ?? '';
    const now = Date.now();
    const controller = new AbortController();
    if (options.abortAfterMs !== undefined) setTimeout(() => controller.abort(), options.abortAfterMs);
    const thenInsert: InsertWire | undefined =
      options.text === undefined
        ? undefined
        : {
            intentId: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            part: { index: 0 },
            target: { host: 'fansly-web', hostAccountId: creator, platformFanId: options.fan },
            expected: { kind: 'deferred', documentEpoch: port.identity()?.documentEpoch ?? 'none' },
            mode: 'replace',
            text: options.text,
            confirmationId: null,
            createdAt: now,
            expiresAt: now + (options.ttlMs ?? 20_000),
          };
    navigations.set(id, 'pending');
    void port
      .navigate({ intentId: id, cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: creator, platformFanId: options.fan, conversationRef: options.group }, ...(thenInsert === undefined ? {} : { thenInsert }) }, { signal: controller.signal })
      .then((receipt) => navigations.set(id, receipt));
    return id;
  },
  navigation: (id: string) => navigations.get(id) ?? null,
  /** The record of our last write (no text: digests and ids) and the draft as a send would carry it. */
  insertion: () => ({ record: needPort().insertion(), sent: needPort().sentDraft() }),
  /** The person's sends the port linked to a draft (P7f), from the `from`-th on. */
  humanSends: (from = 0) => humanSends.slice(from),
  /**
   * The race (§12 «200 быстрых переключений»): an insert aimed at the open chat goes out unawaited; the person clicks
   * another chat's inbox row first (every third time), or a microtask, a frame or two frames into the insert's way.
   * Every receipt with the group it was aimed at.
   */
  async race(options: { readonly n: number; readonly groups: readonly string[] }) {
    const results: Array<Promise<{ group: string; text: string; receipt: InsertReceipt | { readonly state: 'error'; readonly code: string } }>> = [];
    let skipped = 0;
    const port = needPort();
    for (let i = 0; i < options.n; i += 1) {
      const current = port.identity();
      const group = port.current().route.conversationRef ?? null;
      const draft = current !== null && current.composerInstanceId !== null ? await port.readDraft(current).catch(() => null) : null;
      const next = options.groups[(options.groups.indexOf(group ?? '') + 1 + (i % 2)) % options.groups.length] ?? options.groups[0] ?? '';
      if (i % 4 === 0) clickRow(next);
      if (group !== null && draft !== null) {
        const text = `R${i}@${group}`;
        results.push(
          port.insert(buildIntent(draft, { text, confirm: true })).then(
            (receipt) => ({ group, text, receipt }),
            (error: unknown) => ({ group, text, receipt: { state: 'error' as const, code: String(error) } }),
          ),
        );
      } else skipped += 1;
      if (i % 4 === 1) await Promise.resolve();
      for (let f = 1; f < i % 4; f += 1) await frame();
      if (i % 4 !== 0) clickRow(next);
      // The port catches up with the switch (a few frames at most), so the next insert has a fresh identity.
      for (let f = 0; f < 40; f += 1) {
        const seen = port.identity();
        if (port.current().route.conversationRef === next && seen?.composerInstanceId) break;
        await frame();
      }
    }
    raceSkipped = skipped;
    return Promise.all(results);
  },
  raceSkipped: () => raceSkipped,

  // ── the vault (P13a) ──
  /** What the uploader reads of the page: the account, the open album's id and title, the uploader, the cards. */
  vaultView: () => vault().view(),
  /** Starts a run of files by these names (a few bytes each, of `type`) into the album open now; false — no album or account. */
  vaultStart: (names: readonly string[], type = 'image/jpeg') => {
    const target = vaultTargetOf(vault().view());
    if (target === null) return { started: false, target };
    const files = names.map((name) => new File([`stand ${name}`], name, { type }));
    vaultRun = createVaultRun({ target, files, checkpoint: null }, { uploader: vault(), store: vaultStore });
    vaultSaves.splice(0);
    vaultClears.splice(0);
    void vaultRun.start();
    return { started: true, target };
  },
  /** The run, its checkpoints as [confirmed, pending], what it cleared, and what the uploader watches. */
  vaultState: () => ({
    run: vaultRun?.snapshot() ?? null,
    checkpoints: vaultSaves.map((saved) => [saved.confirmed, saved.pending?.index ?? null]),
    clears: vaultClears.length,
    stats: vault().stats(),
    album: needPort().vault.album(),
  }),
  vaultStop: () => vaultRun?.stop() ?? null,
  vaultResolve: (answer: 'present' | 'missing') => vaultRun?.resolve(answer) ?? false,
};

Object.defineProperty(globalThis, '__cgFanslyTap', {
  value: {
    call: async (method: string, argsJson: string): Promise<string> => {
      const fn = methods[method];
      if (fn === undefined) throw new Error(`no harness method ${method}`);
      const result: unknown = await fn(...(JSON.parse(argsJson) as never[]));
      return JSON.stringify(result ?? null);
    },
  },
});
