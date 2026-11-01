// «Рассылки» on the hub (hub `outreach-store-v1`) as the window asks the background for them: the page's list, one
// outreach, a save (in requests of at most 50 fans), a fan's send, the touches of the last 72 hours. Each answer read as
// one of three: the hub has none of it here (`off`: an older hub, the page not granted — the window keeps its outreaches
// on this computer), the hub did not answer (`offline`: kept and sent again later — a save or a report, never a claim),
// or the hub refused this request (`refused`: not sent again as it is).

import { type CgErrorWire } from '@cg/contracts/errors';
import {
  type OutreachStoreList,
  type OutreachStoreOutreach,
  type OutreachStoreSaveBody,
  type OutreachStoreSaved,
  type OutreachStoreSendAnswer,
  type OutreachStoreSendBody,
  type OutreachStoreTouches,
} from '@cg/contracts/hub';

import { splitSave } from '../../domain/outreach/sync';
import { type TabRpc } from '../boards/ports';

/** `status`: the hub's HTTP status of a refusal (404 — no such outreach of the page), when it answered one. */
export type HubAnswer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: 'off' | 'offline' | 'refused'; readonly code: string; readonly status: number | null };

/** The hub has no outreaches for this client or page: the window keeps them on this computer. */
const OFF = new Set(['CG-HUB-CAPABILITY', 'CG-FEATURE-DISABLED', 'CG-BINDING-NOT-GRANTED', 'CG-BINDING-MISSING', 'CG-HUB-OUTDATED', 'CG-HUB-FORBIDDEN', 'CG-AUTH-REJECTED', 'CG-AUTH-REQUIRED']);
/** The hub refused this request as it is: sending it again changes nothing. */
const REFUSED = new Set(['CG-HUB-REQUEST', 'CG-HUB-UNKNOWN']);

export function kindOf(error: CgErrorWire): 'off' | 'offline' | 'refused' {
  if (OFF.has(error.code)) return 'off';
  if (REFUSED.has(error.code)) return 'refused';
  // The network, a timeout, the hub busy or down, the background's port away: it may go next time.
  return 'offline';
}

export interface OutreachHub {
  list(pageId: number): Promise<HubAnswer<OutreachStoreList>>;
  get(pageId: number, outreachId: string): Promise<HubAnswer<OutreachStoreOutreach>>;
  /** A save in as many requests as its fans need; the answer of the last one (the whole outreach). */
  save(pageId: number, outreachId: string, body: OutreachStoreSaveBody): Promise<HubAnswer<OutreachStoreSaved>>;
  send(pageId: number, outreachId: string, body: OutreachStoreSendBody): Promise<HubAnswer<OutreachStoreSendAnswer>>;
  touches(pageId: number): Promise<HubAnswer<OutreachStoreTouches>>;
}

export function createOutreachHub(rpc: TabRpc): OutreachHub {
  const read = async <T>(ask: () => Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire }>): Promise<HubAnswer<T>> => {
    const answer = await ask().catch((): { readonly ok: false; readonly error: CgErrorWire } => ({ ok: false, error: { code: 'CG-NETWORK' } }));
    return answer.ok ? { ok: true, value: answer.payload } : { ok: false, kind: kindOf(answer.error), code: answer.error.code, status: answer.error.httpStatus ?? null };
  };
  return {
    list: (pageId) => read(() => rpc.request('outreach.list', { pageId })),
    get: (pageId, outreachId) => read(() => rpc.request('outreach.get', { pageId, outreachId })),
    async save(pageId, outreachId, body) {
      let last: HubAnswer<OutreachStoreSaved> = { ok: false, kind: 'refused', code: 'CG-HUB-REQUEST', status: null };
      for (const part of splitSave(body)) {
        last = await read(() => rpc.request('outreach.save', { pageId, outreachId, body: part }));
        if (!last.ok) return last;
      }
      return last;
    },
    send: (pageId, outreachId, body) => read(() => rpc.request('outreach.send', { pageId, outreachId, body })),
    touches: (pageId) => read(() => rpc.request('outreach.touches', { pageId })),
  };
}
