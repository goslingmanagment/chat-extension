// The stand's FBuddy-like neighbour (R20 P6d; S5 §6 — ~/Documents/Codex/
// r20-detail-2026-10-12/research/s5-fbuddy.md): its modes and flags, how a
// test turns it on, the names FBuddy leaves on a page, and the test-control
// API of the neighbour (`window.__fanslyNeighbor`). Browser- and Node-safe: no
// DOM at import. None of this is FBuddy's code; the names of its window keys,
// elements and messages are the facts S5 read (§2.3, §2.5, §2.9) — what our
// extension may meet and detect on fansly.com.

/**
 * - `off` — no neighbour (the reference run);
 * - `after` (the default, the field's order) — FBuddy's page hooks arrive by `<script src>` after our MAIN;
 * - `before` — the hooks are installed at the page's first moment, and our MAIN is to be injected late (the
 *   test build's late-install path, P7a: the page side here is the same, the order is the harness's);
 * - `reinject` — as `after`, then `dispose()` and a new instance every `reinjectMs` (FBuddy updates or restarts);
 * - `legacy` — the July build: hooks ALL XHR and fetch, keeps every body, a flag guard, no `dispose`.
 */
export const NEIGHBOR_MODES = ['off', 'after', 'before', 'reinject', 'legacy'] as const;
export type NeighborMode = (typeof NEIGHBOR_MODES)[number];

/**
 * When the page hooks arrive in `after`, `reinject` and `legacy` (S5 §6.1 (a), (b)):
 * - `load` — at once: the boot script injects the bridge and then the hook, two script loads, as FBuddy's
 *   isolated script does at `document_start` — racing the page's own first request, as in the field;
 * - `first-xhr` — after the page's first API XHR came back: that request (at least) is not hooked.
 */
export type NeighborTiming = 'load' | 'first-xhr';

/**
 * FBuddy's fan panel (`showMessageSidebar`, S5 §2.5): `desktop` — a 400-px panel at the end of `.messages-wrapper`
 * and `flexGrow 3` on the inbox (a window > 1200 px); `mobile` — a node at the end of `.message-content-header`,
 * made anew on every chat (≤ 1200 px); `off` — none (as in the owner's measurement, MEAS).
 */
export type NeighborPanel = 'off' | 'desktop' | 'mobile';

/**
 * Not FBuddy (S5 §6.1 `generic`): a third party that replaces `XMLHttpRequest` and `WebSocket` themselves —
 * a constructor Proxy, or a subclass — at the page's first moment: a robustness case for our tap.
 */
export type NeighborGeneric = 'proxy' | 'subclass';

/** The translate shortcut's Mod (S5 §2.6: Meta on macOS, Ctrl elsewhere); `auto` decides by the platform. */
export type NeighborMod = 'auto' | 'meta' | 'ctrl';

export interface NeighborConfig {
  readonly mode: NeighborMode;
  readonly timing: NeighborTiming;
  /**
   * `+guard`: the restricted words of an FBuddy organization (S5 §2.6). Empty — no organization: no guard, no
   * message logging, no words element.
   */
  readonly guard: readonly string[];
  readonly panel: NeighborPanel;
  readonly generic: NeighborGeneric | null;
  /** `reinject`: how long after each install the next one comes. */
  readonly reinjectMs: number;
  /** The unread poll (its own request) and the title and favicon refresh after it: 10 s on the site. */
  readonly pollMs: number;
  /** Translate's round trip before it writes (S5 §6.2 G: 300 ms). */
  readonly translateMs: number;
  readonly mod: NeighborMod;
  /** A toast every N ms (the `noisy` sub-mode of S5 §6.2 E); 0 — none. */
  readonly noisyMs: number;
  /**
   * The bridge floods window `message` from its install on (S5 §6.3 item 9: 200-KB payloads at 20 a second) for this
   * long; 0 — no flood.
   */
  readonly floodMs: number;
}

export const DEFAULT_GUARD_WORDS: readonly string[] = ['forbidden'];

export const DEFAULT_NEIGHBOR: NeighborConfig = {
  mode: 'after',
  timing: 'load',
  guard: [],
  panel: 'off',
  generic: null,
  reinjectMs: 3000,
  pollMs: 10_000,
  translateMs: 300,
  mod: 'auto',
  noisyMs: 0,
  floodMs: 0,
};

