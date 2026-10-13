// FBuddy's isolated world, emulated from the page (S5 §2.2, §2.4, §6): it
// starts at `document_start`, announces itself, injects the page parts — the
// bridge, then the hook — by `<script src>`, asks its own `/account/me`, and
// only for a creator does its DOM work, its 10-s unread poll with the title
// refresh, and (for an organization) writes the restricted words and injects
// the guard. Through the bridge it receives every API answer the hook saw: it
// keeps a log of them (no bodies — a digest), parses each successful one again
// (its entity cache: the cost a real page carries), replays the recorded
// client headers on its own requests and counts the message logs an
// organization would send. `window.__fanslyNeighbor` is its test control.

import { announceStart, createBridge, type Bridge } from './bridge';
import { Translator, isToasterKey, resolveMod } from './composer';
import { NeighborDom } from './dom';
import type { GenericCounts } from './generic';
import type { GuardInstance } from './guard';
import type { MapPatchState } from './map-patch';
import { isMessagePost, type HookInstance } from './network-hook';
import { OwnRequests, TitleRefresh } from './own';
import { runBridge, runGuard, runHook, type PartFacts } from './parts';
import {
  BRIDGE_EVENTS,
  FBUDDY_IDS,
  FBUDDY_KEYS,
  NEIGHBOR_GLOBAL,
  RECORDED_HEADERS,
  type NeighborConfig,
  type NeighborControl,
  type NeighborNetworkEvent,
  type NeighborOwnRequest,
  type NeighborPart,
  type NeighborState,
  type NetworkEventPayload,
} from './protocol';
import { NeighborUi } from './ui';
import { digest } from './util';

type View = Window & typeof globalThis;

/** How a page part gets into the page: a `<script src>` in the browser, inline in a DOM test. */
export type Injector = (part: Exclude<NeighborPart, 'boot'>, facts: PartFacts, options: { readonly id: string; readonly keep: boolean }) => Promise<void>;

export interface IsolatedOptions {
  readonly config: NeighborConfig;
  readonly apiOrigin: string | null;
  readonly inject: Injector;
  /** Calls `run` once the page's first API XHR came back (`timing=first-xhr`). */
  readonly afterFirstXhr: (run: () => void) => void;
  /** Its content script's own `fetch` (the page's hooks never see it). */
  readonly fetch: typeof fetch;
  readonly mapPatch: MapPatchState | null;
  readonly generic: GenericCounts | null;
}

const MAX_LOG = 5000;
const NOISY_TEXT = 'FBuddy: 3 fans online';

