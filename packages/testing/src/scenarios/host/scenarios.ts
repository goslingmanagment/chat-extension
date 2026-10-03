// Scripted HostPort scenarios (architecture.md §16 freeze item 9, §6.4–§6.7):
// route and composer churn, every insert and navigation outcome, every X8
// preflight condition and attempt path, human sends with and without
// attribution, a degrading contract. Each scenario is data: the script the
// fake host plays, the consumer's calls with the port's answers, the attempt
// paths and the «Отправить» rows a correct consumer ends in. The ChatSpace
// adapter (R09) must produce the same answers; the coordinators and
// controllers (R10–R12) are tested against these.

import {
  type ChatRef,
  type DispatchTicket,
  type FreshnessCheckpoint,
  type HostEvent,
  type HubBinding,
  type IncomingFact,
  type InsertIntent,
  type InsertReceipt,
  type InsertWire,
  type NavigationIntent,
  type NavigationReceipt,
  type PreviewSendCommit,
  type PreviewSendPreflight,
  type PreviewSendRequest,
  type PreviewSendState,
  type SendAttemptState,
  type SendAttemptView,
  type Target,
  PREVIEW_SEND_CONDITION_CODES,
  BRIDGE_WRITE_FAILURES,
} from '@cg/contracts';

import { type HostAnswers, type HostScript, type HostStep } from './fake-host-port';
import {
  DOCUMENT,
  HOST_IDS,
  HOST_T0,
  contractReport,
  emptyDraft,
  hostAccount,
  hostCause,
  hostIso,
  hostUuid,
  humanDraft,
  memory,
  mounts,
  openChat,
  previewChat,
  previewCheckpoint,
  startSnapshot,
} from './world';

export const HOST_TOPICS = [
  'route-churn',
  'composer-replaced',
  'insert-applied',
  'insert-human-draft',
  'insert-uncertain',
  'insert-misplaced',
  'insert-token-refused',
  'navigate-insert',
  'navigate-human-draft',
  'navigate-timeout',
  'navigate-token-refused',
  'x8-preflight-conditions',
  'x8-sent',
  'x8-not-enqueued',
  'x8-held-stale',
  'x8-guard',
  'x8-401-uncertain',
  'x8-late-echo',
  'x8-reload',
  'x8-commit-lost',
  'x8-duplicate-command',
  'no-checkpoint',
  'coverage-unknown',
  'human-send-attributed',
  'human-send-edited',
  'human-send-unknown',
  'contract-degraded',
] as const;
export type HostTopic = (typeof HOST_TOPICS)[number];

/** One call of the consumer and what the port answers. `redeemed: false` — the action token is refused. */
export type HostCall =
  | { readonly call: 'insert'; readonly intent: InsertIntent; readonly expect: InsertReceipt; readonly redeemed?: false }
  | { readonly call: 'navigate'; readonly intent: NavigationIntent; readonly expect: NavigationReceipt; readonly redeemed?: false }
  | { readonly call: 'checkpoint'; readonly chat: ChatRef; readonly expect: FreshnessCheckpoint | null }
  | { readonly call: 'preflight'; readonly request: PreviewSendRequest; readonly expect: PreviewSendPreflight }
  | { readonly call: 'commit'; readonly request: PreviewSendRequest; readonly ticket: DispatchTicket; readonly expect: PreviewSendCommit };

/** An X8 attempt: its states from `preparing` (the background's) and the row it ends in. */
export interface HostAttemptExpectation {
  readonly attemptId: string;
  readonly path: readonly SendAttemptState[];
  readonly row: PreviewSendState['s'];
}

/** A human send from the composer: whether a correct consumer records `sent`, and `edited` when it does. */
export interface HumanSendExpectation {
  readonly pendingId: string;
  readonly sent: boolean;
  readonly edited: boolean | null;
}

export interface HostScenario {
  readonly name: string;
  readonly description: string;
  readonly covers: readonly HostTopic[];
  readonly script: HostScript;
  readonly calls: readonly HostCall[];
  readonly attempts: readonly HostAttemptExpectation[];
  readonly humanSends: readonly HumanSendExpectation[];
}

