import type { SoundBatch } from '@cg/contracts/sound';
import type { TabRpcClient } from '@cg/platform';
import { expect, it, vi } from 'vitest';

import { soundTransport } from '../src/composition/tab/hosts/fansly/sound';

it('[host:fansly] [SN-016] bounds outstanding reconnect requests and releases capacity after their answers', async () => {
  let emit = (_batch: SoundBatch): void => undefined;
  const off = vi.fn();
  const source = Promise.resolve({ onSoundBatch: (listener: typeof emit) => { emit = listener; return off; } });
  const report = vi.fn();
  const transport = soundTransport(source, report);
  let resolve = (_value: { ok: true; payload: { recorded: true } }): void => undefined;
  const pending = new Promise<{ ok: true; payload: { recorded: true } }>((done) => { resolve = done; });
  const request = vi.fn(() => pending);
  const life = new AbortController();
  transport.connect({ request } as unknown as TabRpcClient, life.signal);
  await source;
  const batch: SoundBatch = { host: 'fansly-web', hostAccountId: '100', events: [{ kind: 'subscriber', id: '900', accountId: '100', followerId: '200' }] };
  for (let n = 0; n < 40; n += 1) emit(batch);
  expect(request).toHaveBeenCalledTimes(32);
  expect(report).toHaveBeenCalledTimes(8);
  resolve({ ok: true, payload: { recorded: true } });
  await new Promise((done) => setImmediate(done));
  emit(batch);
  expect(request).toHaveBeenCalledTimes(33);
  expect(transport.validate('res', 'fansly.sound.batch', { recorded: true })).toMatchObject({ ok: true });
  expect(transport.validate('res', 'fansly.sound.batch', { recorded: true, extra: 1 })).toMatchObject({ ok: false });
  life.abort();
  expect(off).toHaveBeenCalledOnce();
});
