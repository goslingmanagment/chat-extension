// The voice script (every site's since 1.46.0) and Fansly's «Заполнить из
// чата» through the one scheduler → the real fake hub, whose body validator
// is the vendored SDK and whose gates repeat HF-4а/б.
import { describe, expect, it } from 'vitest';
import { createClient, routeSchemas } from '@kernel/sdk';
import { BootstrapSchema, HubFrameSchema, type HubStreamRequest, type Target, type AnyStartOp, type LiveTextTail, type SiteOpView, type VoiceScriptStart, type NotesFillStart } from '@cg/contracts';
import { VoiceOpViewSchema, VoiceScriptStartSchema } from '@cg/contracts/voice';
import { mergeNoteFill, noteFillRequest } from '@cg/core/application/hosts/fansly/notes';
import { LocalSpendJournal } from '@cg/core/domain/debug';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { stableDigest } from '../../../src/domain/ops/digest';
import { ActionTokens, OpScheduler, OPS_STORE_KEY, type OpSchedulerDeps } from '@cg/core/services';
import { createFanslyOperations } from '@cg/core/services/hosts/fansly/operations';
import { VOICE_SCRIPT_DRIVER, readVoiceOpView } from '@cg/core/services/voice';
import { createFakeHub, fanslyPageFlags, hubCall, readSse } from '@cg/testing/fake-hub';
import { WORLD as HUB, resolveHubErrorReference, meta, NOW_MS } from '@cg/testing/hub';
import { EventLog, FakeClock, MemoryStore, LogRecorder, sequentialIds, settle } from '../../support/clock';
import { hubError } from '../../support/fake-hub';
import { featuresOfBoth } from '../../support/features';
import { fanslyBinding, persona, session, uuid } from '../../support/world';

const TAB = uuid(0xa1);
const A = HUB.fansly.chats.a;
type Pair = { readonly group: string; readonly fan: string };
const target = (pair: Pair = A): Target => ({ binding: fanslyBinding, chat: { host: 'fansly-web', hostAccountId: fanslyBinding.hostAccountId, platformFanId: pair.fan }, fanRef: pair.fan, conversationRef: pair.group });
const voice = (pair: Pair = A, text = 'A synthetic draft.', tone: VoiceScriptStart['tone'] = null): VoiceScriptStart => ({ feature: 'voice-script', target: target(pair), cause: { kind: 'click', actionToken: 'tok_00000000000000000000' }, window: 100, tone, draft: { text, revision: 1, digest: stableDigest(text) } });
const notes = (pair: Pair = A, fields = ['Name', 'City'], values?: string[]): NotesFillStart => ({ feature: 'notes-fill', target: target(pair), cause: voice().cause, window: 3000, fields, ...(values === undefined ? {} : { values }) });
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
  const own = createFanslyOperations((view) => done.push(view));
  // The background's core adds the voice script to every site's operations (composition/background/voice.ts).
  const operations = {
    ...own,
    drivers: { ...own.drivers, 'voice-script': VOICE_SCRIPT_DRIVER },
    readView: (value: unknown) => readVoiceOpView(value) ?? own.readView(value),
  };
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

