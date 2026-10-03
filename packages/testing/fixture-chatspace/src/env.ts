// Boot-time settings of the stand page: which anchors a «new build» lost
// (?stand-break=…, §6.2 degradation tests) and the few knobs tests may turn.

import { STAND_BREAK_PARAM, type StandBreak } from './protocol';

const KNOWN_BREAKS = /^(vue-app|router-name|composer-bridge|composer-slot|composer-frame|editor-handle|draft-key|store:[A-Za-z_]+|query-key:[A-Za-z]+)$/;

function readBreaks(search: string): StandBreak[] {
  const raw = new URLSearchParams(search).get(STAND_BREAK_PARAM) ?? '';
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is StandBreak => KNOWN_BREAKS.test(item));
}

export const env = {
  breaks: readBreaks(location.search),
  /** The send queue's own timeout (ChatSpace: 30 s); tests shorten it to reach the timeout path quickly. */
  queueTimeoutMs: 30_000,
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
