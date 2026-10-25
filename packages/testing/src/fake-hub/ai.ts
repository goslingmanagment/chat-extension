// The AI stream as the fake hub's model serves it (architecture.md §8.4; hub
// H-4b, H-4c, H-10): the persona catalog, a synthetic generation per request
// (meta → debug_input_v1 → context_v1 → reasoning → content chunks → usage →
// done, each only when its capability or mode asks for it), Split markers
// only where the hub would honour `preferSplit`, and the record of every
// generation (H-5 eligibility, shared recaps, own AI spend). The text is
// synthetic and fixed; it never lands in the journal. On Fansly (R20 P6c1)
// the context frame also names the checked pair (HF-9) and answers the
// body's window check (HF-8в).

import { SPLIT_MARKERS, type ContextFrame, type HubFrame, type HubStreamRequest, type PersonaCatalogItem } from '@cg/contracts';

import { WORLD } from '../scenarios/hub';
import { hiStartProofDecides, type CoverageCheckAnswer } from './ai-rules';
import { type FakeSseStep } from './types';

export interface Generation {
  readonly requestId: string;
  readonly clientRequestId: string;
  readonly feature: string;
  readonly pageLabel: string;
  readonly fanRef: string;
  /** The request's conversation (on Fansly the group; on OnlyFans the fan). */
  readonly conversationRef: string;
  readonly userId: number;
  readonly summaryMode: 'short' | null;
  readonly messageCount: number | null;
  readonly personaDefinitionId: string | null;
  readonly startedAt: number;
  completedAt: number | null;
  outcome: 'open' | 'done' | 'error' | 'aborted';
  text: string;
  stopReason: string | null;
  /** The actual reader window, retained for recap provenance even if the owner changes deepMax mid-stream. */
  readonly window: { readonly requested: number; readonly served: number };
}

export const DEFAULT_CATALOG: readonly PersonaCatalogItem[] = [
  { key: WORLD.persona.key, displayName: 'Default', version: 3, definitionId: WORLD.persona.definitionId, status: 'active' },
  { key: 'playful', displayName: 'Playful', version: 1, definitionId: 'pdef_playful000000001', status: 'active' },
];

export interface ModelStreamFacts {
  readonly requestId: string;
  readonly personaDefinitionId: string | null;
  readonly remainingRequestsToday: number | null;
  /** The page's `splitAll` flag (H-10: Hi/Ping/Coach split only with it and `split-all-v1`). */
  readonly splitAllFlag: boolean;
  /** The page's `freshText` flag (H-4c: off → the fresh text is ignored, `live.status = disabled`). */
  readonly freshTextFlag: boolean;
  readonly archive: { readonly head: { readonly messageRef: string; readonly at: string | null; readonly isFromFan: boolean } | null; readonly total: number; readonly state: (id: string) => string };
  readonly chunkDelayMs: number;
  readonly window?: { readonly requested: number; readonly limit: number };
  /** Every part of a draft ends with ` @<conversationRef>` (the `aiNameFan` knob). */
  readonly nameFan?: boolean;
  /** The whole answer per feature, in place of the synthetic one (the `aiTexts` knob). */
  readonly texts?: Readonly<Record<string, string>>;
  /** R20 HF-9: the checked pair of a Fansly request (`pair` of the frame); absent when no pair was checked. */
  readonly pair?: 'verified' | 'unverified';
  /** R20 HF-8в: the answer to the body's window check; absent unless the request advertised `coverage-check-v1` and sent one. */
  readonly coverageCheck?: CoverageCheckAnswer;
  /** The meta frame's `attachedRecaps`: Coach's Recaps, a Reply's or a Ping's dossier as `full` (hub #756); absent — not said. */
  readonly attachedRecaps?: Extract<HubFrame, { type: 'meta' }>['attachedRecaps'];
}

const TEXTS: Readonly<Record<string, { readonly single: string; readonly split: string }>> = {
  'fast-reply': { single: 'Hey you, thanks for writing! How was your day?', split: `Hey you, thanks for writing! ${SPLIT_MARKERS.next} How was your day?` },
  'improve-draft': { single: 'Here is a smoother version of your draft.', split: `Here is a smoother version ${SPLIT_MARKERS.next} of your draft.` },
  ping: { single: 'Thinking of you today, how are things?', split: `Thinking of you today ${SPLIT_MARKERS.next} how are things?` },
  'chat-review': { single: '<review><summary>Synthetic review of the chat.</summary></review>', split: '' },
  'coach-chat': { single: 'Ask about their weekend before you offer anything.', split: `Ask about their weekend ${SPLIT_MARKERS.next} then offer something small.` },
};

