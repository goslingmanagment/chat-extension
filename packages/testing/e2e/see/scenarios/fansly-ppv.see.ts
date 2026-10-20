// Fansly: Reply in a chat where the creator sent two paid attachments — a video the fan bought (its order inline on the
// chat's page) and a bundle the fan did not (an empty order history) — on a hub that takes the PPV state
// (`live-ppv-fansly-v1`). The background reads the chat's newest pages and the bundle's order history by the click;
// `hub-calls.json` shows the `livePpvContext` Reply sent: the video `purchased: true`, the bundle `purchased: false`.

import { PILOT_CAPABILITIES } from '../../../src/fake-hub/config';
import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

scenario(
  'fansly-ppv',
  async (s) => {
    await s.ready();
    await s.press(/^Reply/);
    await s.done();
    await s.shot('fansly-ppv-reply');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { capabilities: [...PILOT_CAPABILITIES, 'live-ppv-fansly-v1'] } });
      const groupId = WORLD.fansly.chats.a.group;
      await fakeFansly().command({ op: 'ppv', groupId, kind: 'media', priceUsd: 20, purchased: true, text: 'a little video for you 🙈' });
      await fakeFansly().command({ op: 'ppv', groupId, kind: 'bundle', priceUsd: 35, text: 'the whole set, unlock it 😏' });
    },
  },
);
