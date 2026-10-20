// Hi in the open chat on Fansly when the tab holds no proof of the conversation's start (FS-AI-2). The tab proves a
// start only from the page's own fresh-end answer to a request begun after the socket's `t:1` (host-fansly
// certificate.ts), so a cold load or a new socket leaves the chat on screen without one, and the hub refuses Hi
// (`history_unproven`). The old extension read one page of the history itself on every Hi. Here the background reads
// the history to its empty page as the pass of «Новые» does (pass-rules.ts) and proves the start the same way
// (`pass-empty-page`), a proof the hub already takes. A conversation whose newest 30 messages hold more than ten
// personal ones is a dialog, and the walk stops there.

import { FANSLY_LIMITS, type StartProofV1 } from '@cg/contracts/fansly';

import { byId, countsPersonal, passStartProof, PASS_BOUNDS, readHistoryPage, readWelcomeTexts, type PassMessage } from '../../../domain/hosts/fansly/newcomers/pass-rules';

/** Pages of 25 a Hi reads at most: past a hundred messages the start stays unproven. */
export const HI_START_PAGES = 4;
/** AI-031: more personal messages than this and Hi is the wrong feature. */
const HI_PERSONAL_MAX = 10;

export type HiStartRead =
  /** The history was read to its empty page. */
  | { readonly kind: 'proof'; readonly proof: StartProofV1 }
  /** More than ten personal messages among the newest 30: a dialog, Reply's. */
  | { readonly kind: 'dialog' }
  /** The start was not reached: a page that is not this chat's, or a history longer than the walk. */
  | { readonly kind: 'unproven' };

/** Fansly's answers as they came (`GET /message?groupId=`, `GET /message/automated`); a failed request throws. */
export interface HiStartPort {
  history(query: Readonly<Record<string, string>>): Promise<unknown>;
  automated(): Promise<unknown>;
}

export interface HiStartChat {
  readonly creatorId: string;
  readonly fanId: string;
  readonly groupId: string;
}

export async function readHiStart(port: HiStartPort, chat: HiStartChat, now: number): Promise<HiStartRead> {
  // The welcome texts tell an automated message from a personal one; without them a welcome counts as personal.
  const welcome = readWelcomeTexts(await port.automated().catch(() => null)) ?? new Set<string>();
  const users = [chat.creatorId, chat.fanId];
  const walked = new Map<string, PassMessage>();
  let cursor: string | null = null;
  for (let page = 0; page < HI_START_PAGES; page += 1) {
    const query: Record<string, string> = { groupId: chat.groupId, limit: String(PASS_BOUNDS.historyPage) };
    if (cursor !== null) query['before'] = cursor;
    const messages = readHistoryPage(await port.history(query), chat.groupId, users, now);
    if (messages === null) return { kind: 'unproven' };
    if (messages.length === 0) return { kind: 'proof', proof: passStartProof(chat.groupId, [...walked.values()].sort(byId), chat.creatorId, welcome) };
    for (const message of messages) walked.set(message.id, message);
    const newest = [...walked.values()].sort(byId).slice(-FANSLY_LIMITS.passPersonalWindow);
    if (newest.filter((message) => countsPersonal(message, chat.creatorId, welcome)).length > HI_PERSONAL_MAX) return { kind: 'dialog' };
    const oldest = [...messages].sort(byId)[0]?.id ?? null;
    if (oldest === null || oldest === cursor) return { kind: 'unproven' };
    cursor = oldest;
  }
  return { kind: 'unproven' };
}
