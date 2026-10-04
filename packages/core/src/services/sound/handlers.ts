// The sound protocol (architecture.md §5.4, §9.8; SN-016, ST-131): handlers
// of `sound.event` and `sound.preview` for the background's composition root
// (`rpc.handle(type, handlers[type])`). The RPC has already checked the
// sender — `sound.event` only from the top frame of a ChatSpace tab,
// `sound.preview` only from the options page — and the payload schema.

import { type CgCode } from '@cg/contracts/errors';
import { type IncomingFact } from '@cg/contracts/host';
import { type ToneId } from '@cg/contracts/settings';

import { type SoundArbiter } from './arbiter';

type Answer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: CgCode } };
type Sender = { readonly kind: 'tab'; readonly tabSessionId: string } | { readonly kind: 'page' };

export function soundRequestHandlers(arbiter: Pick<SoundArbiter, 'handleIncoming' | 'preview'>): {
  readonly 'sound.event': (request: { readonly fact: IncomingFact }, sender: Sender) => Promise<Answer<{ played: boolean; reason?: string }>>;
  readonly 'sound.preview': (request: { readonly tone: ToneId; readonly volume: number }) => Promise<Answer<{ played: boolean; code?: CgCode }>>;
} {
  return {
    'sound.event': async (request, sender) => {
      // A fact has a tab behind it: a page of the extension never reports one.
      if (sender.kind !== 'tab') return { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } };
      const outcome = await arbiter.handleIncoming(sender.tabSessionId, request.fact);
      return { ok: true, payload: outcome === 'played' ? { played: true } : { played: false, reason: outcome } };
    },
    'sound.preview': async (request) => {
      const result = await arbiter.preview(request.tone, request.volume);
      return { ok: true, payload: result.code === undefined ? { played: result.played } : { played: result.played, code: result.code } };
    },
  };
}
