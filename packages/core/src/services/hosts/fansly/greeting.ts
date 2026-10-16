// The greeting of a «Новые» card on Fansly in the background (R20 P10c; docs/project-unite/architecture.md §8.6, §8.7,
// §9.4; spec FS-NEW-3, FS-NEW-6, FS-NEW-7; NF-012…NF-019, NF-023, NF-024, NF-034, NF-036). It answers the card's
// requests `fansly.followers.{proof,draft,send,sent}` over the pass (./newcomers.ts) and the send with the hub's custody
// (./send.ts), and it is the «now» of the send's final check: the pass's row and the draft's revision, from memory.
//
// - `proof` — what «Сгенерировать» takes of the pass (FS-NEW-7): the checked history's ids, the start, the avatar of the
//   profile the pass read (FX-018). The generation itself is the tab's: the hub builds it from its own history (X4).
// - `draft` — the card's field (NF-012): kept per creator (its hub page) and fan in the shared `newcomers.drafts` (5000
//   characters, 24 hours), merged draft by draft with what the tabs wrote; read without a text, written with one. The
//   background holds the revision, so the final check compares the click's with the one now.
// - `send` — one click (FS-NEW-3): one open action per pass and fan (NF-023: a second click while one runs is
//   CG-SEND-BUSY); the three admissions (FS-NEW-6): the person's own text and an edited AI result need a history the
//   pass read to its start and the revision the person reviewed; an unchanged AI result needs THIS generation's
//   result, its own fresh verdict (FS-TAIL-8) and the revision it was made on — a hub that caught up later does not
//   make an old result fresh. Then the fan's history is read again (NF-036) — a changed one refuses CG-FNEW-HISTORY
//   («Проверка изменилась — подтвердите черновик», NF-018) — and the send goes: the lease, the route, the journal, the
//   custody, the durable intent, the final check, ONE `POST /message`. Every refusal names its code (NF-024).
// - `sent` — the person sent the card's text with Fansly's own button after «Открыть и вставить» (FS-NEW-3): the hub's
//   `registerNativeSend`, owed until it answers (./send.ts `native`); the fan is greeted for everyone.
// A greeting that went (a receipt, the echo, a registration) makes the row «Уже писали» and clears the draft.
//
// Fansly's own code (`bg/fansly` chunk); it names no site and asks Fansly nothing itself.

import { type CgAnyCode } from '@cg/contracts/errors-fansly';
import { type FanslyGreetingRequest, type FanslySendView } from '@cg/contracts/send-fansly';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';

import { EMPTY_DRAFTS, draftKey, findDraft, mergeDraftStores, putDraft, readDraftStore, removeDraft, type DraftStore } from '../../../domain/newcomers/drafts';
import { WriteQueue } from '../../ports';
import { NO_LOG, type KeyValuePort, type ServiceLog } from '../../storage/ports';
import { notReady, type FanslyNewcomers } from './newcomers';
import { type FanslySend, type FanslySendLive, type FanslySendPage } from './send';

const DRAFTS_KEY = STORAGE_KEYS.newcomersDrafts;

/** An operation's result as the send of an unchanged AI text reads it (FS-TAIL-8). */
export interface GreetingGeneration {
  readonly generationRef: string | null;
  readonly fanRef: string;
  readonly conversationRef: string;
  /** The text of the variant's one part; null — no usable result (still running, failed, split). */
  readonly text: string | null;
  /** Its own verdict is fresh (spec §3.5): nothing else lets an unchanged AI text go. */
  readonly fresh: boolean;
}

export interface FanslyGreetingDeps {
  readonly newcomers: Pick<FanslyNewcomers, 'row' | 'greetingProof' | 'recheck' | 'live' | 'greeted'>;
  readonly send: Pick<FanslySend, 'send' | 'native' | 'onChange'>;
  /** storage.local: the drafts (the shared `newcomers.drafts`). */
  readonly local: KeyValuePort;
  /** Who is signed in; null — nobody (no draft is anybody's then). */
  session(): { readonly hubOrigin: string; readonly userId: number } | null;
  /** The creator's hub page for this tab: granted, one of its bindings; the bootstrap's `configRevision` as its flag revision. */
  page(hostAccountId: string, tab: string): Promise<{ readonly ok: true; readonly page: FanslySendPage } | { readonly ok: false; readonly code: CgAnyCode }>;
  /** The operation of an unchanged AI text in this background; null — none such. */
  generation(opId: string): GreetingGeneration | null;
  /** The tab session is registered and on this creator's account (the tab document the person acted in). */
  tabOn(tab: string, hostAccountId: string): boolean;
  readonly now: () => number;
  readonly log?: ServiceLog;
}

type Payload<T extends GreetingRequest> = FanslyTabRequestPayload<T>;
type Answer<T extends GreetingRequest> = FanslyTabResponsePayload<T>;
export type GreetingRequest = 'fansly.followers.proof' | 'fansly.followers.draft' | 'fansly.followers.send' | 'fansly.followers.sent';
const REQUESTS: Readonly<Record<GreetingRequest, true>> = { 'fansly.followers.proof': true, 'fansly.followers.draft': true, 'fansly.followers.send': true, 'fansly.followers.sent': true };

