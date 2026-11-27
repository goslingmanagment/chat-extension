// The page's video player (2026-11-27): Fansly plays a vault, post or message video in Firefox with video.js and VHS
// (`@videojs/http-streaming` 3.9.1 in its `scripts.*.js`, the global `videojs`) as DASH — an `.mpd` and whole-file
// fMP4 tracks on `cdn*.fansly.com/new/…`, read by `Range`. VHS's own hook, `videojs.Vhs.xhr.onRequest`, hands us the
// options of every request of every player before it is made, and ours changes two things in them:
// - The probe. Before it reads a track's index, VHS asks for the WHOLE track without a `Range`, only to tell its
//   container by the first bytes, and aborts it then (`DashPlaylistLoader.addSidxSegments_`: the one request of VHS
//   with a `beforeSend` and no `responseType`). Firefox lets a server send 12 MiB on an HTTP/2 stream before it reads
//   a byte: over a model's proxy megabytes of the aborted answer are on their way, and the small `Range` requests
//   behind them on the same connection wait 15–45 s (VHS gives up at 45), again at every change of quality. The probe
//   gets `Range: bytes=0-65535`, the track's head with its init and index; VHS takes the 206 as it took the 200, and
//   an index past it VHS asks for by `Range` itself.
// - The worker. Fansly marks its API, pictures and progressive files `ngsw-bypass`, never these: the site's service
//   worker fetches them as requests of no tab, which a model's container does not proxy (CloudFront's 403, the
//   worker's 504, the 360p file instead of the stream). The manifest and the tracks get `ngsw-bypass=true`, as
//   FBuddy's network hook gives them, and go by the tab's own route. Never without the Range, so both are one hook:
//   the bypass alone moves the probe's drain onto the tab's connection.
// Only the options change, in a new object; never an `open`, `send` or `setRequestHeader` of ours (xhr-tap.ts): VHS
// makes the request as ever, through the prototype and whatever FBuddy hooked there, and Fansly's own `beforeRequest`
// (`withCredentials`) comes after ours in VHS's chain, given what ours returned.
// - The hook is no `guard(…)`: a guard returns undefined when it fails, and VHS hands the next hook (Fansly's) what
//   ours returned. It catches its own failure, counts it (`vhsRequests`) and gives the options back as they came.
// - `videojs` comes with Fansly's deferred script, after document_start. The hook goes onto it once it is there: at
//   the start (a late injection), at a script's `load` (in the capture phase on the document: a video.js loaded
//   later, before its first manifest), at DOMContentLoaded and at each request's start (index.ts) — a manifest always
//   comes before a probe.
// - The old extension (FS-CO-1): no hook on its page, ours taken off when it shows up later. `dispose()` leaves the
//   hook on: an update of the extension disposes this copy and starts no other until a reload (legacy.ts
//   `previousMain`), and the open tab's video would hang again.

import { isPlain, type Plain } from '@cg/host-kit/main/check';

import type { TapNatives } from './ws-tap';

/** What the probe asks for instead of the whole track: its first 64 KiB, the init and the index of a track hours long. */
export const PROBE_RANGE = 'bytes=0-65535';

/** A track of a DASH video (the probe's); with the manifest, what goes past the worker. */
const TRACK = /\.m(?:p4|4[sav])$/i;
const DASH = /\.(?:mpd|mp4|m4[sav])$/i;

const hasRange = (headers: Plain): boolean => Object.keys(headers).some((name) => name.toLowerCase() === 'range');

/**
 * One request of VHS: the options to make it with — the same object when nothing is ours to change, else a new one
 * with a new `headers`. `base` resolves a relative address; `mediaOrigins` — the media's origins (`https://cdn.fansly.com`),
 * a port after them too. Anything VHS would not read as plain headers leaves the request as it is.
 */
