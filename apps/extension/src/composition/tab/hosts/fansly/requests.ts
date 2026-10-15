// Fansly's own requests from its tab (1.15.0; R20 P13b; docs/project-unite/architecture.md §1.6, §12): a `fansly.*`
// type over the tab's port, its answer checked by Fansly's registry here, in the chunk that asks it. The port's own
// check lets a `fansly.*` answer through as it came (lazy/fansly/tab-protocol.ts): Fansly's schemas would not fit the
// protocol layer every Fansly page loads, so they travel with the site's code that asks — the vault's chunk, and the
// boards of a Fansly tab for «Новые» (R20 P10a). The background checked the answer by the same registry on the way
// out. An event of Fansly's registry is checked the same way before anyone hears it (`fanslyEvent`, NF-027): one that
// does not fit is dropped, never half-read.

import type { CgErrorWire } from '@cg/contracts/errors';
import {
  parseFanslyTabPayload,
  type FanslyTabEventPayload,
  type FanslyTabEventType,
  type FanslyTabRequestPayload,
  type FanslyTabRequestType,
  type FanslyTabResponsePayload,
} from '@cg/contracts/tab-messages-fansly';

export type FanslyAnswer<T extends FanslyTabRequestType> = { readonly ok: true; readonly payload: FanslyTabResponsePayload<T> } | { readonly ok: false; readonly error: CgErrorWire };

/** The tab's client as it takes a request of any registry: the shared one is typed by its own types only. */
type AnyRequest = (type: string, payload: unknown, options?: { readonly timeoutMs?: number }) => Promise<{ readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly error: CgErrorWire }>;

/** The tab's client as it hears an event of any registry. */
type AnyOnEvent = (type: string, listener: (payload: unknown) => void) => () => void;

/** Any client of the tab's port: the platform's, the controllers' (`ControllerRpc`), the boards' (`TabRpc`). */
interface FanslyRpc {
  readonly request: unknown;
}

export async function fanslyRequest<T extends FanslyTabRequestType>(rpc: FanslyRpc, type: T, payload: FanslyTabRequestPayload<T>, timeoutMs?: number): Promise<FanslyAnswer<T>> {
  const answer = await (rpc.request as AnyRequest)(type, payload, timeoutMs === undefined ? undefined : { timeoutMs });
  if (!answer.ok) return answer;
  const checked = parseFanslyTabPayload('res', type, answer.payload);
  return checked.ok ? { ok: true, payload: checked.payload as FanslyTabResponsePayload<T> } : { ok: false, error: { code: 'CG-UNKNOWN', detail: `invalid ${type} response` } };
}

/** An event of Fansly's registry, checked by it before the listener hears it; a payload that does not fit is dropped. */
export function fanslyEvent<T extends FanslyTabEventType>(rpc: { readonly onEvent: unknown }, type: T, listener: (payload: FanslyTabEventPayload<T>) => void): () => void {
  return (rpc.onEvent as AnyOnEvent)(type, (payload) => {
    const checked = parseFanslyTabPayload('evt', type, payload);
    if (checked.ok) listener(checked.payload as FanslyTabEventPayload<T>);
  });
}