export class Isolated {
  readonly bridge: Bridge;
  readonly ui: NeighborUi;
  readonly dom: NeighborDom;
  readonly own: OwnRequests | null;
  readonly title: TitleRefresh;
  readonly translator: Translator;
  creatorId: string | null = null;
  private readonly entries: NeighborNetworkEvent[] = [];
  private seq = 0;
  private readonly replayed: Record<string, string> = {};
  private installs = 0;
  private scripts = 0;
  private hooksIn = false;
  private gateOpen = false;
  private guardIn = false;
  private messageLogs = 0;
  private flooded = 0;
  private swallowedBefore = 0;
  private restoredBefore = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];

  constructor(
    private readonly win: View,
    private readonly options: IsolatedOptions,
  ) {
    const { config, apiOrigin } = options;
    this.bridge = createBridge(win, 'content');
    this.ui = new NeighborUi(win);
    this.translator = new Translator({ win, mod: resolveMod(config.mod, win.navigator.platform), delayMs: config.translateMs });
    this.dom = new NeighborDom({ win, ui: this.ui, panel: config.panel, translator: this.translator });
    this.own = apiOrigin === null ? null : new OwnRequests({ apiOrigin, fetch: options.fetch, replayed: () => this.replayed });
    this.title = new TitleRefresh(win.document);
  }

  get ready(): boolean {
    return this.hooksIn && this.gateOpen;
  }

  start(): void {
    const { win } = this;
    const { config } = this.options;
    this.bridge.on(BRIDGE_EVENTS.network, (payload) => this.onNetwork(payload as NetworkEventPayload));
    this.bridge.on(BRIDGE_EVENTS.toast, (payload) => {
      const text = (payload as { text?: unknown }).text;
      this.ui.toast(typeof text === 'string' ? text : '');
    });
    this.bridge.on(BRIDGE_EVENTS.flood, () => {
      this.flooded += 1;
    });
    announceStart(win);
    win.document.addEventListener('keydown', (event) => {
      if (isToasterKey(event)) this.ui.focusToasts();
    });
    Reflect.set(win, NEIGHBOR_GLOBAL, this.control());
    if (config.mode === 'before') this.installInline();
    else if (config.timing === 'first-xhr') this.options.afterFirstXhr(() => void this.injectChain());
    else void this.injectChain();
    void this.gate();
  }

  private facts(): PartFacts {
    return { config: this.options.config, apiOrigin: this.options.apiOrigin, instance: this.installs };
  }

  /** `before`: the page parts at once, inline — the page's first moment. */
  private installInline(): void {
    this.installs += 1;
    runBridge(this.win, this.facts());
    runHook(this.win, this.facts());
    this.hooksInPlace();
  }

  /** The field's way: the bridge script, then the hook script (two loads). */
  private async injectChain(): Promise<void> {
    this.scripts += 1;
    await this.options.inject('bridge', this.facts(), { id: FBUDDY_IDS.bridgeScript, keep: true });
    await this.injectHook();
    this.hooksInPlace();
    if (this.options.config.mode === 'reinject') this.win.setTimeout(() => void this.reinject(), this.options.config.reinjectMs);
  }

  private async injectHook(): Promise<void> {
    this.installs += 1;
    this.scripts += 1;
    await this.options.inject('hook', this.facts(), { id: `fbuddy-network-hook-${this.installs}`, keep: false });
  }

  private hooksInPlace(): void {
    this.hooksIn = true;
    void this.maybeGuard();
    this.settle();
  }

  /** Its own `/account/me` decides: only a creator's page gets its DOM work, its poll and its guard. */
  private async gate(): Promise<void> {
    this.creatorId = this.own === null ? 'local' : await this.own.me();
    if (this.creatorId === null) return;
    this.gateOpen = true;
    const begin = (): void => {
      this.dom.start();
      this.startTimers();
      void this.maybeGuard();
      this.settle();
    };
    if (this.win.document.readyState === 'loading') this.win.document.addEventListener('DOMContentLoaded', begin, { once: true });
    else begin();
  }

  private startTimers(): void {
    const { pollMs, noisyMs } = this.options.config;
    if (this.own !== null && pollMs > 0) this.timers.push(setInterval(() => void this.poll(), pollMs));
    if (noisyMs > 0) this.timers.push(setInterval(() => this.ui.toast(NOISY_TEXT), noisyMs));
  }

  private async poll(): Promise<NeighborOwnRequest> {
    if (this.own === null) throw new Error('the neighbour has no API to poll (the local backend)');
    const unread = await this.own.unread();
    if (unread !== null) this.title.run(unread);
    const last = this.own.last();
    if (last === null) throw new Error('no request made');
    return last;
  }

  /** An organization: its words on the page, then the guard — after the hook and after its init. */
  private async maybeGuard(): Promise<void> {
    const words = this.options.config.guard;
    if (words.length === 0 || this.guardIn || !this.hooksIn || !this.gateOpen || this.options.apiOrigin === null) return;
    this.guardIn = true;
    this.writeWords(words);
    await this.installGuard();
  }

  private writeWords(words: readonly string[]): void {
    const doc = this.win.document;
    let data = doc.getElementById(FBUDDY_IDS.wordsData);
    if (data === null) {
      data = doc.createElement('script');
      data.id = FBUDDY_IDS.wordsData;
      data.setAttribute('type', 'application/json');
      doc.documentElement.append(data);
    }
    data.textContent = JSON.stringify(words);
  }

  private async installGuard(): Promise<void> {
    if (this.options.config.mode === 'before') {
      runGuard(this.win, this.facts());
      return;
    }
    this.scripts += 1;
    await this.options.inject('guard', this.facts(), { id: `fbuddy-restricted-words-guard-${this.installs}`, keep: false });
  }

  private guardInstance(): GuardInstance | undefined {
    return Reflect.get(this.win, FBUDDY_KEYS.guardInstance) as GuardInstance | undefined;
  }

  /** FBuddy restarts: a new hook (it disposes the old one itself) and a new guard; the July hook stays as it was. */
  async reinject(): Promise<number> {
    const guard = this.guardInstance();
    if (guard !== undefined && this.options.config.mode !== 'legacy') {
      this.swallowedBefore += guard.swallowed;
      this.restoredBefore += guard.restored;
    }
    announceStart(this.win);
    if (this.options.config.mode === 'before') {
      this.installs += 1;
      runHook(this.win, this.facts());
    } else await this.injectHook();
    if (this.guardIn && this.options.config.mode !== 'legacy') await this.installGuard();
    return this.hookInstance()?.id ?? 0;
  }

  private hookInstance(): HookInstance | undefined {
    return Reflect.get(this.win, FBUDDY_KEYS.hookInstance) as HookInstance | undefined;
  }

  private onNetwork(payload: NetworkEventPayload): void {
    const text = payload.responseText;
    this.seq += 1;
    this.entries.push({
      seq: this.seq,
      instance: payload.instance,
      kind: payload.kind,
      method: payload.method,
      url: payload.url,
      status: payload.status,
      outcome: payload.outcome,
      headers: Object.keys(payload.headers).sort(),
      requestBody: payload.requestBody !== null,
      digest: text === null ? null : digest(text),
      length: text?.length ?? 0,
    });
    if (this.entries.length > MAX_LOG) this.entries.splice(0, this.entries.length - MAX_LOG);
    // Header capture: replayed on its own requests as they are.
    for (const name of RECORDED_HEADERS) {
      const value = payload.headers[name];
      if (value !== undefined) this.replayed[name] = value;
    }
    const ok = payload.status >= 200 && payload.status < 300;
    // Its entity cache parses every good answer again.
    if (ok && text !== null && text !== '') {
      try {
        JSON.parse(text);
      } catch {
        // not JSON: nothing to cache
      }
    }
    if (ok && this.options.config.guard.length > 0 && isMessagePost(payload.method, payload.url, this.win.location.href)) this.messageLogs += 1;
  }

  private settle(): void {
    if (!this.ready) return;
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  state(): NeighborState {
    const guard = this.guardInstance();
    const hook = this.hookInstance();
    const map = this.options.mapPatch;
    return {
      config: this.options.config,
      ready: this.ready,
      creatorId: this.creatorId,
      hook: { installs: this.installs, instance: hook?.id ?? null, scripts: this.scripts },
      guard: {
        active: guard !== undefined && !guard.disposed && this.options.config.guard.length > 0,
        swallowed: this.swallowedBefore + (guard?.swallowed ?? 0),
        restored: this.restoredBefore + (guard?.restored ?? 0),
      },
      mapPatch: { installed: map?.installed ?? false, found: map?.found ?? false, restored: map?.restored ?? false },
      dom: { hosts: this.ui.hosts().length, ...this.dom.stats, mounts: this.ui.mounts },
      title: { writes: this.title.writes, favicons: this.title.favicons },
      messageLogs: this.messageLogs,
      generic: this.options.generic === null ? null : { ...this.options.generic },
      flooded: this.flooded,
    };
  }

  control(): NeighborControl {
    return {
      version: 1,
      config: this.options.config,
      state: () => this.state(),
      whenReady: () =>
        new Promise<void>((resolve) => {
          if (this.ready) resolve();
          else this.waiting.push(resolve);
        }),
      log: (since = 0) => this.entries.filter((entry) => entry.seq > since),
      own: (since = 0) => (this.own?.log ?? []).filter((entry) => entry.seq > since),
      toasts: () => [...this.ui.toastTexts],
      reinject: () => this.reinject(),
      pollNow: () => this.poll(),
      writeNote: async (fanId, text) => (this.own === null ? null : this.own.writeNote(fanId, text)),
    };
  }

  /** Stops its timers and observers (DOM tests). */
  stop(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    this.dom.stop();
    this.bridge.close();
  }
}

/** The control of a page whose neighbour is only the generic third party (mode `off`). */
export function genericOnlyControl(config: NeighborConfig, generic: GenericCounts | null): NeighborControl {
  const state = (): NeighborState => ({
    config,
    ready: true,
    creatorId: null,
    hook: { installs: 0, instance: null, scripts: 0 },
    guard: { active: false, swallowed: 0, restored: 0 },
    mapPatch: { installed: false, found: false, restored: false },
    dom: { hosts: 0, records: 0, batches: 0, targets: 0, mounts: 0, rescans: 0 },
    title: { writes: 0, favicons: 0 },
    messageLogs: 0,
    generic: generic === null ? null : { ...generic },
    flooded: 0,
  });
  return {
    version: 1,
    config,
    state,
    whenReady: () => Promise.resolve(),
    log: () => [],
    own: () => [],
    toasts: () => [],
    reinject: () => Promise.resolve(0),
    pollNow: () => Promise.reject(new Error('no neighbour')),
    writeNote: () => Promise.resolve(null),
  };
}
