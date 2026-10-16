// P12a: the actual adapter/results store used by the background, not a
// map-only scheduler journal. Site schemas arrive from the owning chunk.
import { describe, expect, it } from 'vitest';
import { OpViewSchema, type AnyOpView } from '@cg/contracts/ops';
import { fanslyVoiceView, opView, tabProof } from '@cg/contracts/fixtures';
import { coverageFingerprintOf } from '@cg/core/domain/ops';
import { SESSION_KEYS } from '@cg/core/domain';
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
  it('[AI-128] P8b3: each result key keeps its own proof through the real adapter and background restore', async () => {
    const session = memoryStore();
    const first = opsStoreOver(createResultsStore<AnyOpView>({ session, readView }), session);
    const fingerprint = coverageFingerprintOf(tabProof);
    const original = { ...opView, target: fanslyVoiceView.target, startedAt: now - 1000, endedAt: now,
      freshnessProof: { windowSize: 60, fingerprint } };
    const newer = { ...original, opId: '00000000-0000-4000-8000-000000000553',
      freshnessProof: { windowSize: 60, fingerprint: { ...fingerprint, window: [...fingerprint.window, { id: '999', dir: 'fan' as const }] } } };
    await first.set(OPS_STORE_KEY, { v: 1, ops: [{ view: original, meta }, { view: newer, meta }] });
    expect(session.data.has(OPS_STORE_KEY)).toBe(false);
    for (const view of [original, newer]) {
      expect(session.data.get(`${SESSION_KEYS.resultPrefix}${view.opId}`)).toMatchObject({ freshnessProof: view.freshnessProof });
    }
    const restored = opsStoreOver(createResultsStore<AnyOpView>({ session, readView }), session);
    const raw = await restored.get(OPS_STORE_KEY) as { ops: { view: AnyOpView }[] };
    expect(raw.ops).toHaveLength(2);
    for (const view of [original, newer]) {
      expect(raw.ops.find((entry) => entry.view.opId === view.opId)?.view).toMatchObject({ freshnessProof: view.freshnessProof });
    }
  });

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