// ── builders ───────────────────────────────────────────────────────────────

const binding: HubBinding = {
  hubOrigin: 'https://hub.example.test',
  principalId: 7,
  loginEpoch: 1,
  host: 'chatspace',
  hostAccountId: HOST_IDS.acc,
  platform: 'onlyfans',
  platformAccountId: HOST_IDS.creator,
  pageId: 11,
  pageLabel: 'model-one',
  bindingRevision: 2,
};
const previewTarget: Target = { binding, chat: previewChat, fanRef: HOST_IDS.previewFan, conversationRef: HOST_IDS.previewFan };

const openInsert = (n: number, patch: Partial<InsertIntent> = {}): InsertIntent => ({
  intentId: hostUuid(n),
  operationId: hostUuid(0x100),
  part: { index: 0 },
  target: openChat,
  expected: { kind: 'open', documentEpoch: DOCUMENT, routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: emptyDraft.revision, draftDigest: emptyDraft.digest },
  mode: 'replace',
  text: 'Hi there',
  confirmationId: null,
  createdAt: HOST_T0,
  expiresAt: HOST_T0 + 20_000,
  cause: hostCause,
  ...patch,
});

const deferredInsert = (n: number): InsertWire => ({
  intentId: hostUuid(n),
  operationId: hostUuid(0x101),
  part: { index: 0 },
  target: previewChat,
  expected: { kind: 'deferred', documentEpoch: DOCUMENT },
  mode: 'replace',
  text: 'Hey, saw your message',
  confirmationId: null,
  createdAt: HOST_T0,
  expiresAt: HOST_T0 + 20_000,
});

const navigation = (n: number, thenInsert?: InsertWire): NavigationIntent => ({
  intentId: hostUuid(n),
  cause: hostCause,
  target: { hostAccountId: HOST_IDS.acc, platformFanId: HOST_IDS.previewFan },
  ...(thenInsert === undefined ? {} : { thenInsert }),
});

const sendRequest = (attempt: number, checkpoint: FreshnessCheckpoint = previewCheckpoint): PreviewSendRequest => ({
  attemptId: hostUuid(attempt),
  target: previewTarget,
  generationRef: hostUuid(0x200),
  part: { index: 0 },
  previewRevision: 0,
  plainText: 'Hey you, missed me?',
  isAiGenerated: true,
  checkpoint,
  cause: hostCause,
});

const ticket = (attempt: number): DispatchTicket => ({ attemptId: hostUuid(attempt), ticket: `ticket-${attempt}`, expiresAt: HOST_T0 + 9_000 });

const sendState = (at: number, view: SendAttemptView): HostStep => ({ kind: 'send-state', at, view });
const event = (at: number, hostEvent: HostEvent): HostStep => ({ kind: 'event', at, event: hostEvent });

const incoming = (msgId: string, fromFan: boolean, chat: ChatRef = previewChat): IncomingFact => ({
  host: 'chatspace',
  hostAccountId: chat.hostAccountId,
  platformFanId: chat.platformFanId,
  platformMessageId: msgId,
  fromFan,
  automatic: false,
  tip: false,
  sentAt: hostIso(5),
  socketEpoch: 1,
  fanSequence: fromFan ? 3 : 2,
  source: 'ws-tap',
});

/** The answer queues follow the calls: each call takes the answer it expects; a refused token takes none. */
function answersOf(calls: readonly HostCall[], checkpoint: readonly (FreshnessCheckpoint | null)[] = []): HostAnswers {
  const committed = new Set<string>();
  return {
    redeem: calls.flatMap((c) => (c.call === 'insert' || c.call === 'navigate' ? [c.redeemed !== false] : [])),
    insert: calls.flatMap((c) => (c.call === 'insert' && c.redeemed !== false ? [c.expect] : [])),
    navigate: calls.flatMap((c) => (c.call === 'navigate' && c.redeemed !== false ? [c.expect] : [])),
    checkpoint: [...checkpoint, ...calls.flatMap((c) => (c.call === 'checkpoint' ? [c.expect] : []))],
    preflight: calls.flatMap((c) => (c.call === 'preflight' ? [c.expect] : [])),
    commit: calls.flatMap((c) => {
      if (c.call !== 'commit' || committed.has(c.request.attemptId)) return [];
      committed.add(c.request.attemptId);
      return [c.expect];
    }),
  };
}

