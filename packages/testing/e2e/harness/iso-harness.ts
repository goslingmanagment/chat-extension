// Isolated half of the R09 e2e harness, injected by a WebDriver BiDi preload
// script into a SANDBOX realm of the page (Firefox gives it Xray access to the
// DOM, like an isolated content script): the bridge client, the mount manager
// and the HostPort of @cg/host-chatspace/isolated, started exactly the way a
// composition root would start them (`startChatSpaceHost`). The spec drives
// it through `globalThis.__cgHarness.call(method, argsJson)`.
//
// The action-token redeemer is a stand-in for the background's `token.redeem`
// (it says yes unless the spec turns it off). Nothing here talks to the
// network; the e2e network trap would catch it.

import type { HostEvent, InsertIntent, InsertReceipt, NavigationReceipt } from '@cg/contracts/host';
import type { HostIdentity, Target } from '@cg/contracts/ids';
import type { FreshnessCheckpoint, PreviewSendCommit, PreviewSendPreflight, PreviewSendRequest, SendAttemptView } from '@cg/contracts/send';
import { ADAPTER_VERSION, aiGeneratedMark, loadValidation, loadedScriptUrls, receiptModules, startChatSpaceHost, type ChatSpaceHostPort, type ChatSpaceLiveConfig, type OverlayLayer } from '@cg/host-chatspace/isolated';

const TOKEN = 'tok_e2e_harness_0000';
let redeemAllowed = true;
const redeemed: string[] = [];
const diagnostics: unknown[] = [];
const events: Record<string, number> = {};
/** Facts of the live side as they came: incoming messages, coverage, human sends (never a text). */
const liveEvents: HostEvent[] = [];
/** Every state MAIN reported per preview send attempt, in order. */
const sendStates: Record<string, SendAttemptView[]> = {};
let host: ChatSpaceHostPort | null = null;

const started = startChatSpaceHost({
  win: window,
  validation: loadValidation,
  redeem: (request) => {
    redeemed.push(request.kind);
    return Promise.resolve(redeemAllowed);
  },
  drafts: { getItem: (key) => window.localStorage.getItem(key) },
  navInsertTimeoutMs: 20_000,
  onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
});
void started.host.then((port) => {
  host = port;
  port.subscribe((event) => {
    events[event.type] = (events[event.type] ?? 0) + 1;
    if (event.type === 'incoming' || event.type === 'coverage' || event.type === 'humanSend') liveEvents.push(event);
  });
});

const need = (): ChatSpaceHostPort => {
  if (!host) throw new Error('host not ready');
  return host;
};
const identity = (): HostIdentity => {
  const current = need().identity();
  if (!current) throw new Error('no identity');
  return current;
};
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

interface InsertOptions {
  readonly text: string;
  readonly mode?: 'replace' | 'append';
  /** Give one-time consent for the draft revision read just now. */
  readonly confirm?: boolean;
  /** Take the revision and digest from an earlier draft read (a stale CAS). */
  readonly from?: { readonly revision: number; readonly digest: string; readonly identity: HostIdentity };
  readonly ttlMs?: number;
  /** Hold the intent this long before handing it over (an expired intent). */
  readonly holdMs?: number;
}

function buildIntent(base: HostIdentity, draft: { readonly revision: number; readonly digest: string }, options: InsertOptions): InsertIntent {
  if (!base.chat || !base.composerInstanceId) throw new Error('no open composer');
  const now = Date.now();
  return {
    intentId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    part: { index: 0 },
    target: base.chat,
    expected: { kind: 'open', documentEpoch: base.documentEpoch, routeEpoch: base.routeEpoch, composerInstanceId: base.composerInstanceId, draftRevision: draft.revision, draftDigest: draft.digest },
    mode: options.mode ?? 'replace',
    text: options.text,
    confirmationId: options.confirm ? crypto.randomUUID() : null,
    createdAt: now,
    expiresAt: now + (options.ttlMs ?? 20_000),
    cause: { kind: 'click', actionToken: TOKEN },
  };
}

async function intentFor(options: InsertOptions): Promise<InsertIntent> {
  const base = options.from?.identity ?? identity();
  return buildIntent(base, options.from ?? (await need().readDraft(base)), options);
}

/** What the spec says about one preview send; the rest is filled in the way a controller would. */
interface SendOptions {
  readonly acc: string;
  readonly fan: string;
  readonly platformAccountId: string;
  readonly text: string;
  readonly attemptId?: string;
  /** The checkpoint of Generate; taken now when absent. */
  readonly checkpoint?: FreshnessCheckpoint;
  /** The AI part the text came from (the mark is ChatSpace's own rule against it); the text itself by default. */
  readonly original?: string;
  readonly part?: number;
  /** The hub ticket's lifetime from now, ms. */
  readonly ticketMs?: number;
  /** Skip the preflight (a click on a button that was ready a moment ago). */
  readonly skipPreflight?: boolean;
}