/** The neighbour is on the page at all (a `generic` third party alone counts). */
export const neighborActive = (config: NeighborConfig): boolean => config.mode !== 'off' || config.generic !== null;

// ── how a test turns it on ──

/**
 * The page's query parameter: a spec of comma-separated tokens, the mode first — `after`, `after,guard`,
 * `before,panel=mobile`, `reinject,reinject=1500`, `off,generic=subclass`. A space separates tokens too (a `+` in a
 * query decodes to one, so `after+guard` works typed by hand). It overrides the stand server's default for that load.
 */
export const NEIGHBOR_PARAM = 'stand-neighbor';

/** The Fansly stand's control endpoint for the default of every later page load (POST a config or `null`). */
export const NEIGHBOR_CONTROL_PATH = '/__stand/neighbor';

/** Where the stand serves the neighbour's one script (built into .cache/fansly-neighbor). */
export const NEIGHBOR_SCRIPT_PATH = '/neighbor/neighbor.js';

/** On every neighbour script element: which part it runs (see entry.ts), and the boot script's config as JSON. */
export const NEIGHBOR_PART_ATTRIBUTE = 'data-fbuddy-stand-part';
export const NEIGHBOR_CONFIG_ATTRIBUTE = 'data-fbuddy-stand';

export type NeighborPart = 'boot' | 'bridge' | 'hook' | 'guard';

const positiveMs = (token: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`neighbor spec: ${token} needs milliseconds, got ${value}`);
  return parsed;
};

const oneOf = <T extends string>(token: string, value: string, allowed: readonly T[]): T => {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`neighbor spec: ${token}=${value} is not one of ${allowed.join(', ')}`);
  return value as T;
};

/** A spec (see NEIGHBOR_PARAM) to a full config; an unknown token throws — a typo must not run the reference. */
export function parseNeighborSpec(spec: string): NeighborConfig {
  const tokens = spec
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');
  const [mode = 'after', ...flags] = tokens;
  let config: NeighborConfig = { ...DEFAULT_NEIGHBOR, mode: oneOf('mode', mode, NEIGHBOR_MODES) };
  for (const flag of flags) {
    const [name = '', value] = flag.split('=', 2) as [string, string | undefined];
    switch (name) {
      case 'guard':
        config = { ...config, guard: value === undefined || value === '' ? DEFAULT_GUARD_WORDS : value.split('|').filter((word) => word !== '') };
        break;
      case 'panel':
        config = { ...config, panel: oneOf(name, value ?? '', ['off', 'desktop', 'mobile'] as const) };
        break;
      case 'generic':
        config = { ...config, generic: value === undefined ? 'proxy' : oneOf(name, value, ['proxy', 'subclass'] as const) };
        break;
      case 'timing':
        config = { ...config, timing: oneOf(name, value ?? '', ['load', 'first-xhr'] as const) };
        break;
      case 'mod':
        config = { ...config, mod: oneOf(name, value ?? '', ['auto', 'meta', 'ctrl'] as const) };
        break;
      case 'reinject':
        config = { ...config, reinjectMs: positiveMs(name, value ?? '') };
        break;
      case 'poll':
        config = { ...config, pollMs: positiveMs(name, value ?? '') };
        break;
      case 'translate':
        config = { ...config, translateMs: positiveMs(name, value ?? '') };
        break;
      case 'noisy':
        config = { ...config, noisyMs: positiveMs(name, value ?? '') };
        break;
      case 'flood':
        config = { ...config, floodMs: positiveMs(name, value ?? '') };
        break;
      default:
        throw new Error(`neighbor spec: unknown token ${flag}`);
    }
  }
  return config;
}

/** A partial config with defaults filled in (the stand control and the e2e helpers take one). */
export const neighborConfig = (partial: Partial<NeighborConfig> = {}): NeighborConfig => ({ ...DEFAULT_NEIGHBOR, ...partial });

