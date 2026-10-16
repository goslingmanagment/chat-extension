// P12a: the actual adapter/results store used by the background, not a
// map-only scheduler journal. Site schemas arrive from the owning chunk.
import { describe, expect, it } from 'vitest';
import { OpViewSchema, type AnyOpView } from '@cg/contracts/ops';
import { fanslyVoiceView } from '@cg/contracts/fixtures';
import { createResultsStore } from '@cg/core/services';
import { createFanslyOperations } from '@cg/core/services/hosts/fansly/voice-operations';
import { OPS_STORE_KEY } from '@cg/core/services';
import { opsStoreOver } from '../src/composition/background/ops-store';
import { memoryStore } from './support/memory-store';

const now = Date.now();
const operations = createFanslyOperations(() => undefined);
const readView = (raw: unknown): Promise<AnyOpView | null> => {
  const shared = OpViewSchema.safeParse(raw);
  return Promise.resolve(shared.success ? shared.data : operations.readView(raw));
};
const meta = { startedBy: 'tab', requestKey: 'identity', tag: { hubOrigin: 'https://hub.example.test', userId: 7, signInEpoch: 3, pageId: fanslyVoiceView.target.binding.pageId, personaKey: 'default', personaDefinitionId: 'pdef_0123456789abcdef' }, fanLabel: null, knownIds: [], checkpoint: null, split: false };

describe('[host:fansly] P12a storage of site operations', () => {
  it('a completed script survives the real result adapter and a fresh results store; running script becomes interrupted without its partial text', async () => {
    const session = memoryStore();
    const first = opsStoreOver(createResultsStore<AnyOpView>({ session, readView }), session);
    const completed = { ...fanslyVoiceView, endedAt: now, startedAt: now - 1000 };
    const running = { ...completed, opId: '00000000-0000-4000-8000-000000000552', state: 'streaming', result: undefined, endedAt: undefined, text: 'partial preview' };
    await first.set(OPS_STORE_KEY, { v: 1, ops: [{ view: completed, meta }, { view: running, meta }] });
    const second = opsStoreOver(createResultsStore<AnyOpView>({ session, readView }), session);
    const raw = await second.get(OPS_STORE_KEY) as { ops: { view: AnyOpView }[] };
    expect(raw.ops).toHaveLength(2);
    expect(raw.ops.find(({ view }) => view.opId === completed.opId)?.view).toMatchObject({ state: 'done', result: completed.result, generationRef: completed.generationRef });
    const interrupted = raw.ops.find(({ view }) => view.opId === running.opId)?.view;
    expect(interrupted).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(interrupted?.text).toBeUndefined();
  });
});
