// P12a: the panel's port → the one scheduler → the real fake hub, whose
// body validator is the vendored SDK and whose gates repeat HF-4а/б.
import { describe, expect, it } from 'vitest';
import { createClient, routeSchemas } from '@kernel/sdk';
import { BootstrapSchema, HubFrameSchema, type HubStreamRequest, type Target, type AnyStartOp, type SiteOpView, type VoiceScriptStart, type NotesFillStart } from '@cg/contracts';
import { VoiceScriptStartSchema, FanslyOpViewSchema } from '@cg/contracts/ops-fansly';
import { createVoiceScript, voiceScriptResult } from '@cg/core/application/hosts/fansly/voice';
import { mergeNoteFill, noteFillFields } from '@cg/core/application/hosts/fansly/notes';
import { LocalSpendJournal } from '@cg/core/domain/debug';
import { OP_TIMEOUTS } from '@cg/contracts/limits';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { stableDigest } from '../../../src/domain/ops/digest';
import { ActionTokens, OpScheduler, OPS_STORE_KEY, type OpSchedulerDeps } from '@cg/core/services';
import { createFanslyOperations } from '@cg/core/services/hosts/fansly/voice-operations';
import { createFakeHub, fanslyPageFlags, hubCall, readSse } from '@cg/testing/fake-hub';
import { WORLD as HUB, resolveHubErrorReference, meta, NOW_MS } from '@cg/testing/hub';
import { EventLog, FakeClock, MemoryStore, LogRecorder, sequentialIds, settle } from '../../support/clock';
import { hubError } from '../../support/fake-hub';
import { featuresOfBoth } from '../../support/features';
import { fanslyBinding, persona, session, uuid } from '../../support/world';

const TAB = uuid(0xa1);
const OTHER = uuid(0xa2);
const A = HUB.fansly.chats.a;
const B = HUB.fansly.chats.b;
type Pair = { readonly group: string; readonly fan: string };
const target = (pair: Pair = A): Target => ({ binding: fanslyBinding, chat: { host: 'fansly-web', hostAccountId: fanslyBinding.hostAccountId, platformFanId: pair.fan }, fanRef: pair.fan, conversationRef: pair.group });
const voice = (pair: Pair = A, text = 'A synthetic draft.', tone: VoiceScriptStart['tone'] = null): VoiceScriptStart => ({ feature: 'voice-script', target: target(pair), cause: { kind: 'click', actionToken: 'tok_00000000000000000000' }, window: 100, tone, draft: { text, revision: 1, digest: stableDigest(text) } });
const notes = (pair: Pair = A, fields = ['Name', 'City']): NotesFillStart => ({ feature: 'notes-fill', target: target(pair), cause: voice().cause, window: 3000, fields });
const reply = (pair: Pair = A): AnyStartOp => ({ feature: 'reply', target: target(pair), cause: voice().cause, surface: 'dock', window: 100, tone: null, split: false });
const admitted = (outcome: Awaited<ReturnType<OpScheduler['start']>>): string => {
  if (outcome.kind !== 'admission' || !outcome.admission.ok) throw new Error(JSON.stringify(outcome));
  return outcome.admission.opId;
};