describe('[host:fansly] fresh text through the site operation scheduler', () => {
  const fresh: LiveTextTail = {
    capturedAt: new Date(NOW_MS).toISOString(),
    messages: [{ platformMessageId: '880000000000000100', direction: 'fan', sentAt: new Date(NOW_MS - 1000).toISOString(), text: 'context-only-zebra-quartz-7731' }],
  };

  it.each([voice(), notes()])('$feature: the request carries page text, cache identity includes its contents, storage and events do not', async (input) => {
    const h = await harness();
    const first = admitted(await h.start({ ...input, fresh }));
    // Admission is durable before the hub request, but the transcript is not journaled.
    expect(JSON.stringify([...h.store.data.entries()])).not.toContain(fresh.messages[0]!.text);
    await h.finish();
    expect(h.scheduler.siteView(first, 'fansly-web')?.state).toBe('done');
    expect(h.requests[0]?.body.liveTextContext).toEqual({
      capturedAt: fresh.capturedAt,
      items: [{ platformMessageId: '880000000000000100', direction: 'fan', occurredAt: fresh.messages[0]!.sentAt, text: fresh.messages[0]!.text }],
    });
    expect(h.requests[0]?.capabilities).toContain('context-v1');

    // Another observation of the same text reopens; an edit with the same message id must regenerate.
    const later = { ...fresh, capturedAt: new Date(NOW_MS + 1000).toISOString() };
    expect(await h.start({ ...input, fresh: later })).toMatchObject({ kind: 'admission', admission: { ok: true, opId: first }, reopened: true });
    const changed = { ...fresh, messages: fresh.messages.map((message) => ({ ...message, text: `${message.text}-edited` })) };
    const second = admitted(await h.start({ ...input, fresh: changed }));
    expect(second).not.toBe(first);
    await h.finish();
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]?.body.liveTextContext?.items[0]?.text).toBe(changed.messages[0]!.text);
    for (const output of [h.store.data.get(OPS_STORE_KEY), h.log.entries, h.events.events, h.done, h.spend.snapshot()]) {
      expect(JSON.stringify(output)).not.toContain(fresh.messages[0]!.text);
    }
  });
});