export function tuneVhsRequest(options: unknown, base: string, Url: typeof URL, mediaOrigins: readonly string[]): unknown {
  if (!isPlain(options)) return options;
  // `@videojs/xhr` takes `uri || url`, `method || 'GET'`, `headers || {}`.
  const key = options['uri'] ? 'uri' : 'url';
  const raw = options[key];
  const method = options['method'];
  const given = options['headers'];
  const headers: Plain | null = isPlain(given) ? given : given ? null : {};
  if (typeof raw !== 'string' || (method && (typeof method !== 'string' || method.toUpperCase() !== 'GET')) || headers === null) return options;
  let url: URL;
  try {
    url = new Url(raw, base);
  } catch {
    return options;
  }
  if (!mediaOrigins.includes(`${url.protocol}//${url.hostname}`)) return options;
  const path = url.pathname;
  const type = options['responseType'];
  const probe = TRACK.test(path) && typeof options['beforeSend'] === 'function' && (type === undefined || type === '' || type === 'text') && !options['byterange'] && !hasRange(headers);
  const bypass = path.startsWith('/new/') && DASH.test(path) && !url.searchParams.has('ngsw-bypass') && !url.searchParams.has('Signature');
  if (!probe && !bypass) return options;
  const next: Plain = { ...options };
  if (bypass) {
    // Into the address as it came, before its fragment: the query's own bytes (a signature's `~`) stay as they are.
    const at = raw.indexOf('#');
    const head = at < 0 ? raw : raw.slice(0, at);
    next[key] = `${head}${head.includes('?') ? '&' : '?'}ngsw-bypass=true${at < 0 ? '' : raw.slice(at)}`;
  }
  if (probe) next['headers'] = { ...headers, Range: PROBE_RANGE };
  return next;
}

/** VHS's request function with its hooks (`videojs.Vhs.xhr`), as far as we use it. */
interface VhsXhr {
  onRequest(hook: (options: unknown) => unknown): void;
  offRequest(hook: (options: unknown) => unknown): void;
}

export interface VhsNatives extends Pick<TapNatives, 'listenOn' | 'guard' | 'fault'> {
  /** The URL constructor captured at document_start. */
  readonly Url: typeof URL;
  /** EventTarget.prototype.removeEventListener captured at install, for a `listenOn(…, true)` listener. */
  readonly unlistenOn: (target: EventTarget, type: string, listener: (event: Event) => void) => void;
}

export interface VhsRequests {
  /** Puts the hook onto the page's VHS if it is there; true once it stands. Cheap to call again. */
  attach(): boolean;
  /** Takes the hook off for good (the old extension showed up). */
  restore(): void;
}

/** `videojs`, its `Vhs` and its `xhr` are functions with properties: any of them is an object or a function. */
const holder = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function');

export function installVhsRequests(win: Window, mediaOrigins: readonly string[], natives: VhsNatives): VhsRequests {
  const { Url, guard, fault } = natives;
  const doc = win.document;
  let hooked: VhsXhr | null = null;
  /** The hook stands, or never will (restored): nothing to look for any more. */
  let done = false;
  let listening = false;
  // VHS calls it in its own request and hands the next hook what it returns: it never throws, always returns an object.
  const hook = (options: unknown): unknown => {
    try {
      return tuneVhsRequest(options, win.location.href, Url, mediaOrigins);
    } catch {
      fault('vhsRequests');
      return options;
    }
  };
  const unlisten = (): void => {
    if (!listening) return;
    listening = false;
    try {
      natives.unlistenOn(doc, 'load', onScript);
    } catch {
      fault('vhsUnlisten');
    }
  };
  const attach = (): boolean => {
    if (done) return hooked !== null;
    try {
      const videojs: unknown = Reflect.get(win, 'videojs');
      const vhs: unknown = holder(videojs) ? Reflect.get(videojs, 'Vhs') : undefined;
      const xhr: unknown = holder(vhs) ? Reflect.get(vhs, 'xhr') : undefined;
      if (!holder(xhr) || typeof (xhr as Partial<VhsXhr>).onRequest !== 'function') return false;
      (xhr as VhsXhr).onRequest(hook);
      hooked = xhr as VhsXhr;
      done = true;
      unlisten();
      return true;
    } catch {
      fault('vhsAttach');
      return false;
    }
  };
  const onScript = guard('vhsScript', () => {
    attach();
  });
  if (!attach()) {
    try {
      natives.listenOn(doc, 'load', onScript, true);
      listening = true;
    } catch {
      fault('vhsListen');
    }
  }
  return {
    attach,
    restore() {
      done = true;
      unlisten();
      try {
        hooked?.offRequest(hook);
      } catch {
        fault('vhsRestore');
      }
      hooked = null;
    },
  };
}