/** A synthetic hub binding: the adapter never sends it to MAIN (the spec checks that nothing of it reaches the page). */
const targetOf = (options: SendOptions): Target => ({
  binding: { hubOrigin: 'https://hub.example.test', principalId: 7, loginEpoch: 1, host: 'chatspace', hostAccountId: options.acc, platform: 'onlyfans', platformAccountId: options.platformAccountId, pageId: 11, pageLabel: 'stand-page', bindingRevision: 1 },
  chat: { host: 'chatspace', hostAccountId: options.acc, platformFanId: options.fan },
  fanRef: options.fan,
  conversationRef: options.fan,
});

async function sendRequest(options: SendOptions): Promise<PreviewSendRequest | null> {
  const checkpoint = options.checkpoint ?? (await need().checkpoint({ host: 'chatspace', hostAccountId: options.acc, platformFanId: options.fan }));
  if (!checkpoint) return null;
  return {
    attemptId: options.attemptId ?? crypto.randomUUID(),
    target: targetOf(options),
    generationRef: crypto.randomUUID(),
    part: { index: options.part ?? 0 },
    previewRevision: 0,
    plainText: options.text,
    isAiGenerated: aiGeneratedMark(options.text, options.original ?? options.text),
    checkpoint,
    cause: { kind: 'click', actionToken: TOKEN },
  };
}

/** Iterations of the last race that had no identity to aim an insert at. */
let racesSkipped = 0;
const navigations = new Map<string, Promise<NavigationReceipt>>();
const settledNavigations = new Map<string, NavigationReceipt>();

