// `pnpm stand`: builds nothing, serves the stand on a fixed loopback port for
// a look by hand (the fixture must be built: `pnpm --filter @cg/testing build:stand`).

import { startStandServer } from './stand-server';
import { STAND_IDS } from './stand/dataset';

const port = Number(process.env['STAND_PORT'] ?? 5179);
const apiPort = Number(process.env['STAND_API_PORT'] ?? port + 1);
const fanslyPort = Number(process.env['STAND_FANSLY_PORT'] ?? port + 2);
const stand = await startStandServer({ port, apiPort, fanslyPort, fanslyApiPort: fanslyPort + 1, fanslySocketPort: fanslyPort + 2, fanslyProxyPort: fanslyPort + 3 });
console.log(`stand: ${stand.origin}/accounts/${STAND_IDS.accounts.a}/chats/${STAND_IDS.fans.a1} (API and socket on ${stand.apiOrigin})`);
console.log(`stand: Fansly ${stand.fansly.origin}/messages (fake API ${stand.fansly.fake.apiOrigin}, socket ${stand.fansly.fake.socketUrl}, proxy ${stand.fansly.fake.proxy.host})`);
console.log('stand: Ctrl+C to stop');
const stop = (): void => {
  void stand.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