/** What the fake's `fan-notes-fill` writes. Labels-only mode (no `noteValues`, the released 2.10.1 and older): one
 * `Label: value` line per label. Merge mode (R20 P11b2; values since X43): an empty field gets the fact, a filled one
 * the hub's rewrite of it — its value, then the fact —, one that already holds the fact `Label: =` (the chat adds
 * nothing); each value followed by a quote of the fan, «График» with the month the fan said it, then one field the hub
 * names itself — the shape of the hub's merge answer. */
export const NOTES_FILL_FAKE = {
  fact: 'Synthetic fact from the chat.',
  quote: (label: string) => `my ${label}, in synthetic words`,
  month: '10.2026',
  proposed: { label: 'Питомцы', value: 'synthetic cat', quote: 'my synthetic cat' },
  unchanged: '=',
} as const;

function notesFillText(labels: readonly string[], values: readonly string[] | undefined): string {
  const f = NOTES_FILL_FAKE;
  if (values === undefined) return labels.map((label) => `${label}: ${f.fact}`).join('\n');
  const field = (label: string, value: string): string[] => {
    if (value.includes(f.fact)) return [`${label}: ${f.unchanged}`];
    const fact = `${f.fact}${label === 'График' ? ` (${f.month})` : ''}`;
    return [`${label}: ${value === '' ? fact : `${value}; ${fact}`}`, `> «${f.quote(label)}»`];
  };
  return [...labels.flatMap((label, index) => field(label, values[index] ?? '')), `+ ${f.proposed.label}: ${f.proposed.value}`, `> «${f.proposed.quote}»`].join('\n');
}

/** The synthetic text of one generation, with Split markers only where the hub honours them. */
export function generationText(request: HubStreamRequest, splitAllFlag: boolean): string {
  const { feature, body } = request;
  const wantsSplit = body.replyMode === 'preferSplit';
  // Reply and Fix split whenever asked; Hi, Ping and Coach only with split-all-v1 and the page's splitAll (H-10).
  const splitAllowed =
    wantsSplit && (feature === 'fast-reply' || feature === 'improve-draft' || (request.capabilities.includes('split-all-v1') && splitAllFlag && ['hi-greeting', 'ping', 'coach-chat'].includes(feature)));
  if (feature === 'fan-summary') return body.summaryMode === 'short' ? '## Short recap\nSynthetic short recap.' : '## Recap\nSynthetic recap of the conversation.\n\n- likes short replies';
  if (feature === 'voice-script') return '[warmly] Hey you, it is lovely to hear from you.';
  if (feature === 'fan-notes-fill') return notesFillText(body.noteFields ?? [], body.noteValues);
  if (feature === 'hi-greeting') {
    const variants = ['Hi and welcome!', 'Hey, glad you are here!', 'Welcome in, nice to meet you!'].slice(0, body.variantCount ?? 1);
    return variants.map((variant) => (splitAllowed ? `${variant} ${SPLIT_MARKERS.next} Ask me anything.` : variant)).join(SPLIT_MARKERS.variant);
  }
  // «Рассылка»: the mass message, made personal for this fan (the hub's Fix with `draftPurpose: 'outreach'`).
  if (feature === 'improve-draft' && body.draftPurpose === 'outreach') return 'hey you, made something new and you were the first one I thought of. it is the dragon one, 6 minutes, tell me when you get to the end';
  const text = TEXTS[feature] ?? { single: 'Synthetic answer.', split: '' };
  return splitAllowed && text.split !== '' ? text.split : text.single;
}

/**
 * «Рассылка» on the stand: the versions of one outreach — `texts['improve-draft:outreach']`, split by ` [FAN] ` — one
 * per fan in the order the fans are first written for, and the next one for «Ещё раз» of the same fan; absent — none.
 */
const outreachSeen = new Map<string, number>();
function outreachVersion(texts: Readonly<Record<string, string>> | undefined, request: HubStreamRequest): string | null {
  const list = texts?.['improve-draft:outreach'];
  if (list === undefined || request.feature !== 'improve-draft' || request.body.draftPurpose !== 'outreach') return null;
  const variants = list.split(' [FAN] ');
  const fan = String(request.body.conversationRef ?? '');
  const at = outreachSeen.get(fan);
  const index = at === undefined ? outreachSeen.size : at + 1;
  outreachSeen.set(fan, index);
  return variants[index % variants.length] ?? null;
}

/** Features whose answer is a draft for the fan (parts and variants); the others are analysis. */
const DRAFT_FEATURES: readonly string[] = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'voice-script'];

/** The draft with ` @<conversationRef>` after every part and variant: which chat each text was written for. */
export function namedForFan(text: string, request: HubStreamRequest): string {
  const conversationRef = request.body.conversationRef;
  if (!DRAFT_FEATURES.includes(request.feature)) return text;
  const tag = ` @${conversationRef}`;
  return text
    .split(SPLIT_MARKERS.variant)
    .map((variant) =>
      variant
        .split(SPLIT_MARKERS.next)
        .map((part) => `${part.trimEnd()}${tag}`)
        .join(` ${SPLIT_MARKERS.next}`),
    )
    .join(SPLIT_MARKERS.variant);
}

