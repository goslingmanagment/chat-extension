// R20 P6c2 / HF-5, FS-AI-2: the DEPLOYED hub bd3eec065, not its later main.
// Every case of the byte-pinned hub matrix (P4b4) goes through the SDK to the fake's HTTP handler.
import { readFileSync } from 'node:fs';

import { type AiStreamCapability } from '@cg/contracts';
import { type StartProofV1 } from '@cg/contracts/fansly';
import { KernelApiError, routeSchemas, streamAiFeature } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { WORLD, streamBody, uuid } from '../scenarios/hub';
import { type HiGreetingRefusalReason } from './ai-rules';
import { PILOT_CAPABILITIES, fanslyPageFlags } from './config';
import { type ConversationSeed } from './data';
import { createFakeHub, type FakeHub } from './hub';

interface ProofCase { readonly name: string; readonly proof: StartProofV1 }
interface ShapeCase {
  readonly name: string;
  readonly feature: string;
  readonly platform: 'fansly' | 'onlyfans';
  readonly clientContext: boolean;
  readonly capabilities: AiStreamCapability[];
  readonly conversationRef: string;
  readonly fields: { readonly startProof?: StartProofV1; readonly personalMessageCount?: number; readonly fanAvatarUrl?: string };
  readonly refusal: string | null;
}
interface GateCase {
  readonly name: string;
  readonly proof: StartProofV1 | null;
  readonly window: string[];
  readonly knownLiveIds: string[];
  readonly verdict: HiGreetingRefusalReason | null;
}
const MATRIX = JSON.parse(readFileSync(new URL('../../../contracts/test/fixtures/ai-hi-start-proof-matrix.json', import.meta.url), 'utf8')) as {
  readonly proofs: { readonly valid: ProofCase[]; readonly invalid: { readonly name: string; readonly proof: unknown }[] };
  readonly shapeCases: ShapeCase[];
  readonly gateCases: GateCase[];
};
const PROOF = MATRIX.proofs.valid[0]!.proof;
const PAGE = WORLD.pages.fansly.pageLabel;
const GROUP = PROOF.groupId;
const CAPS: AiStreamCapability[] = ['context-v1', 'coverage-check-v1', 'hi-start-proof-v1'];
const AVATAR = 'https://cdn3.fansly.com/avatar.jpg';
type Frame = Record<string, unknown> & { type: string };
type Verdict = { status: number; error: string; reason?: string } | null;
let hub: FakeHub;
let token: string;
let seq = 0;

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...streamBody({ clientRequestId: uuid(0xc2000 + ++seq), pageLabel: PAGE, platform: 'fansly', conversationRef: GROUP, fanRef: WORLD.fansly.chats.a.fan }),
  ...over,
});
const seed = (messages: readonly ConversationSeed[] = [], conversationRef: string = GROUP, pageLabel: string = PAGE, lookupFails = false): void => {
  expect(hub.control({ op: 'archiveConversation', pageLabel, conversationRef, messages, lookupFails })).toEqual({ ok: true, messages: messages.length });
};
const messages = (ids: readonly string[], state?: 'held' | 'deleted'): ConversationSeed[] => ids.map((id) => ({ id, sender: 'model', ...(state === undefined ? {} : { state }) }));

/** No real transport: even the avatar stays an image URL, never a fetch. Invalid bodies deliberately reach the server. */
async function ask(requestBody: Record<string, unknown> = body(), capabilities: readonly AiStreamCapability[] = CAPS, feature = 'hi-greeting'): Promise<{ verdict: Verdict; frames: Frame[] }> {
  const frames: Frame[] = [];
  const left = hub.config().quotaRequestsToday;
  try {
    const handle = streamAiFeature({
      baseUrl: hub.origin,
      auth: { mode: 'bearer', token: () => token },
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        expect(url).toBe(`${hub.origin}/api/v1/ai/features/${feature}`);
        return hub.fetch(input, init);
      },
    }, {
      feature,
      body: requestBody as never,
      capabilities,
      onFrame: (frame) => frames.push(frame),
    });
    await handle.done;
    expect(frames.at(-1)?.type).toBe('done');
    expect(hub.config().quotaRequestsToday).toBe(left === null ? null : left - 1);
    return { verdict: null, frames };
  } catch (error) {
    if (!(error instanceof KernelApiError)) throw error;
    expect(frames).toEqual([]);
    expect(hub.config().quotaRequestsToday).toBe(left);
    const envelope = error.body as { error: string; reason?: string };
    return { verdict: { status: error.status!, error: envelope.error, ...(envelope.reason === undefined ? {} : { reason: envelope.reason }) }, frames };
  }
}
const gate = (reason: HiGreetingRefusalReason): Verdict => ({ status: 400, error: 'gate_hi_greeting_limit', reason });

beforeEach(() => {
  hub = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas });
  token = hub.issueToken();
  hub.control({ op: 'config', patch: { ...fanslyPageFlags({ drafts: true }), aiChunkDelayMs: 0 } });
  seed();
});

