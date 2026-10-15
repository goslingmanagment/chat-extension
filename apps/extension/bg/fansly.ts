// First Fansly background module (P9a). The core captures and persists passive
// observations even when this chunk has never loaded. P9b adds its API/pacer
// here, over the same session owner; a handshake restores this module after
// the first optional grant, whose late webRequest listener cannot wake Firefox.
import type { BackgroundHostHandle, BackgroundHostModule, BackgroundKit } from '../src/composition/background/host-module';

let started: Promise<BackgroundHostHandle> | null = null;
async function start(kit: BackgroundKit): Promise<BackgroundHostHandle> {
  await kit.networkSession?.ready;
  return {
    onTabMessage: () => Promise.resolve({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }),
    onEvent: () => Promise.resolve(),
    facts: () => ({}),
    dispose: () => Promise.resolve(),
  };
}
export default { host: 'fansly-web', start: (kit) => started ??= start(kit) } satisfies BackgroundHostModule;