async function harness(over: { store?: MemoryStore; firstId?: number } = {}) {
  const fake = createFakeHub({ routeSchemas, streamBodySchema: routeSchemas.aiFeatureStream.body, timeScale: 0, config: fanslyPageFlags() });
  const token = fake.issueToken();
  const options = { baseUrl: fake.origin, fetch: fake.fetch, headers: { 'x-client-version': 'chat-extension/1.0.0' }, auth: { mode: 'bearer' as const, token: () => token } };
  let bootstrap = BootstrapSchema.parse(await createClient(options).clientBootstrap());
  const clock = new FakeClock(NOW_MS);
  const store = over.store ?? new MemoryStore();
  const ids = sequentialIds(over.firstId ?? 0x100);
  const tokens = new ActionTokens(clock, ids);
  const events = new EventLog();
  const log = new LogRecorder();
  const spend = new LocalSpendJournal();
  const done: SiteOpView[] = [];
  const operations = createFanslyOperations((view) => done.push(view));
  const requests: HubStreamRequest[] = [];
  const pending = new Set<Promise<void>>();
  const deps: OpSchedulerDeps = {
    hooks: { usage: (feature, usage) => spend.recordUsage(feature, usage, clock.now()) },
    clock, ids, tokens, events, store, log, drivers: AI_FEATURE_DRIVERS,
    presence: () => ({ chat: null, visible: true }), resolve: resolveHubErrorReference,
    environment: () => ({ session, bootstrap, persona: () => persona, debug: true, settingsLoaded: true, features: featuresOfBoth }),
    siteOps: (host) => Promise.resolve(host === operations.host ? operations : null),
    hub: { stream(request, sink, signal) {
      requests.push(request);
      const controller = new AbortController();
      signal.addEventListener('abort', () => controller.abort(), { once: true });
      const running = (async () => {
        const response = await hubCall(fake.fetch, fake.origin, 'aiFeatureStream', request, { token, clientVersion: 'chat-extension/1.0.0', signal: controller.signal });
        if (!response.ok) {
          const body = await response.json() as { error: string; reason?: string };
          throw hubError('aiFeatureStream', { kind: 'http', status: response.status, error: body.error, reason: body.reason ?? null, retryAfterMs: null }, session.epoch);
        }
        const read = await readSse(response, (frame) => sink(HubFrameSchema.parse(frame)));
        if (read.end === 'error') throw hubError('aiFeatureStream', { kind: 'transport', failure: controller.signal.aborted ? 'aborted' : 'truncated' }, session.epoch);
      })();
      pending.add(running);
      void running.finally(() => pending.delete(running)).catch(() => undefined);
      return running;
    } },
  };
  const scheduler = new OpScheduler(deps);
  const start = async (input: AnyStartOp, tab = TAB) => scheduler.start(tab, { ...input, cause: { kind: 'click', actionToken: tokens.issue(tab, 'generate', 'dock').actionToken } });
  return {
    fake, scheduler, store, clock, events, requests, done, log, deps, spend,
    start,
    async finish() { await Promise.allSettled([...pending]); await settle(); await scheduler.idle(); },
    async refresh() { bootstrap = BootstrapSchema.parse(await createClient(options).clientBootstrap()); },
    hold(feature: 'voice-script' | 'fast-reply' | 'fan-notes-fill', name = feature) {
      fake.control({ op: 'scriptSse', feature, responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta(feature) }, { kind: 'gate', name }, { kind: 'frame', frame: { type: 'content_delta', text: feature === 'fan-notes-fill' ? 'Name: Ana\nCity: Rome' : 'A complete script.' } }, { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } }, { kind: 'eof' }] }] });
    },
  };
}