/** A config back to a spec: what an e2e test puts in the page's address. */
export function neighborSpec(config: Partial<NeighborConfig>): string {
  const full = neighborConfig(config);
  const tokens: string[] = [full.mode];
  if (full.guard.length > 0) tokens.push(`guard=${full.guard.join('|')}`);
  if (full.panel !== DEFAULT_NEIGHBOR.panel) tokens.push(`panel=${full.panel}`);
  if (full.generic !== null) tokens.push(`generic=${full.generic}`);
  if (full.timing !== DEFAULT_NEIGHBOR.timing) tokens.push(`timing=${full.timing}`);
  if (full.mod !== DEFAULT_NEIGHBOR.mod) tokens.push(`mod=${full.mod}`);
  if (full.reinjectMs !== DEFAULT_NEIGHBOR.reinjectMs) tokens.push(`reinject=${full.reinjectMs}`);
  if (full.pollMs !== DEFAULT_NEIGHBOR.pollMs) tokens.push(`poll=${full.pollMs}`);
  if (full.translateMs !== DEFAULT_NEIGHBOR.translateMs) tokens.push(`translate=${full.translateMs}`);
  if (full.noisyMs !== DEFAULT_NEIGHBOR.noisyMs) tokens.push(`noisy=${full.noisyMs}`);
  if (full.floodMs !== DEFAULT_NEIGHBOR.floodMs) tokens.push(`flood=${full.floodMs}`);
  return tokens.join(',');
}

// ── what FBuddy leaves on a page (S5 §2.3, §2.5, §2.9) ──

/** FBuddy's `window` keys. */
export const FBUDDY_KEYS = {
  bridge: '__FBUDDY_WINDOW_BRIDGE__',
  bridgeListeners: '__FBUDDY_WINDOW_BRIDGE_LISTENERS__',
  bridgeContentListeners: '__FBUDDY_WINDOW_BRIDGE_CONTENT_LISTENERS__',
  hook: '__FBUDDY_NETWORK_HOOK__',
  hookInstance: '__FBUDDY_NETWORK_HOOK_INSTANCE__',
  guard: '__FBUDDY_RESTRICTED_WORDS_GUARD__',
  guardInstance: '__FBUDDY_RESTRICTED_WORDS_GUARD_INSTANCE__',
  goalsRefresh: '__FBUDDY_FANSLY_GOALS_REFRESH__',
} as const;

/** FBuddy's own properties on an XHR instance (set by its prototype hooks, never by the page). */
export const FBUDDY_XHR = { requestInfo: '__fbuddyRequestInfo', shouldCheck: '__fbuddyShouldCheck' } as const;

/** Ids of FBuddy's elements on the page. */
export const FBUDDY_IDS = {
  /** `<html>`: stays after load, `data-fbuddy-version="2"`. */
  bridgeScript: 'fbuddy-window-bridge-script',
  /** `<html>`: `type=application/json`, an organization's restricted words — the guard is active. */
  wordsData: 'fbuddy-restricted-words-data',
  /** `<head>`: always for a creator. */
  styleFixes: 'fb-fansly-style-fixes',
  dynamicTweaks: 'fb-dynamic-tweaks-css',
} as const;

/** The bridge's message (S5 §6.2 B): `{[marker]: true, direction, name, payload}`, posted with `"*"`. */
export const FBUDDY_BRIDGE_MARKER = '__fbuddyWindowBridge';
export type BridgeDirection = 'page-to-content' | 'content-to-page';
export interface BridgeMessage<P = unknown> {
  readonly [FBUDDY_BRIDGE_MARKER]: true;
  readonly direction: BridgeDirection;
  readonly name: string;
  readonly payload: P;
}

export const BRIDGE_EVENTS = {
  /** Every Fansly API response the hook saw (S5 §2.4). */
  network: 'fbuddy:network-event',
  /** The guard's «Message blocked by restricted words». */
  toast: 'fbuddy:toast',
  /** The flood (S5 §6.3 item 9): a large payload nobody needs. */
  flood: 'fbuddy:flood',
} as const;

