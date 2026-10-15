// Early, site-only transport. RPC retains unsent requests through reconnect;
// at most 32 batches are outstanding (each has at most 512 text-free facts).
// The background waits for the first presence of the new tab session.
import type { SoundBatch } from '@cg/contracts/sound';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import type { TabRpcClient } from '@cg/platform';

import type { HostDiagnostic, StartedHost } from '../../adapter';

export function soundTransport(host: Promise<Pick<FanslyPort, 'onSoundBatch'>>, diagnostic: (event: HostDiagnostic) => void): NonNullable<StartedHost['background']> {
  return {
    validate(kind, type, payload) {
      if (kind !== 'res' || type !== 'fansly.sound.batch') return null;
      return typeof payload === 'object' && payload !== null && Object.keys(payload).length === 1 && typeof (payload as { recorded?: unknown }).recorded === 'boolean' ? { ok: true, payload } : { ok: false };
    },
    connect(rpc, life) {
      let pending = 0;
      void host.then((port) => {
        if (life.aborted) return;
        // The shared client is typed by the shared registry only; this schema and
        // sender check belong to Fansly's background module and its registry.
        const request = rpc.request.bind(rpc) as unknown as (type: 'fansly.sound.batch', batch: SoundBatch) => ReturnType<TabRpcClient['request']>;
        const off = port.onSoundBatch((batch) => {
          if (pending === 32) { diagnostic({ event: 'sound-overflow' }); return; }
          pending += 1;
          void request('fansly.sound.batch', batch).then((answer) => {
            if (!answer.ok) diagnostic({ event: 'sound-delivery', code: answer.error.code });
          }).finally(() => { pending -= 1; });
        });
        life.addEventListener('abort', off, { once: true });
      });
    },
  };
}
