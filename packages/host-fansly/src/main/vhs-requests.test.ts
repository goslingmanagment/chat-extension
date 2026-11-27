// The page's video requests (vhs-requests.ts) against VHS's own way of calling its hooks. The chain is VHS 3.9.1's
// (`xhrFactory` in Fansly's scripts bundle): the request's options merged over `{ timeout: 45e3 }`, the hooks of
// `onRequest` in their order, then Fansly's `beforeRequest` (`withCredentials`), each given what the one before
// returned; `offRequest` drops the set once it is empty. `videojs`, its `Vhs` and `Vhs.xhr` are functions, as on the
// page. The runtime's part — where the hook goes on, the old extension, a second copy of MAIN — over the fake page.

import { guardWith } from '@cg/host-kit/main/guard';
import type { Plain } from '@cg/host-kit/main/check';
import { afterEach, describe, expect, it } from 'vitest';

import { API, CREATOR, NETWORK, ok, page, request, type PageWindow } from '../testing/fake-page';
import { installFanslyMain } from './index';
import { installVhsRequests, PROBE_RANGE, tuneVhsRequest, type VhsNatives } from './vhs-requests';

const BASE = 'https://fansly.com/creator/vault';
const ORIGINS = ['https://cdn.fansly.com', 'https://cdn2.fansly.com', 'https://cdn3.fansly.com', 'http://localhost'];
const TRACK = 'https://cdn3.fansly.com/new/700000000000000100/700000000000000200/media-video-avc1-2.mp4';
const MPD = 'https://cdn3.fansly.com/new/700000000000000100/700000000000000200/700000000000000200.mpd';
const tune = (options: unknown, base = BASE): unknown => tuneVhsRequest(options, base, URL, ORIGINS);
/** VHS's container probe (`addSidxSegments_`): the track's address and a `beforeSend`, nothing else. */
const probe = (uri = TRACK, over: Plain = {}): Plain => ({ timeout: 45_000, uri, beforeSend: () => undefined, ...over });
const headersOf = (options: unknown): unknown => (options as Plain)['headers'];
const uriOf = (options: unknown): unknown => (options as Plain)['uri'];

type Hook = (options: unknown) => unknown;
interface FakeVhs {
  readonly videojs: unknown;
  /** The hooks of `onRequest` now, in their order. */
  hooks(): Hook[];
  /** A request of VHS: what `@videojs/xhr` is given. */
  request(options: Plain): Plain;
}

/** video.js with VHS as Fansly's scripts bundle has it, and Fansly's own `beforeRequest`. */
function fakeVhs(): FakeVhs {
  const xhr = Object.assign(() => undefined, {
    _requestCallbackSet: undefined as Set<Hook> | undefined,
    onRequest(hook: Hook) {
      (xhr._requestCallbackSet ??= new Set()).add(hook);
    },
    offRequest(hook: Hook) {
      xhr._requestCallbackSet?.delete(hook);
      if (xhr._requestCallbackSet?.size === 0) xhr._requestCallbackSet = undefined;
    },
    beforeRequest(options: Plain) {
      options['withCredentials'] = true;
      return options;
    },
  });
  const videojs = Object.assign(() => undefined, { Vhs: Object.assign(() => undefined, { xhr }) });
  return {
    videojs,
    hooks: () => [...(xhr._requestCallbackSet ?? [])],
    request(options) {
      const set = xhr._requestCallbackSet ?? new Set<Hook>();
      const before = xhr.beforeRequest as Hook;
      set.add(before);
      let made: unknown = { timeout: 45_000, ...options };
      set.forEach((hook) => (made = hook(made)));
      set.delete(before);
      return made as Plain;
    },
  };
}

/** A window as far as the hook reads it: its address, its document, its `videojs`. */
const mini = (): Window => ({ location: { href: BASE }, document: new EventTarget() }) as unknown as Window;
const nativesOf = (faults: string[]): VhsNatives => ({
  Url: URL,
  guard: guardWith((site) => faults.push(site)),
  fault: (site) => faults.push(site),
  listenOn: (target, type, listener) => target.addEventListener(type, listener, true),
  unlistenOn: (target, type, listener) => target.removeEventListener(type, listener, true),
});

