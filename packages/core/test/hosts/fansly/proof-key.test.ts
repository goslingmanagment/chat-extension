import { describe, expect, it } from 'vitest';

import { chatKeyOf, type CoverageProof, type FreshnessRequest, type HostEvent, type HostPort, type OpView } from '@cg/contracts';
import { tabProof } from '@cg/contracts/fixtures';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import { createFanslyAi, fingerprintOf, freshForSend, verdictMark } from '@cg/core/application/hosts/fansly/ai';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { coverageFingerprintOf } from '@cg/core/domain/ops';
import { ActionTokens, OPS_STORE_KEY, OpScheduler } from '@cg/core/services';
import { BOOTSTRAP_PILOT_PAGES, contextFrame, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { AddressedHub, TAB } from '../../support/ai-background';
import { EventLog, FakeClock, MemoryStore, sequentialIds, settle } from '../../support/clock';
import { featuresOfBoth } from '../../support/features';
import { FANSLY, NOW_MS, fanslyChat, fanslyTarget, persona, session, startOf, withFanslyPage } from '../../support/world';

const proof: CoverageProof = { ...tabProof, conversationRef: FANSLY.group };
const fingerprint = coverageFingerprintOf(proof);
const served = {
  source: 'live_union', servedHead: null, live: { status: 'served', accepted: 2, rejected: 0 },
  coverageCheck: { window: proof.window.map(({ id }) => ({ id, state: 'included' as const })), deleted: proof.deletedIds.map((id) => ({ id, state: 'deleted' as const })) },
} as const;

function scheduler(store = new MemoryStore(), clock = new FakeClock(NOW_MS), firstId = 0x100) {
  const ids = sequentialIds(firstId);
  const tokens = new ActionTokens(clock, ids);
  const hub = new AddressedHub(clock);
  const ops = new OpScheduler({ clock, ids, tokens, hub, store, events: new EventLog(), presence: () => null,
    environment: () => ({ session, bootstrap: withFanslyPage(BOOTSTRAP_PILOT_PAGES), persona: () => persona, debug: false, settingsLoaded: true, features: featuresOfBoth }),
    resolve: resolveHubErrorReference, drivers: AI_FEATURE_DRIVERS });
  return { ops, hub, store, clock, async start(p: CoverageProof = proof) {
    const { actionToken } = tokens.issue(TAB, 'generate', 'dock');
    return ops.start(TAB, startOf({ target: fanslyTarget, proof: p, cause: { kind: 'click', actionToken } }));
  }, script() {
    hub.streamScript.push({ kind: 'stream', steps: [
      { kind: 'frame', frame: meta('fast-reply') },
      { kind: 'frame', frame: contextFrame({ coverageCheck: served.coverageCheck, knownFanMessages: proof.knownFanMessageIds.map((id) => ({ id, state: 'included' })), live: { status: 'served', accepted: 2, rejected: 0 } }) },
      { kind: 'frame', frame: { type: 'content_delta', text: 'Hey you' }, afterMs: 20 },
      { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } },
    ] });
  } };
}

