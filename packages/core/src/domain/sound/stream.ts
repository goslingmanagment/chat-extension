import type { SoundBatch, SoundStreamEvent } from '@cg/contracts/sound';
import type { SettingsV1 } from '@cg/contracts/settings';

import { accountKeyOf, gateMessage, isMuted, type SoundOutcome } from './policy';

/** Socket subscribers need neither a hub session nor a polling baseline. */
export function gateStreamEvent(input: {
  readonly batch: SoundBatch;
  readonly event: SoundStreamEvent;
  readonly sound: SettingsV1['sound'];
  readonly ownerSwitch: boolean | null;
  readonly hostPermission: boolean;
  readonly known: boolean;
  readonly mutedAlias: boolean;
  readonly own: boolean;
  readonly recipient: boolean;
  readonly now: number;
}): SoundOutcome | null {
  const { batch, event, sound } = input;
  const key = accountKeyOf(batch);
  if (event.kind === 'message') {
    const outcome = gateMessage({
      ...input,
      fact: { host: batch.host, hostAccountId: batch.hostAccountId, platformFanId: event.senderId, platformMessageId: event.id,
        fromFan: event.fromFan && !input.own, automatic: event.automatic, tip: event.tip, sentAt: event.sentAt,
        source: 'ws-tap', socketEpoch: 0, fanSequence: 0 },
      phase: 'live', account: { key, known: input.known },
    });
    return outcome ?? (input.mutedAlias ? 'muted' : null);
  }
  if (!sound.subscribers.on || input.ownerSwitch === false) return 'disabled';
  if (!input.hostPermission) return 'no-permission';
  // A copy from an unbound/wrong account must not consume the correctly bound tab's event.
  if (!input.known || !input.recipient) return 'account-unknown';
  if (input.own) return 'not-fan';
  if (input.mutedAlias || isMuted(sound, key)) return 'muted';
  return null;
}