function chunks(text: string, size = 16): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** The model's stream for one request (checks already passed). */
export function modelStream(request: HubStreamRequest, facts: ModelStreamFacts): FakeSseStep[] {
  const { body, capabilities, feature } = request;
  const frame = (f: HubFrame, afterMs?: number): FakeSseStep => (afterMs === undefined || afterMs === 0 ? { kind: 'frame', frame: f } : { kind: 'frame', frame: f, afterMs });
  const debug = capabilities.includes('debug-input-v1');
  const steps: FakeSseStep[] = [
    frame({
      type: 'meta',
      requestId: facts.requestId,
      clientRequestId: body.clientRequestId,
      feature,
      pageLabel: body.pageLabel,
      model: 'synthetic-model',
      // The vendored SDK's meta frame takes only these providers (its schema checks frames first).
      provider: 'anthropic',
      providerResponseId: null,
      ...(facts.personaDefinitionId === null ? {} : { personaDefinitionId: facts.personaDefinitionId }),
      ...(facts.attachedRecaps === undefined ? {} : { attachedRecaps: facts.attachedRecaps }),
      quota: { accepted: true, remainingRequestsToday: facts.remainingRequestsToday, remainingMicroUsdToday: null },
    }),
  ];
  if (debug) {
    const proof = hiStartProofDecides(feature, body, capabilities) ? body.startProof : undefined;
    steps.push(
      frame({
        type: 'debug_input_v1',
        systemBlocks: [{ text: 'synthetic system prompt', cache: '1h' }],
        userBlocks: [{ text: 'synthetic transcript', cache: 'none' }],
        contextManifest: {
          window: body.messageCount ?? null,
          feature,
          ...(proof === undefined ? {} : { hiStartProof: { source: proof.source, coveredCount: proof.coveredCount, personalCount: proof.personalCount, automatedCount: proof.automatedIds.length } }),
        },
        // HF-5: the provider image is echoed for debug, as on the hub. The fake never fetches the URL.
        ...(proof === undefined || body.fanAvatarUrl === undefined ? {} : { images: [{ url: body.fanAvatarUrl }] }),
      }),
    );
  }
  if (capabilities.includes('context-v1')) {
    const live = body.liveTextContext;
    const requested = facts.window?.requested ?? body.messageCount ?? 100;
    const liveStatus = live === undefined ? 'not_sent' : facts.freshTextFlag ? 'served' : 'disabled';
    const context: ContextFrame = {
      type: 'context_v1',
      generationRef: facts.requestId,
      source: liveStatus === 'served' ? 'union' : 'archive',
      servedHead: facts.archive.head === null ? null : { messageRef: facts.archive.head.messageRef, occurredAt: facts.archive.head.at, isFromFan: facts.archive.head.isFromFan },
      window: { requested, served: Math.min(facts.window?.limit ?? requested, facts.archive.total) },
      coverage: facts.archive.total === 0 ? 'unknown' : 'complete',
      ...(body.knownFanMessageIds === undefined ? {} : { knownFanMessages: body.knownFanMessageIds.map((id) => ({ id, state: facts.archive.state(id) })) }),
      ...(facts.coverageCheck === undefined ? {} : { coverageCheck: { window: [...facts.coverageCheck.window], deleted: [...facts.coverageCheck.deleted] } }),
      live: { status: liveStatus, accepted: liveStatus === 'served' ? (live?.items.length ?? 0) : 0, rejected: 0 },
      fanLanguageEvidence: 'latin',
    };
    // `pair` (R20 HF-9) is a key of the hub's frame our mirror does not name yet (it is not strict: later keys pass).
    steps.push(frame(facts.pair === undefined ? context : ({ ...context, pair: facts.pair } as ContextFrame)));
  }
  if (debug) steps.push(frame({ type: 'reasoning_delta', text: 'synthetic reasoning' }));
  const written = outreachVersion(facts.texts, request) ?? facts.texts?.[feature] ?? generationText(request, facts.splitAllFlag);
  const text = facts.nameFan === true ? namedForFan(written, request) : written;
  for (const piece of chunks(text)) steps.push(frame({ type: 'content_delta', text: piece }, facts.chunkDelayMs));
  steps.push(
    frame({
      type: 'usage',
      usage: { inputTokens: 1200, outputTokens: Math.ceil(text.length / 4), cacheWriteTokens: 0, cacheReadTokens: 1000, costMicroUsd: 2500, costApproximate: false },
      providerResponseId: null,
      cacheHit: true,
    }),
    frame({ type: 'done', stopReason: 'end_turn' }),
    { kind: 'eof' },
  );
  return steps;
}