interface ScenarioInput {
  readonly name: string;
  readonly description: string;
  readonly covers: readonly HostTopic[];
  readonly calls?: readonly HostCall[];
  readonly timeline?: readonly HostStep[];
  readonly attempts?: readonly HostAttemptExpectation[];
  readonly humanSends?: readonly HumanSendExpectation[];
  readonly start?: Partial<HostScript['start']>;
  readonly memory?: Partial<HostScript['memory']>;
}

function scenario(input: ScenarioInput): HostScenario {
  const calls = input.calls ?? [];
  return {
    name: input.name,
    description: input.description,
    covers: input.covers,
    script: {
      start: { ...startSnapshot, ...input.start },
      memory: { ...memory, ...input.memory },
      checkpoint: previewCheckpoint,
      answers: answersOf(calls),
      timeline: input.timeline ?? [],
    },
    calls,
    attempts: input.attempts ?? [],
    humanSends: input.humanSends ?? [],
  };
}

const preflightOk = (attempt: number): HostCall => ({ call: 'preflight', request: sendRequest(attempt), expect: { ok: true } });
const commit = (attempt: number, expect: PreviewSendCommit): HostCall => ({ call: 'commit', request: sendRequest(attempt), ticket: ticket(attempt), expect });
const enqueued = (attempt: number): PreviewSendCommit => ({ state: 'nativeEnqueued', pendingId: hostUuid(0x300 + attempt) });
const view = (attempt: number, state: SendAttemptState, extra: Partial<SendAttemptView> = {}): SendAttemptView => ({ attemptId: hostUuid(attempt), state, ...extra });

const otherChat: ChatRef = { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: '2004' };

// ── scenarios ──────────────────────────────────────────────────────────────