describe('[host:fansly] the video player’s requests (vhs-requests.ts)', () => {
  it('VHS’s range-less probe of a track asks for the track’s head and goes past the worker, in a new object', () => {
    const options = probe();
    const tuned = tune(options);
    expect(tuned).toEqual({ timeout: 45_000, uri: `${TRACK}?ngsw-bypass=true`, beforeSend: options['beforeSend'], headers: { Range: PROBE_RANGE } });
    expect(PROBE_RANGE).toBe('bytes=0-65535');
    expect(tuned).not.toBe(options);
    expect(options).toEqual({ timeout: 45_000, uri: TRACK, beforeSend: options['beforeSend'] });
    // Every shape of the probe: an audio track, the other fMP4 endings, an empty or text answer, `get`, the stand's loopback.
    const variants = [
      probe(TRACK.replace('media-video-avc1-2.mp4', 'media-audio-und-mp4a.40.2-1.mp4')),
      probe(TRACK.replace('.mp4', '.m4s')),
      probe(TRACK.replace('.mp4', '.m4a')),
      probe(TRACK.replace('.mp4', '.M4V')),
      probe(TRACK, { responseType: '' }),
      probe(TRACK, { responseType: 'text' }),
      probe(TRACK, { method: 'get' }),
      probe('http://localhost:47123/new/1/2/media-video-avc1-2.mp4'),
      probe('https://cdn.fansly.com/new/1/2/a.mp4'),
      probe('https://cdn2.fansly.com/new/1/2/a.mp4'),
    ];
    for (const variant of variants) expect(headersOf(tune(variant))).toEqual({ Range: PROBE_RANGE });
  });

  it('the manifest, the segments, the init, the follow-up index read and a range of its own keep their headers', () => {
    expect(headersOf(tune({ uri: MPD, withCredentials: false }))).toBeUndefined();
    for (const range of ['bytes=0-692', 'bytes=693-1144', 'bytes=1145-248070']) {
      expect(headersOf(tune({ uri: TRACK, responseType: 'arraybuffer', headers: { Range: range } }))).toEqual({ Range: range });
    }
    // A probe that names its range already, in any case of the name; one that reads a byte range by VHS's own key.
    expect(headersOf(tune(probe(TRACK, { headers: { range: 'bytes=5-9' } })))).toEqual({ range: 'bytes=5-9' });
    expect(headersOf(tune(probe(TRACK, { headers: { RANGE: 'bytes=5-9' } })))).toEqual({ RANGE: 'bytes=5-9' });
    expect(headersOf(tune(probe(TRACK, { byterange: { offset: 0, length: 10 } })))).toBeUndefined();
    expect(headersOf(tune({ uri: TRACK, responseType: 'arraybuffer', beforeSend: () => undefined }))).toBeUndefined();
    // Still past the worker, each of them.
    expect(uriOf(tune({ uri: MPD }))).toBe(`${MPD}?ngsw-bypass=true`);
    expect(uriOf(tune({ uri: TRACK, responseType: 'arraybuffer', headers: { Range: 'bytes=0-692' } }))).toBe(`${TRACK}?ngsw-bypass=true`);
  });

  it('a request that is not the player’s, or that it cannot read as VHS would, is given back as it came', () => {
    const untouched = [
      probe('https://example.com/new/1/2/a.mp4'),
      probe('https://cdn3.fansly.com.evil.example/new/1/2/a.mp4'),
      probe('http://cdn3.fansly.com/new/1/2/a.mp4'),
      probe('https://apiv3.fansly.com/new/1/2/a.mp4'),
      probe('https://cdn3.fansly.com/new/1/2/a.jpeg'),
      // An upload, another method.
      probe('https://mediav2.fansly.com/new/1/2/a.mp4', { method: 'POST', body: 'x' }),
      probe(TRACK, { method: 'PUT', body: 'x' }),
      probe(TRACK, { method: 'HEAD' }),
      probe(TRACK, { method: 7 }),
      // No address, or none that parses.
      probe('http://['),
      { timeout: 45_000, uri: 7, beforeSend: () => undefined },
      { timeout: 45_000, beforeSend: () => undefined },
      // Headers that are no plain object.
      probe(TRACK, { headers: ['Range', 'bytes=0-1'] }),
      probe(TRACK, { headers: 'Range: bytes=0-1' }),
    ];
    for (const options of untouched) expect(tune(options)).toBe(options);
    for (const options of [null, undefined, 'x', 7]) expect(tune(options)).toBe(options);
  });

  it('the address: `url` without `uri`, the bypass once and before a fragment, the query’s bytes kept, a signed one never', () => {
    const byUrl = tune({ url: TRACK, beforeSend: () => undefined }) as Plain;
    expect(byUrl).toMatchObject({ url: `${TRACK}?ngsw-bypass=true`, headers: { Range: PROBE_RANGE } });
    expect('uri' in byUrl).toBe(false);
    expect(uriOf(tune(probe(`${TRACK}?ngsw-bypass=true`)))).toBe(`${TRACK}?ngsw-bypass=true`);
    expect(uriOf(tune({ uri: `${MPD}?a=1&ngsw-bypass=true&b=2` }))).toBe(`${MPD}?a=1&ngsw-bypass=true&b=2`);
    const once = tune(probe());
    expect(tune(once)).toBe(once);
    expect(uriOf(tune({ uri: `${MPD}#t=5` }))).toBe(`${MPD}?ngsw-bypass=true#t=5`);
    expect(uriOf(tune({ uri: `${MPD}?a=1#x?y` }))).toBe(`${MPD}?a=1&ngsw-bypass=true#x?y`);
    expect(uriOf(tune({ uri: `${MPD}?` }))).toBe(`${MPD}?&ngsw-bypass=true`);
    expect(uriOf(tune({ uri: `${MPD}?Policy=eyJ~a_b-&Key-Pair-Id=K~1%7E` }))).toBe(`${MPD}?Policy=eyJ~a_b-&Key-Pair-Id=K~1%7E&ngsw-bypass=true`);
    // A signed address goes as it is; its probe still gets the Range. Outside `/new/` no bypass either.
    const signed = tune(probe(`${TRACK}?Expires=1&Signature=a~b&Key-Pair-Id=K`));
    expect(signed).toMatchObject({ uri: `${TRACK}?Expires=1&Signature=a~b&Key-Pair-Id=K`, headers: { Range: PROBE_RANGE } });
    expect(tune(probe('https://cdn3.fansly.com/old/1/a.mp4'))).toMatchObject({ uri: 'https://cdn3.fansly.com/old/1/a.mp4', headers: { Range: PROBE_RANGE } });
    // A relative address, resolved against the page's.
    expect(tune(probe('//cdn3.fansly.com/new/1/2/a.mp4'))).toMatchObject({ uri: '//cdn3.fansly.com/new/1/2/a.mp4?ngsw-bypass=true', headers: { Range: PROBE_RANGE } });
    const insecure = probe('//cdn3.fansly.com/new/1/2/a.mp4');
    expect(tune(insecure, 'http://fansly.example/')).toBe(insecure);
  });

  it('the headers it was given are copied, never changed, and the new ones are an ordinary object', () => {
    const given = Object.assign(Object.create(null) as Plain, { 'X-Probe': '1' });
    const tuned = tune(probe(TRACK, { headers: given }));
    expect(headersOf(tuned)).toEqual({ 'X-Probe': '1', Range: PROBE_RANGE });
    expect(headersOf(tuned)).not.toBe(given);
    expect(Object.keys(given)).toEqual(['X-Probe']);
    // `@videojs/xhr` asks the headers `hasOwnProperty` of each name.
    expect(Object.getPrototypeOf(headersOf(tuned))).toBe(Object.prototype);
  });
});

