// Fansly: whether the fan read our newest message in a Spenders preview — the group's last message read by the
// background (`GET /group/<id>/`): «не прочитано» until the fan reads it, then «прочитано в …» (Fansly says when).

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const { group, fan } = WORLD.fansly.chats.b;

scenario(
  'fansly-seen',
  async (s) => {
    await s.ready();
    const sent = (await fakeFansly().command({ op: 'message', groupId: group, from: 'creator', text: 'Did you like the new set?' })) as { message: { id: string } };
    // Out of Fansly's field: our key is a command there, not text.
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Hub Birch');
    await s.press(/^Hub Birch/, 'modal', '[data-cg-key^="fan:"]');
    await s.see('modal', 'не прочитано', 20_000);
    await s.shot('fansly-unread');
    await fakeFansly().command({ op: 'ack', messageIds: [sent.message.id], type: 3 });
    await s.see('modal', /прочитано в/, 45_000);
    await s.shot('fansly-read');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      await hub.command({ op: 'spenderFans', fans: [{ fanRef: fan, displayName: 'Hub Birch', lifetimeUsd: 900, windowUsd: 100 }] });
      await hub.command({ op: 'config', patch: { spendersTotal: 1 } });
    },
  },
);