const api = {
  async ready(timeoutMs = 10_000) {
    const port = await Promise.race([started.host, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
    return { ready: port !== null, connected: (await started.bridge) !== null };
  },
  async probe() {
    const bridge = await started.bridge;
    return bridge ? bridge.probe() : null;
  },
  state() {
    const port = need();
    const snapshot = port.current();
    return {
      identity: snapshot.identity,
      route: snapshot.route,
      composer: snapshot.composer,
      accounts: snapshot.accounts,
      contract: snapshot.contract,
      mounts: snapshot.mounts,
      theme: { scheme: snapshot.theme.scheme, tokens: Object.keys(snapshot.theme.tokens).length, fixedWidth: snapshot.theme.fixedWidth },
      events: { ...events },
      redeemed: [...redeemed],
      diagnostics: [...diagnostics],
    };
  },
  async stats() {
    return (await started.bridge)?.stats() ?? null;
  },
  async recheck() {
    return need().recheck();
  },
  async draft() {
    return need().readDraft(identity());
  },
  async insert(options: InsertOptions): Promise<InsertReceipt> {
    const intent = await intentFor(options);
    if (options.holdMs) await new Promise((resolve) => setTimeout(resolve, options.holdMs));
    return need().insert(intent);
  },
  /** A draft read kept for a later, possibly stale, insert. */
  async snapshotDraft() {
    const base = identity();
    const draft = await need().readDraft(base);
    return { revision: draft.revision, digest: draft.digest, identity: base };
  },
  async focus() {
    return need().focusComposer(identity());
  },
  setRedeem(allowed: boolean) {
    redeemAllowed = allowed;
    return allowed;
  },
  navigate(options: { readonly acc: string; readonly fan: string | null; readonly text?: string; readonly ttlMs?: number; readonly abortAfterMs?: number }) {
    const id = crypto.randomUUID();
    // The extension gives the insert up meanwhile (sign-out, persona or binding change, §6.5).
    const controller = new AbortController();
    if (options.abortAfterMs !== undefined) setTimeout(() => controller.abort(), options.abortAfterMs);
    const now = Date.now();
    const then =
      options.text !== undefined && options.fan !== null
        ? {
            intentId: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            part: { index: 0 },
            target: { host: 'chatspace' as const, hostAccountId: options.acc, platformFanId: options.fan },
            expected: { kind: 'deferred' as const, documentEpoch: need().identity()?.documentEpoch ?? 'none' },
            mode: 'replace' as const,
            text: options.text,
            confirmationId: null,
            createdAt: now,
            expiresAt: now + (options.ttlMs ?? 20_000),
          }
        : undefined;
    const pending = need().navigate({ intentId: id, cause: { kind: 'click', actionToken: TOKEN }, target: { hostAccountId: options.acc, platformFanId: options.fan }, ...(then ? { thenInsert: then } : {}) }, { signal: controller.signal });
    navigations.set(id, pending);
    void pending.then((receipt) => settledNavigations.set(id, receipt));
    return id;
  },
  navigation(id: string) {
    return settledNavigations.get(id) ?? 'pending';
  },
  tail(max: number) {
    return need().readVisibleTail(identity(), max);
  },
  chatWindow() {
    const chat = identity().chat;
    return chat ? need().chatWindow(chat, 200) : null;
  },
  fan(fanId: string) {
    const chat = identity().chat;
    return chat ? need().fan({ ...chat, platformFanId: fanId }) : null;
  },
  listChats(limit: number) {
    return need().listCachedChats(identity().hostAccountId, limit);
  },
  overlay(layer: OverlayLayer) {
    const overlay = started.mounts.overlay(layer);
    return { layer: overlay.host.getAttribute('data-cg-layer'), z: overlay.host.style.zIndex, inHtml: overlay.host.parentElement === document.documentElement };
  },
  dismissible(target: 'dock' | OverlayLayer, owner: string, open: boolean) {
    started.mounts.setDismissibleOpen(target, owner, open);
    return true;
  },
  /** Marks the dock's closed root so the spec can tell a moved host from a new one. */
  markDock() {
    const marker = document.createElement('span');
    marker.setAttribute('data-e2e', 'dock-marker');
    started.mounts.dock.root.append(marker);
    return true;
  },
  /** Gives the dock's content a height (what our UI does when it opens), or removes it (0). */
  growDock(px: number) {
    const root = started.mounts.dock.root;
    root.querySelector('[data-e2e="dock-growth"]')?.remove();
    if (px > 0) {
      const block = document.createElement('div');
      block.setAttribute('data-e2e', 'dock-growth');
      block.style.height = `${px}px`;
      root.append(block);
    }
    return started.mounts.dock.host.getBoundingClientRect().height;
  },
  // ── the live side (§6.6–§6.8): flags, checkpoint, preview send, facts ──

  /** The bootstrap's flags and receipt profiles, as the composition root would pass them. */
  async configure(config: ChatSpaceLiveConfig) {
    const report = await need().configure(config);
    return { capabilities: report.capabilities, anchors: report.anchors, adapterVersion: report.adapterVersion };
  },
  /** The fingerprints of the send-path modules this page has loaded: what a profile for this stand build must name. */
  receiptProfile() {
    return { id: 'stand', adapterVersion: ADAPTER_VERSION, modules: receiptModules(loadedScriptUrls(window), window.location.origin) };
  },
  previewSendAvailable() {
    return need().previewSend !== null;
  },
  checkpoint(acc: string, fan: string) {
    return need().checkpoint({ host: 'chatspace', hostAccountId: acc, platformFanId: fan });
  },
  async preflight(options: SendOptions): Promise<PreviewSendPreflight | { ok: false; code: 'no-port' | 'no-checkpoint' }> {
    const port = need().previewSend;
    if (!port) return { ok: false, code: 'no-port' };
    const request = await sendRequest(options);
    return request ? port.preflight(request) : { ok: false, code: 'no-checkpoint' };
  },
  /**
   * One click of «Отправить»: the preflight, then (the hub's dispatch is the
   * background's; here a ticket is simply at hand) the one queue call. Every
   * state MAIN observes afterwards is kept for `sendStates`.
   */
  async send(options: SendOptions): Promise<{ attemptId: string | null; preflight: PreviewSendPreflight | null; commit: PreviewSendCommit | null; reason?: string }> {
    const port = need().previewSend;
    if (!port) return { attemptId: null, preflight: null, commit: null, reason: 'no-port' };
    const request = await sendRequest(options);
    if (!request) return { attemptId: null, preflight: null, commit: null, reason: 'no-checkpoint' };
    const attemptId = request.attemptId;
    const preflight = options.skipPreflight ? null : await port.preflight(request);
    if (preflight && !preflight.ok) return { attemptId, preflight, commit: null };
    sendStates[attemptId] ??= [];
    port.onState(attemptId, (view) => sendStates[attemptId]?.push(view));
    const commit = await port.commit(request, { attemptId, ticket: 'stand-ticket', expiresAt: Date.now() + (options.ticketMs ?? 10_000) });
    return { attemptId, preflight, commit };
  },
  /** N clicks at once: the same attempt N times, or N attempts for N fans of one account. */
  async burst(options: SendOptions & { readonly n: number; readonly fans?: readonly string[] }) {
    const port = need().previewSend;
    if (!port) return [];
    const requests: PreviewSendRequest[] = [];
    if (options.fans) {
      for (const fan of options.fans) {
        const request = await sendRequest({ ...options, fan });
        if (request) requests.push(request);
      }
    } else {
      const request = await sendRequest(options);
      if (request) for (let i = 0; i < options.n; i += 1) requests.push(request);
    }
    for (const request of requests) {
      sendStates[request.attemptId] ??= [];
      if (sendStates[request.attemptId]?.length === 0) port.onState(request.attemptId, (view) => sendStates[request.attemptId]?.push(view));
    }
    return Promise.all(requests.map((request) => port.commit(request, { attemptId: request.attemptId, ticket: 'stand-ticket', expiresAt: Date.now() + 10_000 })));
  },
  sendStates(attemptId: string) {
    return sendStates[attemptId] ?? [];
  },
  liveEvents(type?: string) {
    return type === undefined ? liveEvents : liveEvents.filter((event) => event.type === type);
  },
  raceSkipped: () => racesSkipped,
  /**
   * A chat tab clicked while the route follows late (the stand's async router
   * guard): ChatSpace shows the new tab's composer at once, the route still
   * names the old chat. Every frame of that window does what a consumer
   * would — read the draft, «Проверить», aim an insert at the chat the
   * identity names — and records what it got.
   */
  async tabSwitchWindow(options: { readonly fan: string; readonly text: string; readonly maxSteps: number }) {
    const before = identity();
    document.querySelector<HTMLElement>(`[data-chat-tab="${options.fan}"] .chat-tab__label`)?.click();
    const steps: Array<{ routeChat: string | null; composer: string | null; read: string; receipt: InsertReceipt | null }> = [];
    for (let step = 0; step < options.maxSteps; step += 1) {
      const read = await need()
        .readDraft(before)
        .then(
          (draft) => `read:${draft.identity.composerInstanceId ?? 'none'}`,
          (error: unknown) => `refused:${(error as { failure?: string }).failure ?? 'error'}`,
        );
      await need().recheck();
      const now = need().identity();
      let receipt: InsertReceipt | null = null;
      if (now?.chat && now.composerInstanceId) {
        const draft = await need()
          .readDraft(now)
          .catch(() => null);
        if (draft) receipt = await need().insert(buildIntent(now, draft, { text: `${options.text}@${now.chat.platformFanId}` }));
      }
      steps.push({ routeChat: now?.chat?.platformFanId ?? null, composer: now?.composerInstanceId ?? null, read, receipt });
      if (now?.chat?.platformFanId === options.fan) break;
      await frame();
    }
    return { before: before.composerInstanceId, steps };
  },
  dockMarker() {
    return started.mounts.dock.root.querySelector('[data-e2e="dock-marker"]') !== null;
  },
  /**
   * The race (§12 п. 4 «200 быстрых переключений»): an insert aimed at the
   * open chat goes out unawaited, 0–2 frames pass, the person switches the
   * chat tab, a frame may pass. Returns every receipt with its target.
   */
  async race(options: { readonly n: number; readonly fans: readonly string[] }) {
    const results: Array<Promise<{ fan: string; text: string; receipt: InsertReceipt | { state: 'error' } }>> = [];
    let skipped = 0;
    for (let i = 0; i < options.n; i += 1) {
      const current = need().identity();
      const fan = current?.chat?.platformFanId ?? null;
      const draft = current && fan && current.composerInstanceId ? await need().readDraft(current).catch(() => null) : null;
      const next = options.fans[(options.fans.indexOf(fan ?? '') + 1 + (i % 2)) % options.fans.length] ?? options.fans[0] ?? '';
      const switchTab = (): void => document.querySelector<HTMLElement>(`[data-chat-tab="${next}"] .chat-tab__label`)?.click();
      // Every third time the person switches first and the insert for the chat being left follows at once.
      if (i % 3 === 0) switchTab();
      if (current && fan && draft) {
        const text = `R${i}@${fan}`;
        results.push(
          need()
            .insert(buildIntent(current, draft, { text }))
            .then(
              (receipt) => ({ fan, text, receipt }),
              () => ({ fan, text, receipt: { state: 'error' as const } }),
            ),
        );
      } else skipped += 1;
      // Otherwise 1 or 2 frames pass between the insert and the switch: MAIN writes, the switch follows mid-flight.
      if (i % 3 !== 0) {
        for (let f = 0; f < i % 3; f += 1) await frame();
        switchTab();
      }
      // Let the adapter catch up with the switch (a few frames at most), so the next insert has a fresh identity.
      for (let f = 0; f < 20; f += 1) {
        const seen = need().identity();
        if (seen?.chat?.platformFanId === next && seen.composerInstanceId) break;
        await frame();
      }
    }
    racesSkipped = skipped;
    return Promise.all(results);
  },
};

type Api = typeof api;
Object.defineProperty(globalThis, '__cgHarness', {
  value: {
    async call(method: keyof Api, argsJson: string): Promise<string> {
      const args = JSON.parse(argsJson) as unknown[];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to `api` itself
      const result: unknown = await (Reflect.apply(api[method], api, args) as unknown);
      return JSON.stringify(result ?? null);
    },
  },
});