describe('[host:fansly] the voice script through the shared admission', () => {
  it('[AI-111] script from the draft in each preset’s tone, group ≠ fan, the quick window, no clientContext or page text; only a completed result has a script and its source', async () => {
    const h = await harness();
    for (const tone of [null, 'casual', 'flirty'] as const) {
      const opId = admitted(await h.start(voice(A, `draft ${tone}`, tone)));
      expect(h.scheduler.siteView(opId, 'fansly-web')?.result).toBeUndefined();
      await h.finish();
      const view = h.scheduler.siteView(opId, 'fansly-web');
      expect(VoiceOpViewSchema.safeParse(view).success).toBe(true);
      expect(readVoiceOpView(view)).toMatchObject({ state: 'done', result: { kind: 'voice-script', script: '[warmly] Hey you, it is lovely to hear from you.' }, generationRef: expect.any(String) as unknown });
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
});

describe('[host:fansly] P11c «✨ Заполнить из чата» through the shared admission', () => {
  it('[FX-015] [FX-024] [FS-NOTE-6] the labels with the values of their lines — the hub’s merge mode (X43, the owner’s ruling); nothing else of the note; group ≠ fan; the depth by HF-6 — never under 3000, the owner’s deeper setting above it; the answer joins the questionnaire: `=` for what the chat adds nothing to, a rewrite of a filled field, the fan’s words', async () => {
    const h = await harness();
    const text = 'Имя: Wayne\nРабота: медбрат\nпишет после работы в 23:00\nПитомцы: кот\nВозраст: \nХобби: Synthetic fact from the chat.';
    const asked = noteFillRequest(text);
    if (asked === null) throw new Error('not a questionnaire');
    const op = admitted(await h.start({ ...notes(A, asked.fields, asked.values), window: 5000, force: true }));
    await h.finish();
    const request = h.requests.at(-1);
    expect(request?.feature).toBe('fan-notes-fill');
    expect(request?.body).toMatchObject({ conversationRef: A.group, fanRef: A.fan, noteFields: asked.fields, messageCount: 3000 });
    expect(request?.body).toMatchObject({ noteFields: ['Имя', 'Работа', 'Питомцы', 'Возраст', 'Хобби', 'Локация', 'График', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', 'Другое'] });
    expect(request?.body).toMatchObject({ noteValues: ['Wayne', 'медбрат', 'кот', '', 'Synthetic fact from the chat.', '', '', '', '', '', '', ''] });
    for (const key of ['clientContext', 'liveTextContext', 'draftText']) expect(request?.body).not.toHaveProperty(key);
    // The line written under a field is not its value: it never travels.
    expect(JSON.stringify(request)).not.toMatch(/пишет|23:00/);
    const view = h.scheduler.siteView(op, 'fansly-web');
    if (view?.result?.kind !== 'note-fields') throw new Error(`no fields: ${JSON.stringify(view)}`);
    expect(view.result.fields.find((field) => field.label === 'Возраст')?.quotes).toEqual(['my Возраст, in synthetic words']);
    // The fake hub's `=`: nothing for a field that already holds what the chat says.
    expect(view.result.fields.find((field) => field.label === 'Хобби')).toEqual({ label: 'Хобби', value: '' });
    // The hub's own «+ Питомцы» repeats a label the note has (and so was asked): no field of its own.
    expect(view.result.proposed).toBeUndefined();
    const merged = mergeNoteFill(text, view.result.fields, view.result.proposed);
    expect(merged.wrote).toContain('Возраст');
    expect(merged.sources).toContainEqual({ label: 'Возраст', quotes: ['my Возраст, in synthetic words'] });
    expect(merged.suggestions.map((suggestion) => [suggestion.label, suggestion.current, suggestion.proposed])).toEqual([
      ['Имя', 'Wayne', 'Wayne; Synthetic fact from the chat.'],
      ['Работа', 'медбрат', 'медбрат; Synthetic fact from the chat.'],
      ['Питомцы', 'кот', 'кот; Synthetic fact from the chat.'],
    ]);
    h.fake.control({ op: 'config', patch: { limits: { deepMax: 5000 } } });
    await h.refresh();
    admitted(await h.start({ ...notes(A, asked.fields, asked.values), window: 5000, force: true }));
    await h.finish();
    expect(h.requests.at(-1)?.body).toMatchObject({ messageCount: 5000 });
  });

  it('[FX-024] [FS-NOTE-5] the questionnaire’s values reach the hub’s request body and nothing else: no log, no tab event, no stored journal, no spend journal, no hook that feeds diagnostics or client_health', async () => {
    const SECRET = 'zebra-quartz-7731';
    const h = await harness();
    const hooked: unknown[] = [];
    const record = (name: string) => (...args: unknown[]) => { hooked.push([name, ...args]); return null; };
    const original = h.deps.hooks;
    const hooks: NonNullable<OpSchedulerDeps['hooks']> = {
      settled: record('settled'), recapDone: record('recapDone'), debugInput: record('debugInput'), promptToken: record('promptToken'),
      usage(feature, usage) { hooked.push(['usage', feature, usage]); original?.usage?.(feature, usage); },
    };
    Object.assign(h.deps, { hooks });
    // The hub answers `=` for the secret: the answer itself does not carry it back.
    h.fake.control({ op: 'scriptSse', feature: 'fan-notes-fill', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-notes-fill') }, { kind: 'frame', frame: { type: 'content_delta', text: 'Name: =\nCity: Rome\n> «I live in Rome»' } }, { kind: 'frame', frame: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 5, costApproximate: false }, providerResponseId: null, cacheHit: false } }, { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } }, { kind: 'eof' }] }] });
    const op = admitted(await h.start(notes(A, ['Name', 'City'], [SECRET, ''])));
    await h.finish();
    expect(h.scheduler.siteView(op, 'fansly-web')).toMatchObject({ state: 'done', result: { kind: 'note-fields', fields: [{ label: 'Name', value: '' }, { label: 'City', value: 'Rome' }] } });
    // Where it goes: the hub's body, once.
    expect(h.requests.map((request) => request.body.noteValues)).toEqual([[SECRET, '']]);
    // Nowhere else.
    expect(h.log.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.log.entries)).not.toContain(SECRET);
    expect(JSON.stringify(h.events.events)).not.toContain(SECRET);
    expect(JSON.stringify([...h.store.data.entries()])).not.toContain(SECRET);
    expect(JSON.stringify(h.spend.snapshot())).not.toContain(SECRET);
    expect(JSON.stringify(h.spend.report(h.clock.now()))).not.toContain(SECRET);
    expect(JSON.stringify(h.done)).not.toContain(SECRET);
    expect(JSON.stringify(h.scheduler.siteView(op, 'fansly-web'))).not.toContain(SECRET);
    expect(hooked.map((entry) => (entry as unknown[])[0])).toContain('usage');
    expect(JSON.stringify(hooked)).not.toContain(SECRET);
  });
});