describe('[host:fansly] HF-5: every case of the shared Hi start-proof matrix through the SDK', () => {
  it.each(MATRIX.proofs.valid)('valid proof: $name', async ({ proof }) => {
    expect((await ask(body({ conversationRef: proof.groupId, startProof: proof }))).verdict).toBeNull();
    expect(hub.violations()).toEqual([]);
  });

  it.each(MATRIX.proofs.invalid)('invalid proof: $name', async ({ proof }) => {
    expect((await ask(body({ startProof: proof }))).verdict).toEqual({ status: 400, error: 'bad_request' });
  });

  it.each(MATRIX.shapeCases)('shape: $name', async (c) => {
    // clientContext is intentionally outside our client contracts: the SDK schema accepts the legacy shape,
    // then the hub's handler must refuse the new fields with its specific reason BEFORE our stricter mirror.
    const clientContext = { transcript: 'No messages.', messageCount: 0, fanDisplayName: 'Synthetic fan', fanSpendingData: '', fanSubscriptionData: '' };
    const sent = body({
      pageLabel: c.platform === 'fansly' ? PAGE : WORLD.pages.one.pageLabel,
      platform: c.platform,
      conversationRef: c.conversationRef,
      ...(c.clientContext ? { clientContext } : {}),
      ...c.fields,
    });
    expect(routeSchemas.aiFeatureStream.body.safeParse(sent).success).toBe(true);
    // A shape admitted by HF-5 still has to pass the gate: neither a count nor an avatar alone proves a start.
    const expected = c.refusal !== null ? { status: 400, error: 'bad_request', reason: c.refusal }
      : c.feature === 'hi-greeting' && c.fields.startProof === undefined ? gate('history_unproven') : null;
    expect((await ask(sent, c.capabilities, c.feature)).verdict).toEqual(expected);
  });

  it.each(MATRIX.gateCases)('gate: $name', async (c) => {
    seed(messages(c.knownLiveIds));
    expect((await ask(body({
      ...(c.proof === null ? {} : { startProof: c.proof }),
      coverageCheck: { window: c.window.map((id) => ({ id, dir: 'model' })), deletedIds: [] },
    }))).verdict).toEqual(c.verdict === null ? null : gate(c.verdict));
  });
});