/** The result's current observation, a page-memory port; a signal can invalidate an in-flight snapshot. */
function currentWindow() {
  const listeners = new Set<(event: HostEvent) => void>();
  const asked: FreshnessRequest[] = [];
  let group = FANSLY.group as string;
  let answer: () => Promise<FanslySnapshot | null> = () => Promise.resolve(snapshot);
  const snapshot: FanslySnapshot = {
    feature: 'reply', identity: { creatorId: FANSLY.creator, fanId: FANSLY.fan, groupId: FANSLY.group },
    epochs: { document: 'reloaded', socket: 2, route: 4 }, completeness: 'complete',
    window: [...proof.window], knownFanMessageIds: [...proof.knownFanMessageIds].reverse(), deletedIds: [...proof.deletedIds], truncated: false,
  };
  const host = { current: () => ({ route: { epoch: 4, chat: fanslyChat, conversationRef: group } }),
    subscribe: (listener: (event: HostEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    freshness: { snapshot: (_chat: unknown, request: FreshnessRequest) => { asked.push(request); return answer(); } },
  } as unknown as HostPort;
  return { host, asked, snapshot, reply: (fn: typeof answer) => { answer = fn; },
    signal: () => { for (const listener of listeners) listener({ type: 'chatCache', chat: fanslyChat }); },
    move: () => { group = '999'; for (const listener of listeners) listener({ type: 'route', route: host.current().route }); },
  };
}

function view(): OpView {
  return { opId: '00000000-0000-4000-8000-000000000888', feature: 'reply', surface: 'dock', target: fanslyTarget,
    state: 'done', phase: { name: 'settled', since: NOW_MS }, startedAt: NOW_MS, endedAt: NOW_MS, toneUsed: null,
    freshnessProof: { windowSize: 60, fingerprint }, servedContext: structuredClone(served) };
}

describe('[host:fansly] [AI-128] P8b3: proof keys and reopened verdicts', () => {
  it('different windows never dedupe, including after the scheduler restores its store; the same proof at another time reopens, with no page text kept', async () => {
    const h = scheduler();
    h.script();
    const first = await h.start();
    expect(first).toMatchObject({ kind: 'admission', reopened: false });
    expect(await h.start({ ...proof, takenAt: '2026-10-15T12:00:00Z' })).toMatchObject({ kind: 'admission', reopened: true });
    const changed: CoverageProof = { ...proof, window: [...proof.window, { id: '999', dir: 'model' }] };
    expect(await h.start(changed)).toMatchObject({ kind: 'admission', admission: { ok: false, code: 'CG-OP-CHAT-BUSY' } });
    await h.clock.advance(1000);
    const original = h.ops.list(TAB, 'tab', chatKeyOf(fanslyChat)).ops[0];
    expect(original?.freshnessProof).toEqual({ windowSize: 60, fingerprint });
    expect(original?.state).toBe('done');
    const raw = JSON.stringify(h.store.data.get(OPS_STORE_KEY));
    if (proof.kind === 'tab-snapshot') for (const message of proof.tail ?? []) expect(raw).not.toContain(message.text);
    const restored = scheduler(h.store, h.clock, 0x300);
    expect(await restored.ops.restore()).toMatchObject({ restored: 1, interrupted: 0, dropped: 0 });
    expect(restored.ops.view(original?.opId ?? '')?.freshnessProof).toEqual(original?.freshnessProof);
    expect(await restored.start()).toEqual({ kind: 'admission', admission: { ok: true, opId: original?.opId }, reopened: true });
    expect(restored.hub.streams).toHaveLength(0);
    const reopened = restored.ops.view(original?.opId ?? '');
    if (reopened === null) throw new Error('the restored result is missing');
    const page = currentWindow();
    const policy = createFanslyAi({ now: () => NOW_MS });
    const stop = policy.watch?.(page.host, () => undefined);
    expect(policy.verdict(reopened, null)?.reason).toBe('unverified');
    await settle();
    expect(policy.verdict(reopened, null)).toBeNull();
    stop?.();
    restored.script();
    expect(await restored.start(changed)).toMatchObject({ kind: 'admission', reopened: false });
    await h.clock.advance(1000);
    expect(restored.hub.streams).toHaveLength(1);
  });

  it('a result adopted after reload checks its own answer against the current window; a newer start cannot lend it a verdict', async () => {
    const page = currentWindow();
    const policy = createFanslyAi({ now: () => NOW_MS });
    let changed = 0;
    const stop = policy.watch?.(page.host, () => changed++);
    const result = view();
    expect(policy.verdict(result, null)?.reason).toBe('unverified');
    await settle();
    expect(changed).toBe(1);
    expect(policy.verdict(result, null)).toBeNull();
    expect(page.asked).toEqual([{ conversationRef: FANSLY.group, feature: 'reply', window: 60, withText: false }]);
    page.snapshot.window.push({ id: '999', dir: 'fan' });
    page.signal();
    expect(policy.verdict(result, fingerprint)?.reason).toBe('unverified');
    await settle();
    expect(policy.verdict(result, fingerprint)?.reason).toBe('unverified');
    // Even if another result answered that newer id, the old result's answers still do not.
    const newer = { ...view(), opId: '00000000-0000-4000-8000-000000000889', servedContext: { ...served, coverageCheck: { ...served.coverageCheck, window: [...served.coverageCheck.window, { id: '999', state: 'included' as const }] } }, freshnessProof: { windowSize: 60, fingerprint: { ...fingerprint, window: [...page.snapshot.window] } } };
    policy.verdict(newer, null);
    await settle();
    expect(policy.verdict(newer, null)).toBeNull();
    expect(policy.verdict(result, null)?.reason).toBe('unverified');
    expect(freshForSend(result, fingerprintOf({ ...proof, window: [...page.snapshot.window] }))).toBe(false);
    stop?.();
  });

  it('a stored miss, unknown proof or rejected text never becomes fresh from a newer complete snapshot; legacy results are unverified', () => {
    const result = view();
    expect(verdictMark({ ...result, servedContext: { ...served, live: { status: 'rejected', accepted: 0, rejected: 2 } } }, { ...fingerprint, text: false })?.reason).toBe('window-miss');
    expect(verdictMark({ ...result, freshnessProof: { windowSize: 60, fingerprint: { ...fingerprint, completeness: 'unknown' } } }, fingerprint)?.reason).toBe('unverified');
    const { freshnessProof: _proof, ...legacy } = result;
    expect(verdictMark(legacy, null)?.reason).toBe('unverified');
  });

  it('null, rejected and late snapshots cannot verify a result; invalidation and disposal discard in-flight checks', async () => {
    for (const failure of ['null', 'reject', 'late'] as const) {
      const page = currentWindow();
      let resolve: (snapshot: FanslySnapshot) => void = () => undefined;
      page.reply(() => failure === 'null' ? Promise.resolve(null) : failure === 'reject' ? Promise.reject(new Error('bridge')) : new Promise((done) => { resolve = done; }));
      const policy = createFanslyAi({ now: () => NOW_MS });
      let changes = 0;
      const stop = policy.watch?.(page.host, () => changes++);
      expect(policy.verdict(view(), null)?.reason).toBe('unverified');
      await settle();
      if (failure === 'late') { page.move(); resolve(page.snapshot); await settle(); expect(changes).toBe(1); }
      expect(policy.verdict(view(), null)?.reason).toBe('unverified');
      stop?.();
    }
  });
});