describe('[host:fansly] P12a voice-script through the shared admission', () => {
  it('[AI-111] script from the draft in each preset’s tone, group ≠ fan, the quick window, no clientContext or page text; only a completed result reaches the editor port', async () => {
    const h = await harness();
    const port = createVoiceScript({ start: async (input) => {
      const result = await h.start(input);
      if (result.kind !== 'admission') throw new Error(result.code);
      return result.admission;
    }, read: (op) => Promise.resolve(h.scheduler.siteView(op, 'fansly-web')), cancel: (op) => Promise.resolve(h.scheduler.cancel(op)) });
    for (const tone of [null, 'casual', 'flirty'] as const) {
      const outcome = await port.start(voice(A, `draft ${tone}`, tone));
      if (!outcome.ok) throw new Error(outcome.code);
      expect(voiceScriptResult(await port.read(outcome.opId))).toBeNull();
      await h.finish();
      const view = await port.read(outcome.opId);
      expect(FanslyOpViewSchema.safeParse(view).success).toBe(true);
      expect(voiceScriptResult(view)).toEqual({ script: '[warmly] Hey you, it is lovely to hear from you.', generationRef: expect.any(String) as unknown });
      const request = h.requests.at(-1);
      expect(request?.body).toMatchObject({ conversationRef: A.group, fanRef: A.fan, draftText: `draft ${tone}`, replyTone: tone ?? 'none', messageCount: 100 });
      for (const key of ['clientContext', 'liveTextContext', 'coverageCheck', 'noteFields', 'noteValues']) expect(request?.body).not.toHaveProperty(key);
    }
    expect(h.requests).toHaveLength(3);
    expect(h.events.of('op.done')).toHaveLength(0);
    expect(h.done).toHaveLength(3);
    expect(h.spend.report(h.clock.now()).byFeature).toMatchObject([{ feature: 'voice-script', runs: 3 }]);
    const restoredSpend = new LocalSpendJournal(); restoredSpend.restore(h.spend.snapshot());
    expect(restoredSpend.report(h.clock.now())).toEqual(h.spend.report(h.clock.now()));
    expect(h.log.entries.filter((entry) => entry.scope === 'bg.ops.usage')).toHaveLength(3);
    expect(() => VoiceScriptStartSchema.parse(voice(A, '  '))).toThrow();
  });

  it('the fake hub rejects a contradicted group/fan pair before quota; the page’s voice flag and lane_off refuse before any stream', async () => {
    const h = await harness();
    const quota = h.fake.config().quotaRequestsToday;
    const bad = voice();
    const op = admitted(await h.start({ ...bad, target: { ...bad.target, fanRef: B.fan, chat: { ...bad.target.chat, platformFanId: B.fan } } }));
    await h.finish();
    expect(h.scheduler.siteView(op, 'fansly-web')).toMatchObject({ state: 'failed', error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(h.fake.config().quotaRequestsToday).toBe(quota);
    for (const patch of [fanslyPageFlags({ voice: false }), { ...fanslyPageFlags(), voiceLaneOff: [HUB.pages.fansly.pageLabel] }]) {
      h.fake.control({ op: 'config', patch });
      await h.refresh();
      expect(await h.start(voice())).toMatchObject({ kind: 'refused', code: 'CG-FEATURE-DISABLED' });
    }
    expect(h.requests).toHaveLength(1);
  });

  it.each(['reply', 'voice-script', 'notes-fill'] as const)('one chat: %s holds the same slot against the other two, across tabs; explicit cancel frees it', async (first) => {
    const h = await harness();
    h.hold('fast-reply'); h.hold('voice-script'); h.hold('fan-notes-fill');
    const starts = [reply(), voice(), notes()];
    const selected = starts.find((start) => start.feature === first)!;
    const op = admitted(await h.start(selected));
    for (const other of starts.filter((start) => start.feature !== first)) {
      const refused = await h.start(other, OTHER);
      expect(refused).toMatchObject({ kind: 'admission', admission: { ok: false, code: 'CG-OP-CHAT-BUSY', ...(first === 'reply' ? { active: [{ opId: op, feature: first }] } : { active: [], siteActive: [{ opId: op, feature: first }] }) } });
    }
    expect(h.scheduler.cancel(op)).toBe('canceled');
    admitted(await h.start(starts.find((start) => start.feature !== first)!));
    for (const gate of ['fast-reply', 'voice-script', 'fan-notes-fill']) h.fake.control({ op: 'release', gate });
    await h.finish();
    expect(h.requests).toHaveLength(2);
  });

  it('different chats: Reply, script and notes together reach three slots per tab; a fourth is refused; another tab has its own slots', async () => {
    const h = await harness();
    h.hold('fast-reply'); h.hold('voice-script'); h.hold('fan-notes-fill');
    const C = HUB.fansly.old;
    const D = { group: '810000000000000098', fan: '920000000000000098' };
    const starts = [reply(), voice(B), notes(C)];
    const ops = await Promise.all(starts.map((start) => h.start(start).then(admitted)));
    expect(new Set(ops).size).toBe(3);
    expect(await h.start(voice(D))).toMatchObject({ kind: 'admission', admission: { ok: false, code: 'CG-OP-TAB-LIMIT', active: expect.any(Array) as unknown } });
    admitted(await h.start(voice(D), OTHER));
    for (const op of ops) h.scheduler.cancel(op);
    for (const gate of ['fast-reply', 'voice-script', 'fan-notes-fill']) h.fake.control({ op: 'release', gate });
    await h.finish();
    expect(h.requests).toHaveLength(4);
  });

  it('reopens the same script, separates drafts/tones/groups and notes labels, retains a finished result across restart; an admitted stream is interrupted and never POSTed again', async () => {
    const h = await harness();
    const first = admitted(await h.start(voice()));
    await h.finish();
    expect(await h.start(voice())).toMatchObject({ reopened: true, admission: { opId: first } });
    for (const input of [voice(A, 'different'), voice(A, 'A synthetic draft.', 'flirty'), voice(B), notes(), notes(A, ['City'])]) {
      admitted(await h.start(input)); await h.finish();
    }
    expect(h.requests).toHaveLength(6);
    h.hold('voice-script');
    const pending = admitted(await h.start({ ...voice(), force: true }));
    await settle(); await h.scheduler.idle();
    const restarted = new OpScheduler({ ...h.deps, ids: sequentialIds(0x900) });
    expect(await restarted.restore()).toMatchObject({ restored: 7, interrupted: 1, dropped: 0 });
    expect(restarted.siteView(pending, 'fansly-web')).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(voiceScriptResult(restarted.siteView(first, 'fansly-web'))).not.toBeNull();
    expect(h.requests).toHaveLength(7);
    h.scheduler.cancel(pending);
    h.fake.control({ op: 'release', gate: 'voice-script' }); await h.finish();
    const serialized = JSON.stringify(h.store.data.get(OPS_STORE_KEY));
    expect(serialized).not.toContain('A synthetic draft.');
    expect(restarted.forSend(first)).toBeNull();
    expect(restarted.view(first)).toBeNull();
  });

  it('a failed journal write refuses before the hub; a site timeout ends the stream once and never repeats it', async () => {
    const h = await harness();
    h.store.failWrites = true;
    expect(await h.start(voice())).toMatchObject({ kind: 'refused', code: 'CG-STORAGE-WRITE' });
    expect(h.requests).toHaveLength(0);
    h.store.failWrites = false;
    h.hold('voice-script');
    const op = admitted(await h.start(voice()));
    await settle();
    await h.clock.advance(OP_TIMEOUTS.reply.firstChunkAfterMetaMs + 1);
    expect(h.scheduler.siteView(op, 'fansly-web')).toMatchObject({ state: 'failed', error: { code: 'CG-HUB-TIMEOUT' } });
    expect(voiceScriptResult(h.scheduler.siteView(op, 'fansly-web'))).toBeNull();
    await h.finish();
    expect(h.requests).toHaveLength(1);
  });

  it.each(['max_tokens', 'length', 'eof', 'empty'] as const)('a %s stream is never a usable script or a paid source', async (ending) => {
    const h = await harness();
    h.fake.control({ op: 'scriptSse', feature: 'voice-script', responses: [{ kind: 'stream', steps: [
      { kind: 'frame', frame: meta('voice-script') },
      { kind: 'frame', frame: { type: 'content_delta', text: ending === 'empty' ? ' ' : 'An unfinished script' } },
      ...(ending === 'eof' ? [] : [{ kind: 'frame' as const, frame: { type: 'done' as const, stopReason: ending === 'empty' ? 'end_turn' : ending } }]),
      { kind: 'eof' },
    ] }] });
    const op = admitted(await h.start(voice())); await h.finish();
    expect(h.scheduler.siteView(op, 'fansly-web')?.state).toBe('failed');
    expect(voiceScriptResult(h.scheduler.siteView(op, 'fansly-web'))).toBeNull();
    expect(h.requests).toHaveLength(1);
  });
});

describe('[host:fansly] P11c «✨ Заполнить из чата» through the shared admission', () => {
  it('[FX-015] [FS-NOTE-6] the labels only, never a value of the note; group ≠ fan; the depth by HF-6 — never under 3000, the owner’s deeper setting above it; the answer joins the questionnaire', async () => {
    const h = await harness();
    const text = 'Имя: Wayne\nРабота: медбрат\nВозраст: ';
    const fields = noteFillFields(text) ?? [];
    const op = admitted(await h.start({ ...notes(A, fields), window: 5000, force: true }));
    await h.finish();
    const request = h.requests.at(-1);
    expect(request?.feature).toBe('fan-notes-fill');
    expect(request?.body).toMatchObject({ conversationRef: A.group, fanRef: A.fan, noteFields: fields, messageCount: 3000 });
    for (const key of ['noteValues', 'clientContext', 'liveTextContext', 'draftText']) expect(request?.body).not.toHaveProperty(key);
    expect(JSON.stringify(request)).not.toMatch(/Wayne|медбрат/);
    const view = h.scheduler.siteView(op, 'fansly-web');
    if (view?.result?.kind !== 'note-fields') throw new Error(`no fields: ${JSON.stringify(view)}`);
    expect(mergeNoteFill(text, view.result.fields).wrote).toContain('Возраст');
    h.fake.control({ op: 'config', patch: { limits: { deepMax: 5000 } } });
    await h.refresh();
    admitted(await h.start({ ...notes(A, fields), window: 5000, force: true }));
    await h.finish();
    expect(h.requests.at(-1)?.body).toMatchObject({ messageCount: 5000 });
  });
});
