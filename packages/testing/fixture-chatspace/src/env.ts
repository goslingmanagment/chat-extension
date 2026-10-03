// Boot-time settings of the stand page: which anchors a «new build» lost
// (?stand-break=…, §6.2 degradation tests) and the few knobs tests may turn.

import { STAND_API_ORIGIN_META, STAND_BREAK_PARAM, type StandBreak } from './protocol';

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

export const env = {
  breaks: readBreaks(location.search),
  /** Origin of the native API and the socket (ChatSpace: the apex domain, not the page's chat. host). */
  apiOrigin: readApiOrigin(),
  /** This page load; native request ids are `<bootId>.<n>`, unique across reloads. */
  bootId: randomId(),
  /** The send queue's own timeout (ChatSpace: 30 s); tests shorten it to reach the timeout path quickly. */
  queueTimeoutMs: 30_000,
  /** Extra time the editor chunk takes to load, so tests can act while the bridge exists without TipTap. */
  editorChunkDelayMs: 0,
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