describe('[host:fansly] the hook on the page’s VHS (installVhsRequests)', () => {
  it('stands at once when video.js is there; VHS makes the probe ranged and Fansly’s `beforeRequest` still gets an object', () => {
    const faults: string[] = [];
    const vhs = fakeVhs();
    const win = mini();
    Reflect.set(win, 'videojs', vhs.videojs);
    const video = installVhsRequests(win, ORIGINS, nativesOf(faults));
    expect(video.attach()).toBe(true);
    expect(video.attach()).toBe(true);
    expect(vhs.hooks()).toHaveLength(1);
    expect(vhs.request(probe())).toMatchObject({ uri: `${TRACK}?ngsw-bypass=true`, headers: { Range: PROBE_RANGE }, withCredentials: true });
    // A request that is not ours goes on as it came, Fansly's own hook after it.
    const other = vhs.request({ uri: 'https://example.com/a.mp4' });
    expect(other).toEqual({ timeout: 45_000, uri: 'https://example.com/a.mp4', withCredentials: true });
    expect(faults).toEqual([]);
  });

  it('a failure of its own is counted and the options go on as they came, so the next hook still gets them', () => {
    const faults: string[] = [];
    const vhs = fakeVhs();
    const win = mini();
    Reflect.set(win, 'videojs', vhs.videojs);
    installVhsRequests(win, ORIGINS, nativesOf(faults));
    const odd = Object.defineProperty({}, 'uri', {
      enumerable: true,
      get: () => {
        throw new Error('no address');
      },
    });
    const [hook] = vhs.hooks();
    expect(hook?.(odd)).toBe(odd);
    expect(faults).toEqual(['vhsRequests']);
  });

  it('a video.js loaded later gets it at its script’s load, and the listener goes then', () => {
    const faults: string[] = [];
    const win = mini();
    const video = installVhsRequests(win, ORIGINS, nativesOf(faults));
    expect(video.attach()).toBe(false);
    win.document.dispatchEvent(new Event('load'));
    expect(video.attach()).toBe(false);
    const vhs = fakeVhs();
    Reflect.set(win, 'videojs', vhs.videojs);
    win.document.dispatchEvent(new Event('load'));
    expect(vhs.hooks()).toHaveLength(1);
    // No listener any more: another video.js after it is not looked at.
    const again = fakeVhs();
    Reflect.set(win, 'videojs', again.videojs);
    win.document.dispatchEvent(new Event('load'));
    expect(again.hooks()).toEqual([]);
    expect(faults).toEqual([]);
  });

  it('a relative address is resolved against the page’s address of the moment, not of the start', () => {
    const vhs = fakeVhs();
    const win = mini();
    Reflect.set(win, 'videojs', vhs.videojs);
    installVhsRequests(win, ORIGINS, nativesOf([]));
    const relative = '//cdn3.fansly.com/new/1/2/media-video-avc1-2.mp4';
    (win.location as { href: string }).href = 'http://fansly.example/creator/vault';
    expect(vhs.request(probe(relative))['headers']).toBeUndefined();
    (win.location as { href: string }).href = 'https://fansly.com/messages';
    expect(vhs.request(probe(relative))['headers']).toEqual({ Range: PROBE_RANGE });
  });

  it('restore() takes the hook off and stops looking for one', () => {
    const vhs = fakeVhs();
    const win = mini();
    Reflect.set(win, 'videojs', vhs.videojs);
    const video = installVhsRequests(win, ORIGINS, nativesOf([]));
    video.restore();
    expect(vhs.hooks()).toEqual([]);
    expect(video.attach()).toBe(false);
    const late = mini();
    const waiting = installVhsRequests(late, ORIGINS, nativesOf([]));
    waiting.restore();
    const lateVhs = fakeVhs();
    Reflect.set(late, 'videojs', lateVhs.videojs);
    late.document.dispatchEvent(new Event('load'));
    expect(waiting.attach()).toBe(false);
    expect(lateVhs.hooks()).toEqual([]);
  });
});