export type FanslyGreeting = ReturnType<typeof createFanslyGreeting>;

export function createFanslyGreeting(deps: FanslyGreetingDeps) {
  const log = deps.log ?? NO_LOG;
  /** NF-023: one action at a time per pass and fan. */
  const busy = new Set<string>();
  /** The card's attempts: whose greeting each one is, to mark the fan once it went. */
  const started = new Map<string, { readonly creator: string; readonly fanRef: string; readonly pageId: number }>();

  // ── the drafts (NF-012) ──

  let store: DraftStore | null = null;
  const writes = new WriteQueue();

  async function stored(): Promise<DraftStore> {
    const read = await deps.local.get([DRAFTS_KEY]);
    return read.ok ? readDraftStore(read.value[DRAFTS_KEY], deps.now()) : EMPTY_DRAFTS;
  }

  async function loaded(): Promise<DraftStore> {
    store ??= await stored();
    return store;
  }

  function keyOf(pageId: number, fanRef: string): string | null {
    const session = deps.session();
    return session === null ? null : draftKey({ hubOrigin: session.hubOrigin, userId: session.userId, pageId, list: 'newcomers', fanRef });
  }

  /** The draft's revision as this background holds it (synchronous: the final check's «now»). */
  function revisionNow(pageId: number, fanRef: string): number | null {
    const key = keyOf(pageId, fanRef);
    if (key === null || store === null) return null;
    return findDraft(store, key, deps.now())?.revision ?? store.removed?.find((mark) => mark.key === key)?.revision ?? 0;
  }

  /** Writes (or, with `null`, removes) a draft: what the tabs stored is merged in first; memory follows only a write that landed. */
  function write(key: string, text: string | null, historyRevision: string | null): Promise<{ readonly ok: true; readonly text: string; readonly revision: number } | { readonly ok: false }> {
    return writes.run(async () => {
      const now = deps.now();
      const merged = mergeDraftStores(await stored(), await loaded(), now);
      const put = text === null ? { store: removeDraft(merged, key, now), draft: null, revision: 0 } : putDraft(merged, key, text, now, historyRevision);
      const written = await deps.local.set({ [DRAFTS_KEY]: put.store });
      if (!written.ok) {
        log({ level: 'warn', scope: 'bg.fansly.greeting', msg: 'draft not written', code: 'CG-STORAGE-WRITE', fields: { reason: written.code } });
        return { ok: false };
      }
      store = put.store;
      return { ok: true, text: put.draft?.text ?? '', revision: put.revision };
    });
  }

  async function draft(payload: Payload<'fansly.followers.draft'>, tab: string): Promise<Answer<'fansly.followers.draft'>> {
    const row = deps.newcomers.row(payload.passId, payload.fanRef, tab);
    if (row === null) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const page = await deps.page(row.creator, tab);
    if (!page.ok) return { ok: false, error: { code: page.code } };
    const key = keyOf(page.page.pageId, payload.fanRef);
    if (key === null) return { ok: false, error: { code: 'CG-AUTH-REQUIRED' } };
    if (payload.text === undefined) {
      const held = await loaded();
      const found = findDraft(held, key, deps.now());
      return { ok: true, draft: { text: found?.text ?? '', revision: found?.revision ?? held.removed?.find((mark) => mark.key === key)?.revision ?? 0, historyRevision: found?.threadRevision ?? null } };
    }
    // The revision of the history the person looked at when they wrote it (NF-018).
    const historyRevision = row.view.historyRevision;
    const written = await write(key, payload.text, historyRevision);
    if (!written.ok) return { ok: false, error: { code: 'CG-STORAGE-WRITE' } };
    return { ok: true, draft: { text: written.text, revision: written.revision, historyRevision: written.text === '' ? null : historyRevision } };
  }

  // ── the generation's proof (FS-NEW-7) ──

  function proof(payload: Payload<'fansly.followers.proof'>, tab: string): Answer<'fansly.followers.proof'> {
    const answer = deps.newcomers.greetingProof(payload.passId, payload.fanRef, tab);
    return answer.ok ? { ok: true, proof: answer.proof } : { ok: false, error: { code: answer.code } };
  }

  // ── the send (FS-NEW-3, FS-NEW-6) ──

  /** The card's greeting went: «Уже писали» for the pass, the draft has done its work. */
  function went(creator: string, fanRef: string, pageId: number): void {
    deps.newcomers.greeted(creator, fanRef);
    const key = keyOf(pageId, fanRef);
    if (key !== null) void write(key, null, null);
  }

  const offViews = deps.send.onChange((view) => {
    const mine = started.get(view.attemptId);
    if (mine === undefined) return;
    if (view.state === 'receipted' || view.state === 'sent') went(mine.creator, mine.fanRef, mine.pageId);
    if (view.state === 'sent' || view.state === 'refused') started.delete(view.attemptId);
  });

  async function send(request: FanslyGreetingRequest, tab: string): Promise<Answer<'fansly.followers.send'>> {
    const fail = (code: CgAnyCode): Answer<'fansly.followers.send'> => {
      log({ level: 'info', scope: 'bg.fansly.greeting', msg: 'greeting refused before an attempt', fields: { attemptId: request.attemptId, code } });
      return { ok: false, error: { code } };
    };
    const lock = `${request.passId}|${request.fanRef}`;
    if (busy.has(lock)) return fail('CG-SEND-BUSY');
    busy.add(lock);
    try {
      const row = deps.newcomers.row(request.passId, request.fanRef, tab);
      if (row === null) return fail('CG-CONTEXT-CHANGED');
      if (row.creator !== request.hostAccountId) return fail('CG-FNEW-ACCOUNT');
      if (row.view.status !== 'ready' || row.proof === null) return fail(notReady(row.view));
      // The conversation the pass resolved, never the fan's id (FS-IDN-6).
      if (row.proof.groupId !== request.groupId) return fail('CG-CONTEXT-CHANGED');
      if (request.admission.kind === 'ai') {
        // FS-NEW-6, FS-TAIL-8: THIS generation's result, unchanged, with its own fresh verdict — else only a new one.
        const generation = request.opId === undefined ? null : deps.generation(request.opId);
        if (generation === null || generation.generationRef !== request.admission.generationRef || generation.fanRef !== request.fanRef || generation.conversationRef !== request.groupId) return fail('CG-SEND-FRESHNESS');
        if (generation.text?.trim() !== request.text) return fail('CG-DRAFT-CHANGED');
        if (!generation.fresh) return fail('CG-SEND-FRESHNESS');
      }
      const page = await deps.page(request.hostAccountId, tab);
      if (!page.ok) return fail(page.code);
      await loaded();
      if (revisionNow(page.page.pageId, request.fanRef) !== request.draftRevision) return fail('CG-DRAFT-CHANGED');
      // NF-036: the history read again before the custody; another revision than the one reviewed refuses (NF-018).
      const again = await deps.newcomers.recheck(request.passId, request.fanRef, tab);
      if (!again.ok) return fail(again.code);
      if (again.historyRevision !== request.historyRevision) return fail('CG-FNEW-HISTORY');
      started.set(request.attemptId, { creator: row.creator, fanRef: request.fanRef, pageId: page.page.pageId });
      const view: FanslySendView = await deps.send.send({ request, tabSessionId: tab, page: page.page });
      if (view.state === 'receipted' || view.state === 'sent') went(row.creator, request.fanRef, page.page.pageId);
      if (view.state === 'refused' || view.state === 'sent') started.delete(request.attemptId);
      return { ok: true, attempt: view };
    } finally {
      busy.delete(lock);
    }
  }

  /** The send's tuple now (§8.6 step 2): the pass's row, the tab the person acted in, the draft's revision — from memory. */
  const live: FanslySendLive = (start) => {
    const { request } = start;
    const row = deps.newcomers.live(request.passId, request.fanRef);
    const draftRevision = revisionNow(start.page.pageId, request.fanRef);
    if (row === null || draftRevision === null || !deps.tabOn(start.tabSessionId, row.hostAccountId)) return null;
    return { ...row, tabSessionId: start.tabSessionId, draftRevision };
  };

  // ── the person's own send (FS-NEW-3) ──

  async function sent(payload: Payload<'fansly.followers.sent'>, tab: string): Promise<Answer<'fansly.followers.sent'>> {
    // The tab is on the creator; the pass may have been let go since the insert (the window closes for the chat).
    if (!deps.tabOn(tab, payload.hostAccountId)) return { recorded: false };
    const row = deps.newcomers.row(payload.passId, payload.fanRef, tab);
    // The fan in the conversation the pass resolved, never the fan's id (FS-IDN-6).
    if (row !== null && (row.creator !== payload.hostAccountId || (row.view.groupId !== null && row.view.groupId !== payload.groupId))) return { recorded: false };
    const page = await deps.page(payload.hostAccountId, tab);
    if (!page.ok) return { recorded: false };
    const outcome = await deps.send.native({ page: page.page, fanRef: payload.fanRef, groupId: payload.groupId, platformMessageId: payload.platformMessageId, admission: payload.admission, text: payload.text });
    log({ level: 'info', scope: 'bg.fansly.greeting', msg: 'the person sent the card', fields: { outcome } });
    went(payload.hostAccountId, payload.fanRef, page.page.pageId);
    return { recorded: outcome !== 'refused' };
  }

  return {
    handles: (type: string): type is GreetingRequest => Object.prototype.hasOwnProperty.call(REQUESTS, type),
    async answer(type: GreetingRequest, payload: unknown, tab: string): Promise<unknown> {
      switch (type) {
        case 'fansly.followers.proof':
          return proof(payload as Payload<'fansly.followers.proof'>, tab);
        case 'fansly.followers.draft':
          return draft(payload as Payload<'fansly.followers.draft'>, tab);
        case 'fansly.followers.send':
          return send(payload as FanslyGreetingRequest, tab);
        case 'fansly.followers.sent':
          return sent(payload as Payload<'fansly.followers.sent'>, tab);
      }
    },
    live,
    dispose(): void {
      offViews();
      started.clear();
      busy.clear();
    },
  };
}