describe('[host:fansly] HF-5: the archive, capabilities and avatar around the shared matrix', () => {
  it('older live refs outside the served window contradict a proof; deleted, other-page and other-chat refs do not', async () => {
    const older = String(BigInt(PROOF.startWitnessId!) - 1n);
    seed(messages([older]), '700000000000000004');
    seed(messages([older]), GROUP, WORLD.pages.one.pageLabel);
    seed([...messages([older], 'deleted'), ...messages([PROOF.startWitnessId!])]);
    expect((await ask(body({ startProof: PROOF }))).verdict).toBeNull();
    seed([...messages([older], 'held'), ...messages([PROOF.startWitnessId!])]);
    expect((await ask(body({ startProof: PROOF }))).verdict).toEqual(gate('history_unproven'));
    seed(messages([older, ...Array.from({ length: 25 }, (_, n) => String(BigInt(PROOF.startWitnessId!) + BigInt(n)))]));
    expect((await ask(body({ startProof: PROOF, messageCount: 25 }))).verdict).toEqual(gate('history_unproven'));
  });

  it('an archive read failure fails closed; no proof is refused before that read; neither spends quota', async () => {
    seed([], GROUP, PAGE, true);
    expect((await ask(body())).verdict).toEqual(gate('history_unproven'));
    expect((await ask(body({ startProof: PROOF }))).verdict).toEqual({ status: 500, error: 'internal_error' });
  });

  it('P6c4 caps the Hi context but P6c2 still judges live refs outside that cap', async () => {
    hub.control({ op: 'config', patch: { limits: { deepMax: 5000 } } });
    const ids = Array.from({ length: 1501 }, (_, n) => String(BigInt(PROOF.startWitnessId!) + BigInt(n)));
    const sent = {
      startProof: { ...PROOF, coveredCount: ids.length, personalCount: 1, automatedIds: [] },
      messageCount: 3000,
      coverageCheck: { window: [{ id: ids[0]!, dir: 'model' }], deletedIds: [] },
    };
    seed(messages(ids));
    const admitted = await ask(body(sent));
    expect(admitted.verdict).toBeNull();
    expect(admitted.frames.find((frame) => frame.type === 'context_v1')).toMatchObject({
      window: { requested: 3000, served: 1500 },
      coverageCheck: { window: [{ id: ids[0], state: 'outside_window' }] },
    });
    seed(messages([String(BigInt(PROOF.startWitnessId!) - 1n), ...ids]));
    expect((await ask(body(sent))).verdict).toEqual(gate('history_unproven'));
  });

  it('two 18-digit refs that round to the same double still contradict a later witness', async () => {
    const older = '700000000000000101';
    const witness = '700000000000000102';
    expect(Number(older)).toBe(Number(witness));
    seed(messages([older]));
    expect((await ask(body({ startProof: { ...PROOF, startWitnessId: witness } }))).verdict).toEqual(gate('history_unproven'));
  });

  it.each(['tab-short-page', 'pass-empty-page'] as const)('%s: exactly 10 personal admitted, 11 refused, whatever the total', async (source) => {
    seed(messages(Array.from({ length: 60 }, (_, n) => String(700000000000000101n + BigInt(n)))));
    for (const personalCount of [10, 11]) {
      expect((await ask(body({ startProof: { ...PROOF, source, coveredCount: 60, personalCount, automatedIds: [] }, personalMessageCount: personalCount }))).verdict)
        .toEqual(personalCount === 10 ? null : gate('too_many_personal'));
    }
  });

  it('a current hub without the request token keeps the old count gate and its reason-less envelope', async () => {
    for (const capabilities of [[], ['context-v1', 'coverage-check-v1']] as AiStreamCapability[][]) {
      seed(messages(Array.from({ length: 10 }, (_, n) => String(700000000000000101n + BigInt(n)))));
      expect((await ask(body(), capabilities)).verdict).toBeNull();
      seed(messages(Array.from({ length: 11 }, (_, n) => String(700000000000000101n + BigInt(n)))));
      expect((await ask(body(), capabilities)).verdict).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
    }
    for (const fields of [{ startProof: PROOF }, { personalMessageCount: 0 }, { fanAvatarUrl: AVATAR }]) {
      expect((await ask(body(fields), [])).verdict).toEqual({ status: 400, error: 'bad_request', reason: 'capability_required' });
    }
  });

  it('a hub before HF-5 advertises no proof capability, refuses every new field and ignores a future header token', async () => {
    hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((cap) => cap !== 'hi-start-proof-v1') } });
    for (const fields of [{ startProof: PROOF }, { personalMessageCount: 0 }, { fanAvatarUrl: AVATAR }]) {
      expect((await ask(body(fields))).verdict).toEqual({ status: 400, error: 'bad_request' });
    }
    expect((await ask(body())).verdict).toBeNull();
    seed(messages(Array.from({ length: 11 }, (_, n) => String(700000000000000101n + BigInt(n)))));
    expect((await ask(body())).verdict).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
  });

  it('OnlyFans Hi keeps the old gate with every header token, and no refusal reason', async () => {
    const sent = body({ platform: 'onlyfans', pageLabel: WORLD.pages.one.pageLabel, conversationRef: WORLD.fan, fanRef: WORLD.fan });
    seed(messages(Array.from({ length: 10 }, (_, n) => String(n + 1))), WORLD.fan, WORLD.pages.one.pageLabel);
    expect((await ask(sent)).verdict).toBeNull();
    seed(messages(Array.from({ length: 11 }, (_, n) => String(n + 1))), WORLD.fan, WORLD.pages.one.pageLabel);
    expect((await ask(body({ ...sent, clientRequestId: uuid(0xcffff) }))).verdict).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
  });

  it('the admitted avatar is an image in debug, never fetched; the proof manifest contains counts only', async () => {
    const { verdict, frames } = await ask(body({ startProof: PROOF, fanAvatarUrl: AVATAR }), [...CAPS, 'debug-input-v1']);
    expect(verdict).toBeNull();
    const debug = frames.find((frame) => frame.type === 'debug_input_v1');
    expect(debug?.['images']).toEqual([{ url: AVATAR }]);
    expect((debug?.['contextManifest'] as Record<string, unknown>)['hiStartProof']).toEqual({
      source: PROOF.source, coveredCount: PROOF.coveredCount, personalCount: PROOF.personalCount, automatedCount: PROOF.automatedIds.length,
    });
    const plain = await ask(body({ startProof: PROOF }), [...CAPS, 'debug-input-v1']);
    expect(plain.frames.find((frame) => frame.type === 'debug_input_v1')).not.toHaveProperty('images');
    const old = await ask(body(), ['context-v1', 'debug-input-v1']);
    expect(old.frames.find((frame) => frame.type === 'debug_input_v1')).toMatchObject({ contextManifest: { window: 100, feature: 'hi-greeting' } });
    expect((old.frames.find((frame) => frame.type === 'debug_input_v1')?.['contextManifest'] as object)).not.toHaveProperty('hiStartProof');
  });

  it.each([
    { name: 'http', fanAvatarUrl: 'http://cdn3.fansly.com/avatar.jpg' },
    { name: 'bare domain', fanAvatarUrl: 'https://fansly.com/avatar.jpg' },
    { name: 'suffix attack', fanAvatarUrl: 'https://cdn3.fansly.com.evil.test/a' },
    { name: 'over 4096 characters', fanAvatarUrl: `https://cdn3.fansly.com/${'a'.repeat(4096)}` },
  ])('refuses an avatar outside the SDK allow-list: $name', async ({ fanAvatarUrl }) => {
    expect((await ask(body({ startProof: PROOF, fanAvatarUrl }))).verdict).toEqual({ status: 400, error: 'bad_request' });
  });
});
