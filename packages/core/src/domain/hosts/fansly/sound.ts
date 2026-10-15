// Fansly's sound facts as the core's one arbiter takes them (R20 P14a;
// docs/project-unite/architecture.md §8.12; FS-SND-1). Pure: the report of a
// Fansly tab (`fansly.sound.facts`, a batch of MAIN) in, the shared shapes
// out — the background's Fansly chunk hands them to the arbiter through its
// kit, and the shared rules decide (core/domain/sound).
//
// - A message is the shared incoming fact of the creator's account: pushed by
//   the page's socket (`ws-tap`, always live — its own age decides
//   freshness), keyed by its message id. Its chat is the group's fan, or —
//   where MAIN does not know the group yet (a new fan's first message) — its
//   sender, who in a direct chat is that fan. Its author is the sender (a MAIN
//   of an older build names none: the fan of a fan's message): one of this
//   browser's own models is not a fan (SN-002). A message whose chat cannot
//   be named at all is left out.
// - A follow is a subscriber the page heard itself, of the creator's tab.

import type { IncomingFact } from '@cg/contracts/host';
import type { FanslySoundFacts } from '@cg/contracts/tab-messages-fansly';

import type { PageFollow } from '../../sound';

/** The site's kind, as its tab registered. */
const FANSLY = 'fansly-web';

export interface FanslySoundHeard {
  readonly messages: readonly { readonly fact: IncomingFact; readonly author: string | null }[];
  readonly follows: readonly PageFollow[];
}

export function fanslySoundOf(report: FanslySoundFacts): FanslySoundHeard {
  const messages: { fact: IncomingFact; author: string | null }[] = [];
  for (const message of report.messages) {
    const fan = message.fanId ?? message.senderId ?? null;
    if (fan === null) continue;
    messages.push({
      fact: {
        host: FANSLY,
        hostAccountId: report.creatorId,
        platformFanId: fan,
        platformMessageId: message.msgId,
        fromFan: message.fromFan,
        automatic: message.automated,
        tip: message.tip,
        sentAt: message.createdAt,
        // The socket's push: live by its source; the page's socket epochs are MAIN's own business.
        socketEpoch: 0,
        fanSequence: 0,
        source: 'ws-tap',
      },
      author: message.senderId ?? (message.fromFan ? message.fanId : null),
    });
  }
  const follows = report.follows.map((follow): PageFollow => ({ host: FANSLY, hostAccountId: report.creatorId, eventId: follow.eventId, accountId: follow.accountId, followerId: follow.followerId }));
  return { messages, follows };
}
