// Hi in a new fan's chat (a2, in a new ChatSpace tab): three greetings to choose from.

import { scenario } from '../kit';

scenario('hi', async (s) => {
  await s.openChat(s.ids.fans.a2, true);
  await s.ready();
  await s.press(/^Hi/);
  await s.done();
  await s.shot('hi');
});