export const HOST_SCENARIOS: readonly HostScenario[] = [
  scenario({
    name: 'route-and-composer-churn',
    description:
      'The person switches chats: the route moves, the old composer goes, a new composer node (new instance id) mounts, the dock floats over a changed frame; an insert prepared for the old composer is refused as «chat changed».',
    covers: ['route-churn', 'composer-replaced'],
    timeline: [
      event(1000, { type: 'route', route: { epoch: 6, name: 'chat', account: hostAccount, chat: otherChat } }),
      event(1010, { type: 'composer', composer: null }),
      event(1200, { type: 'composer', composer: { chat: otherChat, instanceId: 'composer-2', ready: true, hidden: false, draft: { revision: 0, provenance: 'empty' } } }),
      event(1250, { type: 'chatCache', chat: otherChat }),
      { kind: 'mounts', at: 1300, mounts: { ...mounts, dock: { kind: 'fixed-overlay', composerInstanceId: 'composer-2', width: 700 } } },
      event(1400, { type: 'accounts', accounts: [hostAccount] }),
    ],
    calls: [{ call: 'insert', intent: openInsert(1), expect: { state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' } }],
  }),
  scenario({
    name: 'insert-outcomes',
    description:
      'Guarded insert (§6.4): applied into an empty draft; refused over a human draft until the person confirms, then appended with that consent; uncertain (never inserted again); misplaced on exact evidence (P1); a refused action token writes nothing.',
    covers: ['insert-applied', 'insert-human-draft', 'insert-uncertain', 'insert-misplaced', 'insert-token-refused'],
    calls: [
      { call: 'insert', intent: openInsert(1), expect: { state: 'applied', draftRevision: 5, draftDigest: 'feedbeef00000005', ms: 7 } },
      {
        call: 'insert',
        intent: openInsert(2, { expected: { kind: 'open', documentEpoch: DOCUMENT, routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: humanDraft.revision, draftDigest: humanDraft.digest } }),
        expect: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' },
      },
      {
        call: 'insert',
        intent: openInsert(3, {
          mode: 'append',
          confirmationId: hostUuid(0x40),
          expected: { kind: 'open', documentEpoch: DOCUMENT, routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: humanDraft.revision, draftDigest: humanDraft.digest },
        }),
        expect: { state: 'applied', draftRevision: 10, draftDigest: 'feedbeef0000000a', ms: 9 },
      },
      { call: 'insert', intent: openInsert(4), expect: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } },
      { call: 'insert', intent: openInsert(5), expect: { state: 'uncertain', code: 'CG-INSERT-MISPLACED' } },
      { call: 'insert', intent: openInsert(6), expect: { state: 'rejected', code: 'CG-INSERT-FAILED' }, redeemed: false },
    ],
  }),
  scenario({
    name: 'open-and-insert',
    description:
      '«Открыть и вставить» (§6.5): the navigation opens the target and the deferred insert lands in its empty draft; a second target holds a human draft, so the insert is refused for confirmation and the chat stays open.',
    covers: ['navigate-insert', 'navigate-human-draft'],
    calls: [
      {
        call: 'navigate',
        intent: navigation(10, deferredInsert(11)),
        expect: { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef00000101', ms: 11 } },
      },
      {
        call: 'navigate',
        intent: navigation(12, deferredInsert(13)),
        expect: { state: 'navigated', routeEpoch: 7, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } },
      },
    ],
  }),
  scenario({
    name: 'navigation-failures',
    description:
      'The bridge times out under a navigation with an insert: the navigation is failed CG-NAV-TIMEOUT and its insert uncertain (BRIDGE_WRITE_FAILURES), never re-sent; a refused action token navigates nowhere.',
    covers: ['navigate-timeout', 'navigate-token-refused'],
    calls: [
      { call: 'navigate', intent: navigation(14, deferredInsert(15)), expect: BRIDGE_WRITE_FAILURES.navigate },
      { call: 'navigate', intent: navigation(16), expect: { state: 'failed', code: 'CG-NAV-FAILED', insert: null }, redeemed: false },
    ],
  }),
  scenario({
    name: 'x8-preflight-conditions',
    description: 'Every §6.7.4 condition refuses the button before any click, then everything clears.',
    covers: ['x8-preflight-conditions'],
    calls: [
      ...PREVIEW_SEND_CONDITION_CODES.map((code, i): HostCall => ({ call: 'preflight', request: sendRequest(0x20 + i), expect: { ok: false, code } })),
      preflightOk(0x30),
    ],
  }),
  scenario({
    name: 'x8-sent',
    description: 'One part: checkpoint at Generate, clean preflight, one queue call; the receipt gives the id, the outgoing echo with that id proves it.',
    covers: ['x8-sent'],
    calls: [{ call: 'checkpoint', chat: previewChat, expect: previewCheckpoint }, preflightOk(0x50), commit(0x50, enqueued(0x50))],
    timeline: [
      sendState(400, view(0x50, 'nativeAccepted', { platformMessageId: HOST_IDS.messages.sent })),
      event(650, { type: 'incoming', fact: incoming(HOST_IDS.messages.sent, false) }),
      sendState(660, view(0x50, 'sentObserved', { platformMessageId: HOST_IDS.messages.sent })),
    ],
    attempts: [{ attemptId: hostUuid(0x50), path: ['preparing', 'nativeEnqueued', 'nativeAccepted', 'sentObserved'], row: 'sent' }],
  }),
  scenario({
    name: 'x8-not-enqueued',
    description: 'The queue returns null (Mimic took the chat, or 50 entries): nothing went out, the person may click again.',
    covers: ['x8-not-enqueued'],
    calls: [preflightOk(0x51), commit(0x51, { state: 'notEnqueued', code: 'CG-SEND-QUEUE' })],
    attempts: [{ attemptId: hostUuid(0x51), path: ['preparing', 'notEnqueued'], row: 'rejected' }],
  }),
  scenario({
    name: 'x8-held-stale',
    description: 'The fan writes between the click and the queue call: MAIN holds in the same step (CG-SEND-STALE); another click does not lift it.',
    covers: ['x8-held-stale'],
    calls: [preflightOk(0x52), commit(0x52, { state: 'held', code: 'CG-SEND-STALE' })],
    timeline: [event(100, { type: 'incoming', fact: incoming(HOST_IDS.messages.fanAfter, true) })],
    attempts: [{ attemptId: hostUuid(0x52), path: ['preparing', 'held'], row: 'held-stale' }],
  }),
  scenario({
    name: 'x8-guard',
    description: 'Message Guard refuses the text: a proven 4xx, `rejected` with its topics and status; the same part is not sent again.',
    covers: ['x8-guard'],
    calls: [preflightOk(0x53), commit(0x53, enqueued(0x53))],
    timeline: [
      sendState(500, view(0x53, 'rejected', { code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['contact-info'], upstream: 'MESSAGE_GUARD_VIOLATION' } })),
    ],
    attempts: [{ attemptId: hostUuid(0x53), path: ['preparing', 'nativeEnqueued', 'rejected'], row: 'rejected' }],
  }),
  scenario({
    name: 'x8-401-uncertain',
    description: 'The intercepted response is a 401 and the native chain finishes without a receipt: uncertain, the custody stays, no retry.',
    covers: ['x8-401-uncertain'],
    calls: [preflightOk(0x54), commit(0x54, enqueued(0x54))],
    timeline: [sendState(30_000, view(0x54, 'uncertain', { code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 401, no receipt of the finished chain' } }))],
    attempts: [{ attemptId: hostUuid(0x54), path: ['preparing', 'nativeEnqueued', 'uncertain'], row: 'uncertain' }],
  }),
  scenario({
    name: 'x8-late-echo',
    description: 'The receipt arrives, the echo is late and the observer gives up (uncertain); the late echo with the same id still completes the linked pair.',
    covers: ['x8-late-echo'],
    calls: [preflightOk(0x55), commit(0x55, enqueued(0x55))],
    timeline: [
      sendState(400, view(0x55, 'nativeAccepted', { platformMessageId: HOST_IDS.messages.sent })),
      sendState(30_000, view(0x55, 'uncertain', { code: 'CG-SEND-UNCERTAIN', platformMessageId: HOST_IDS.messages.sent })),
      event(45_000, { type: 'incoming', fact: incoming(HOST_IDS.messages.sent, false) }),
      sendState(45_010, view(0x55, 'sentObserved', { platformMessageId: HOST_IDS.messages.sent })),
    ],
    attempts: [{ attemptId: hostUuid(0x55), path: ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain', 'sentObserved'], row: 'sent' }],
  }),
  scenario({
    name: 'x8-reload',
    description: 'The page reloads while the native send runs: the attempt is uncertain; the new document has no record of it and nothing is sent again.',
    covers: ['x8-reload'],
    calls: [preflightOk(0x56), commit(0x56, enqueued(0x56))],
    timeline: [event(200, { type: 'reloadNeeded' }), sendState(210, view(0x56, 'uncertain', { code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'document reloaded' } }))],
    attempts: [{ attemptId: hostUuid(0x56), path: ['preparing', 'nativeEnqueued', 'uncertain'], row: 'uncertain' }],
  }),
  scenario({
    name: 'x8-commit-lost',
    description: 'The bridge answer of the queue call is lost: the call may have run, so the attempt is uncertain (BRIDGE_WRITE_FAILURES) and the custody stays.',
    covers: ['x8-commit-lost'],
    calls: [preflightOk(0x57), commit(0x57, BRIDGE_WRITE_FAILURES.previewSendCommit)],
    attempts: [{ attemptId: hostUuid(0x57), path: ['preparing', 'uncertain'], row: 'uncertain' }],
  }),
  scenario({
    name: 'x8-duplicate-command',
    description: 'The same attempt reaches MAIN twice: MAIN answers the first result again and calls the queue once.',
    covers: ['x8-duplicate-command'],
    calls: [preflightOk(0x58), commit(0x58, enqueued(0x58)), commit(0x58, enqueued(0x58))],
    attempts: [{ attemptId: hostUuid(0x58), path: ['preparing', 'nativeEnqueued'], row: 'sending' }],
  }),
  scenario({
    name: 'freshness-unknown',
    description:
      'MAIN gives no checkpoint (the result can be inserted, never sent); then the account loses its socket subscription: coverage unknown, the checkpoint says so, and the preflight refuses with CG-SEND-FRESHNESS.',
    covers: ['no-checkpoint', 'coverage-unknown'],
    calls: [
      { call: 'checkpoint', chat: previewChat, expect: null },
      { call: 'checkpoint', chat: previewChat, expect: { ...previewCheckpoint, socketEpoch: 2, coverage: 'unknown' } },
      { call: 'preflight', request: sendRequest(0x59, { ...previewCheckpoint, socketEpoch: 2, coverage: 'unknown' }), expect: { ok: false, code: 'CG-SEND-FRESHNESS' } },
    ],
    timeline: [event(100, { type: 'coverage', coverage: { hostAccountId: HOST_IDS.acc, state: 'unknown', reason: 'socket-reconnect' } })],
  }),
  scenario({
    name: 'human-sends',
    description:
      'The person presses ChatSpace Send three times: our insert unchanged (sent, not edited), our insert edited (sent, edited), and a send with no receipt and no insert behind it (attribution unknown: no `sent`).',
    covers: ['human-send-attributed', 'human-send-edited', 'human-send-unknown'],
    calls: [{ call: 'insert', intent: openInsert(0x60), expect: { state: 'applied', draftRevision: 5, draftDigest: 'feedbeef00000005', ms: 7 } }],
    timeline: [
      event(2000, {
        type: 'humanSend',
        fact: {
          chat: openChat,
          pendingId: hostUuid(0x61),
          platformMessageId: HOST_IDS.messages.humanSent,
          textDigest: 'feedbeef00000061',
          draft: { revision: 5, provenance: 'our-insert', insertIntentId: hostUuid(0x60), editedSinceInsert: false },
        },
      }),
      event(2010, { type: 'incoming', fact: incoming(HOST_IDS.messages.humanSent, false, openChat) }),
      event(5000, {
        type: 'humanSend',
        fact: {
          chat: openChat,
          pendingId: hostUuid(0x62),
          platformMessageId: '4102',
          textDigest: 'feedbeef00000062',
          draft: { revision: 8, provenance: 'human-or-unknown', insertIntentId: hostUuid(0x60), editedSinceInsert: true },
        },
      }),
      event(5010, { type: 'incoming', fact: incoming('4102', false, openChat) }),
      event(9000, {
        type: 'humanSend',
        fact: {
          chat: openChat,
          pendingId: hostUuid(0x63),
          platformMessageId: null,
          textDigest: 'feedbeef00000063',
          draft: { revision: 11, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null },
        },
      }),
    ],
    humanSends: [
      { pendingId: hostUuid(0x61), sent: true, edited: false },
      { pendingId: hostUuid(0x62), sent: true, edited: true },
      { pendingId: hostUuid(0x63), sent: false, edited: null },
    ],
  }),
  scenario({
    name: 'contract-degraded',
    description:
      'An unverified send path profile keeps X8 off (no PreviewSendPort, CG-SEND-RECEIPT); later the composer bridge disappears: insert goes contract-broken, the dock turns copy-only.',
    covers: ['contract-degraded'],
    start: { contract: contractReport({ previewSend: { state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' }, receipt: { state: 'off', code: 'CG-SEND-RECEIPT' } }) },
    timeline: [
      {
        kind: 'contract',
        at: 3000,
        report: {
          ...contractReport({
            previewSend: { state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' },
            receipt: { state: 'off', code: 'CG-SEND-RECEIPT' },
            insert: { state: 'contractBroken', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' },
          }),
          anchors: { ...contractReport().anchors, composerBridge: 'missing' },
        },
      },
      { kind: 'mounts', at: 3010, mounts: { ...mounts, dock: { kind: 'copy-only-row', composerInstanceId: null, width: 720 } } },
    ],
  }),
];
