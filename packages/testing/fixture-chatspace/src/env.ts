// Boot-time settings of the stand page: which anchors a «new build» lost
// (?stand-break=…, §6.2 degradation tests), a slow start (?stand-slow-start=…)
// and the few knobs tests may turn.

import { STAND_API_ORIGIN_META, STAND_BREAK_PARAM, STAND_SENTRY_PARAM, STAND_SLOW_START_PARAM, STAND_WORLD_ATTRIBUTE, type FansOnlineTimings, type StandBreak, type UploadBehaviour } from './protocol';

const KNOWN_BREAKS = /^(vue-app|router-name|composer-bridge|composer-slot|composer-frame|editor-handle|draft-key|store:[A-Za-z_]+|query-key:[A-Za-z]+)$/;

function readBreaks(search: string): StandBreak[] {
  const raw = new URLSearchParams(search).get(STAND_BREAK_PARAM) ?? '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is StandBreak => KNOWN_BREAKS.test(item));
}

/** The API origin the page server put into the index; without one (unit tests) the page's own. */
function readApiOrigin(): string {
  const content = typeof document === 'undefined' ? null : document.querySelector(`meta[name="${STAND_API_ORIGIN_META}"]`)?.getAttribute('content');
  try {
    return content ? new URL(content).origin : location.origin;
  } catch {
    return location.origin;
  }
}

const randomId = (): string => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : String(Math.random()).slice(2, 10));

/** `?stand-slow-start=<ms>`: the app is on the page this long before its app-wide data (a slow start, as on ChatSpace 0.195). */
function readSlowStart(search: string): number {
  const ms = Number(new URLSearchParams(search).get(STAND_SLOW_START_PARAM) ?? '0');
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0;
}

export const env = {
  breaks: readBreaks(location.search),
  /**
   * How long the app is mounted before its app-wide data (accounts, permissions, Mimic) start to load. ChatSpace 0.195
   * is on the page before its stores are full: the extension that starts with it sees a broken contract for a moment
   * (third live check). 0 — the stand's usual order: the data first, then the app.
   */
  slowStartMs: readSlowStart(location.search),
  /** The showcase world (the page server's `data-stand-world` on `<html>`): the page's own words read like a working day's. */
  showcase: typeof document !== 'undefined' && document.documentElement.getAttribute(STAND_WORLD_ATTRIBUTE) === 'showcase',
  /** `?stand-sentry=1`: Sentry on the page, as on ChatSpace 0.195.0 (sentry.ts). */
  sentry: new URLSearchParams(location.search).get(STAND_SENTRY_PARAM) === '1',
  /** Origin of the native API and the socket (ChatSpace: the apex domain, not the page's chat. host). */
  apiOrigin: readApiOrigin(),
  /** This page load; native request ids are `<bootId>.<n>`, unique across reloads. */
  bootId: randomId(),
  /** The send queue's own timeout (ChatSpace: 30 s); tests shorten it to reach the timeout path quickly. */
  queueTimeoutMs: 30_000,
  /** Extra time the editor chunk takes to load, so tests can act while the bridge exists without TipTap. */
  editorChunkDelayMs: 0,
  /** Time every navigation waits in an async router guard (ChatSpace: sign-in and flag checks before the route changes). */
  routeDelayMs: 0,
  /** `account:chat` whose next bridge write is followed at once by the person's Send (`sendAfterNextWrite`); null — none. */
  sendAfterWrite: null as string | null,
  /**
   * The chat list's presence poll (ui/fans-online.ts) as ChatSpace times it: the rows on screen are asked for 2 s after
   * they changed, a fan again only after a minute, and the next look comes in 5 minutes. Tests shorten them
   * (`setFansOnlineTimings`) to reach a later round.
   */
  fansOnline: { settleMs: 2_000, freshMs: 60_000, everyMs: 300_000 } as FansOnlineTimings,
  /**
   * The composer's upload of a dropped file (ui/composer.ts): how long the stand's «upload» takes, and whether it fails.
   * Tests turn them (`setUpload`) to reach the failure or to watch the uploading tile.
   */
  upload: { delayMs: 1500, fail: false } as UploadBehaviour,
};

export function isBroken(item: StandBreak): boolean {
  return env.breaks.includes(item);
}

/** The id a store registers under; a «build» without it registers a renamed store instead. */
export function storeId(id: string): string {
  return isBroken(`store:${id}`) ? `${id}__renamed` : id;
}

/** The first element of a cache key; a «build» that renamed it uses another name. */
export function keyName(name: string): string {
  return isBroken(`query-key:${name}`) ? `${name}V2` : name;
}
