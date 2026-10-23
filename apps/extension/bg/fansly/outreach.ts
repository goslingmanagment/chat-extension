// «Рассылка» of Spenders in Fansly's background chunk: a row's «Отправить» (contracts `fansly.spenders.outreach`).
//
// - The click's `send` token (the board's sends are the preview's surface, as X8's) is redeemed first: no timer, key or other surface sends.
// - The tab's session is the creator's (checked by the caller, as for Spenders' own reads); Fansly is on (BEGINS).
// - One attempt in flight per creator and fan (`CG-SEND-BUSY`); one request (fansly-api `sendOutreach`, FS-NET-1
//   `outreach`), never repeated here: a request that left with no receipt is `CG-SEND-UNCERTAIN`.
// - Nothing of the text is logged.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';
import { sendOutreach } from '@cg/fansly-api/spenders';

import type { BackgroundKit } from '../../src/composition/background/host-module';

type Request = FanslyTabRequestPayload<'fansly.spenders.outreach'>;
type Answer = FanslyTabResponsePayload<'fansly.spenders.outreach'>;

/** A failed send: what Fansly answered (provably not sent), or `CG-SEND-UNCERTAIN` when the request left and its fate is unknown. */
export function outreachFailure(error: unknown): CgAnyErrorWire {
  if (!(error instanceof FanslyApiError)) return { code: 'CG-SEND-UNCERTAIN' };
  const unknownFate = error.sent && (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'malformed' || error.kind === 'aborted' || (error.kind === 'http' && (error.httpStatus ?? 0) >= 500));
  return unknownFate ? { code: 'CG-SEND-UNCERTAIN' } : error.toWire();
}

export function createOutreachService(kit: Pick<BackgroundKit, 'tokens' | 'log'>, clientNow: () => Promise<Pick<FanslyClient, 'call'> | null>) {
  const busy = new Set<string>();
  return async function send(request: Request, tabSessionId: string): Promise<Answer> {
    if (!kit.tokens.redeem({ tabSessionId, kind: 'send', surface: 'preview', actionToken: request.cause.actionToken })) return { ok: false, error: { code: 'CG-UI-FAILED' } };
    const key = `${request.hostAccountId}|${request.fanRef}`;
    if (busy.has(key)) return { ok: false, error: { code: 'CG-SEND-BUSY' } };
    busy.add(key);
    try {
      const client = await clientNow();
      if (client === null) return { ok: false, error: { code: 'CG-FAN-SESSION' } };
      const messageId = await sendOutreach(client, request.hostAccountId, { groupId: request.groupId, text: request.text, attachments: request.attachments });
      kit.log.service({ level: 'info', scope: 'fansly.outreach', msg: 'sent', fields: { attachments: request.attachments.length } });
      return { ok: true, messageId };
    } catch (error) {
      const wire = outreachFailure(error);
      kit.log.service({ level: 'warn', scope: 'fansly.outreach', msg: 'not sent', fields: { code: wire.code } });
      return { ok: false, error: wire };
    } finally {
      busy.delete(key);
    }
  };
}
