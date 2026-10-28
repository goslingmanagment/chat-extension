// Telegram's AI policy (docs/specs/2026-10-27-telegram-site.md §4.3, §4.4, §6.2; architecture §1.6): the hub keeps no
// archive of Telegram, so every start carries the open chat itself — the transcript the page rendered, read at the
// click for the identity the start froze (`clientContext`), never another chat. The verdict on a result warns, never
// blocks: the newest messages were not rendered when the chat was read («Прокрутите к последним сообщениям»), or the
// draft's payment details are not in Fix's answer character for character («Реквизиты изменились, сверьте»).
//
// What the tab keeps with the operation (the fingerprint) is whether the newest messages were in and the fingerprints
// of the draft's payment details — never a text.

import type { HostPort } from '@cg/contracts/host';
import type { AiHostPolicy, ClientContext, OpView, ResultMarkVM } from '@cg/contracts/ops';
import type { TelegramPagePort } from '@cg/contracts/telegram-host';

import { detailPrints, detailsKept } from '../../../domain/hosts/telegram/details';

/** The start's proof: the chat as the page rendered it, or why there is none. */
export type TelegramProof =
  | { readonly ok: true; readonly context: ClientContext; readonly newest: boolean; readonly details: readonly string[] }
  | { readonly ok: false };

export interface TelegramFingerprint {
  readonly newest: boolean;
  /** The draft's payment details (Fix), as fingerprints. */
  readonly details: readonly string[];
}

const pageOf = (host: HostPort): TelegramPagePort | null => (host.telegram as TelegramPagePort | undefined) ?? null;

/** The text a result put forward: its parts, or the variants' first. */
function resultText(view: OpView): string {
  const result = view.result;
  if (result === undefined) return '';
  if (result.kind === 'parts') return result.parts.join('\n');
  if (result.kind === 'variants') return result.variants.flat().join('\n');
  return '';
}

export function createTelegramAi(): AiHostPolicy<TelegramProof, TelegramFingerprint> {
  return {
    // A start that could not read its chat is refused before the token: the chat moved or is still settling.
    preflight: (_feature, _window, proof) => (proof !== null && !proof.ok ? 'chat-loading' : null),
    async proof(host, ask) {
      const page = pageOf(host);
      const read = page?.read(ask.identity) ?? null;
      if (read === null) return { ok: false };
      // Fix's draft: its payment details, as fingerprints, for the verdict on the answer.
      let details: readonly string[] = [];
      if (ask.feature === 'fix') {
        const draft = await host.readDraft(ask.identity).catch(() => null);
        details = draft === null ? [] : detailPrints(draft.plainText);
      }
      const context: ClientContext = {
        transcript: read.transcript,
        messageCount: read.messageCount,
        fanDisplayName: read.fanDisplayName.slice(0, 200),
        ...(read.newest ? { transcriptCoverage: 'window' as const } : {}),
      };
      return { ok: true, context, newest: read.newest, details };
    },
    fields: (proof) => (proof !== null && proof.ok ? { clientContext: proof.context } : {}),
    fingerprint: (proof) => (proof !== null && proof.ok ? { newest: proof.newest, details: proof.details } : null),
    verdict(view: OpView, fingerprint: TelegramFingerprint | null): ResultMarkVM | null {
      if (fingerprint === null || view.state !== 'done') return null;
      if (view.feature === 'fix' && !detailsKept(fingerprint.details, resultText(view))) return { reason: 'details-changed', at: null };
      if (!fingerprint.newest) return { reason: 'history-partial', at: null };
      return null;
    },
  };
}