/** The four Fansly client headers the hook records (S5 §2.4) and FBuddy replays on its own requests. */
export const RECORDED_HEADERS = ['fansly-client-check', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id'] as const;

/** The 12000 note FBuddy writes for a fan when its fan profile is saved (S5 §2.8, `autoAppendFanslyNotes`). */
export const FBUDDY_NOTE_TITLE = 'FBuddy Notes';
export const FBUDDY_NOTE_TYPE = 12000;

// ── what the hook posts ──

/** The payload of one `fbuddy:network-event`. */
export interface NetworkEventPayload {
  /** The hook instance that saw it (counts up with every install). */
  readonly instance: number;
  readonly kind: 'xhr' | 'fetch';
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly outcome: 'load' | 'error' | 'abort' | 'timeout';
  /** The recorded client headers (lower-case names). */
  readonly headers: Readonly<Record<string, string>>;
  /** The request body: `POST /message` and `/message/broadcast` only (the July build: every body). */
  readonly requestBody: string | null;
  /** The whole response text (`responseType` `''` or `'text'`); null — none or not text. */
  readonly responseText: string | null;
}

// ── the test-control API ──

/** The neighbour's test control lives on `window[NEIGHBOR_GLOBAL]`. */
export const NEIGHBOR_GLOBAL = '__fanslyNeighbor';

/** One network event as its «isolated» side kept it: no bodies, a digest instead. */
export interface NeighborNetworkEvent {
  readonly seq: number;
  readonly instance: number;
  readonly kind: 'xhr' | 'fetch';
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly outcome: NetworkEventPayload['outcome'];
  /** The recorded headers' names. */
  readonly headers: readonly string[];
  readonly requestBody: boolean;
  /** FNV-1a of the response text: equal texts, equal digests; null — no text. */
  readonly digest: string | null;
  readonly length: number;
}

/** One of its own requests to the fake Fansly (with the token issued to it, so the server journals it `neighbour`). */
export interface NeighborOwnRequest {
  readonly seq: number;
  readonly method: 'GET' | 'POST';
  /** After `/api/v1`, with its query. */
  readonly path: string;
  /** 0 — no answer (a network error). */
  readonly status: number;
  /** What it was for. */
  readonly purpose: 'account' | 'unread' | 'note-read' | 'note-write';
}

export interface NeighborState {
  readonly config: NeighborConfig;
  /**
   * Its hooks are installed and its DOM work has begun (after its own `/account/me` named a creator). Begun, not done:
   * its mounts come in batches behind a 50-ms throttle, and anew for every new composer — a test that needs a widget
   * or its key on the field waits for that widget (`dom.queued`, or the node itself).
   */
  readonly ready: boolean;
  readonly creatorId: string | null;
  readonly hook: {
    /** Hook installs so far (a reinject adds one). */
    readonly installs: number;
    /** The instance on top now; null — none. */
    readonly instance: number | null;
    /** `<script>` elements it injected for its page parts. */
    readonly scripts: number;
  };
  readonly guard: { readonly active: boolean; readonly swallowed: number; readonly restored: number };
  readonly mapPatch: { readonly installed: boolean; readonly found: boolean; readonly restored: boolean };
  readonly dom: {
    /** Its `fb-*-ui` hosts in the document now. */
    readonly hosts: number;
    /** Mutation records its observer was handed. */
    readonly records: number;
    readonly batches: number;
    readonly targets: number;
    /** Hosts it inserted (a re-mount counts again). */
    readonly mounts: number;
    readonly rescans: number;
    /** Targets its observer found and has not worked through yet. */
    readonly queued: number;
  };
  readonly title: { readonly writes: number; readonly favicons: number };
  /** `POST /message` it would have logged to its organization (message logging; never sent anywhere). */
  readonly messageLogs: number;
  /** The generic third party's constructions; null — not on. */
  readonly generic: { readonly xhr: number; readonly sockets: number } | null;
  /** Bridge messages it posted to flood the window. */
  readonly flooded: number;
}

export interface NeighborControl {
  readonly version: 1;
  readonly config: NeighborConfig;
  state(): NeighborState;
  /** Resolves once `ready`. */
  whenReady(): Promise<void>;
  /** The network events its isolated side got from the hook, after `since`. */
  log(since?: number): NeighborNetworkEvent[];
  /** Its own requests, after `since`. */
  own(since?: number): NeighborOwnRequest[];
  /** Texts of the toasts it showed. */
  toasts(): string[];
  /** Disposes the hook (and the guard) and injects a new instance now; resolves with the new instance's number. */
  reinject(): Promise<number>;
  /** One unread poll now (and the title refresh after it). */
  pollNow(): Promise<NeighborOwnRequest>;
  /** Saves its fan profile: creates or edits the fan's «FBuddy Notes» note through the API. */
  writeNote(fanId: string, text: string): Promise<{ readonly id: string; readonly created: boolean } | null>;
}