describe('[host:fansly] the video hook in Fansly’s MAIN (index.ts)', () => {
  const disposals: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposals.splice(0)) dispose();
  });
  const install = (win: PageWindow): ReturnType<typeof installFanslyMain> => {
    const main = installFanslyMain(win, NETWORK);
    disposals.push(() => main.dispose());
    return main;
  };
  const withVhs = (win: PageWindow): FakeVhs => {
    const vhs = fakeVhs();
    Reflect.set(win, 'videojs', vhs.videojs);
    return vhs;
  };
  const legacy = (win: PageWindow): void => {
    Reflect.set(win, Symbol.for('chatgoose.socketTap'), true);
  };

  it('a late injection: at once', () => {
    const win = page('complete');
    const vhs = withVhs(win);
    install(win);
    expect(vhs.hooks()).toHaveLength(1);
  });

  it('at DOMContentLoaded, once Fansly’s deferred scripts have run', () => {
    const win = page();
    install(win);
    const vhs = withVhs(win);
    expect(vhs.hooks()).toEqual([]);
    win.document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(vhs.hooks()).toHaveLength(1);
  });

  it('at a script’s load, before DOMContentLoaded', () => {
    const win = page();
    install(win);
    const vhs = withVhs(win);
    win.document.dispatchEvent(new Event('load'));
    expect(vhs.hooks()).toHaveLength(1);
  });

  it('at the start of the page’s next request: a manifest’s, before the probe that follows it', () => {
    const win = page();
    install(win);
    const vhs = withVhs(win);
    request(win, MPD);
    expect(vhs.hooks()).toHaveLength(1);
    request(win, TRACK);
    expect(vhs.hooks()).toHaveLength(1);
  });

  it('the old extension’s page gets none; one that shows up later takes it off (FS-CO-1)', () => {
    const old = page();
    legacy(old);
    const none = withVhs(old);
    install(old);
    old.document.dispatchEvent(new Event('load'));
    old.document.dispatchEvent(new Event('DOMContentLoaded'));
    request(old, MPD);
    expect(none.hooks()).toEqual([]);

    const win = page('complete');
    const vhs = withVhs(win);
    install(win);
    expect(vhs.hooks()).toHaveLength(1);
    legacy(win);
    request(win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    expect(vhs.hooks()).toEqual([]);
  });

  it('an update’s second copy of MAIN in the same document: the hook stays, and stays the only one', () => {
    const win = page('complete');
    const vhs = withVhs(win);
    const first = install(win);
    const second = install(win);
    expect(second).toBe(first);
    expect(vhs.hooks()).toHaveLength(1);
    first.dispose();
    expect(vhs.hooks()).toHaveLength(1);
    expect(vhs.request(probe())['headers']).toEqual({ Range: PROBE_RANGE });
  });
});
