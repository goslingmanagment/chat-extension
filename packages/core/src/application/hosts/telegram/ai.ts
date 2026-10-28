// Telegram's AI policy (docs/specs/2026-10-27-telegram-site.md §4.3, §4.4, §6.2; architecture §1.6): the hub keeps no
// archive of Telegram, so every start carries the open chat itself — the transcript the page rendered, read at the
// click for the identity the start froze (`clientContext`), never another chat. The verdict on a result warns, never
// blocks: the newest messages were not rendered when the chat was read («Прокрутите к последним сообщениям»).
//
// What the tab keeps with the operation (the fingerprint) is whether the newest messages were in, never a text.

import type { HostPort } from '@cg/contracts/host';
import type { AiHostPolicy, ClientContext, OpView, ResultMarkVM } from '@cg/contracts/ops';
import type { TelegramPagePort } from '@cg/contracts/telegram-host';

/** The start's proof: the chat as the page rendered it, or why there is none. */
export type TelegramProof =
  | { readonly ok: true; readonly context: ClientContext; readonly newest: boolean }
  | { readonly ok: false };

export interface TelegramFingerprint {
  readonly newest: boolean;
}

const pageOf = (host: HostPort): TelegramPagePort | null => (host.telegram as TelegramPagePort | undefined) ?? null;

export function createTelegramAi(): AiHostPolicy<TelegramProof, TelegramFingerprint> {
  return {
    // A start that could not read its chat is refused before the token: the chat moved or is still settling.
    preflight: (_feature, _window, proof) => (proof !== null && !proof.ok ? 'chat-loading' : null),
    proof(host, ask) {
      const page = pageOf(host);
      const read = page?.read(ask.identity) ?? null;
      if (read === null) return Promise.resolve({ ok: false });
      const context: ClientContext = {
        transcript: read.transcript,
        messageCount: read.messageCount,
        fanDisplayName: read.fanDisplayName.slice(0, 200),
        ...(read.newest ? { transcriptCoverage: 'window' as const } : {}),
      };
      return Promise.resolve({ ok: true, context, newest: read.newest });
    },
    fields: (proof) => (proof !== null && proof.ok ? { clientContext: proof.context } : {}),
    fingerprint: (proof) => (proof !== null && proof.ok ? { newest: proof.newest } : null),
    verdict(view: OpView, fingerprint: TelegramFingerprint | null): ResultMarkVM | null {
      if (fingerprint === null || view.state !== 'done') return null;
      if (!fingerprint.newest) return { reason: 'history-partial', at: null };
      return null;
    },
  };
}
