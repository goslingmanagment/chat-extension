// The fan panel (]) of the open chat.

import { scenario } from '../kit';

scenario('fan-panel', async (s) => {
  await s.ready();
  await s.leaveField();
  await s.keys(']');
  await s.see('panel', 'Fan Alder');
  await s.shot('fan-panel');
});
