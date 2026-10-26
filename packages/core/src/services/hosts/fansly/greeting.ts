// The greeting of a «Новые» card on Fansly in the background (R20 P10c; docs/project-unite/architecture.md §8.6, §8.7,
// §9.4; spec FS-NEW-3, FS-NEW-6, FS-NEW-7; NF-012…NF-019, NF-023, NF-024, NF-034, NF-036). It answers the card's
// requests `fansly.followers.{proof,draft,send,sent}` over the pass (./newcomers.ts) and the send with the hub's custody
// (./send.ts), and it is the «now» of the send's final check: the pass's row and the draft's revision, from memory.
//
// - `proof` — what «Сгенерировать» takes of the pass (FS-NEW-7): the checked history's ids, the start, the avatar of the
//   profile the pass read (FX-018); a check older than a couple of minutes is made again first (2026-10-26). The generation itself is the tab's: the hub builds it from its own history (X4).
//   `recheck` — the history read again while Hi generates (2026-10-25): a colleague's greeting stops it.
// - `draft` — the card's field (NF-012): kept per creator (its hub page) and fan in the shared `newcomers.drafts` (5000
//   characters, until sent or cleared, at most 7 days), merged draft by draft with what the tabs wrote; read without a text, written with one. The
//   background holds the revision, so the final check compares the click's with the one now.
// - `send` — one click (FS-NEW-3): one open action per pass and fan (NF-023: a second click while one runs is
//   CG-SEND-BUSY); the three admissions (FS-NEW-6): every text goes on the history revision the card shows (as the old
//   window sent, 2026-10-22); an unchanged AI result goes as THIS generation when the background can vouch for it, and
//   otherwise as the person's own text — never a refusal for it. Its freshness verdict stays a warning (X69). Then the
//   fan's history is read again (NF-036) — one that changed between the click and the send refuses CG-FNEW-HISTORY,
//   the race the old window checked too — and the send goes: the lease, the route, the journal, the custody, the
//   durable intent, the final check, ONE `POST /message`. A greeting that went is never sent again (X5); one whose
//   outcome is unknown holds nothing: the person's own new click goes (never a retry of ours). Every refusal names its
//   code (NF-024).
// - `sent` — the person sent the card's text with Fansly's own button after «Открыть и вставить» (FS-NEW-3): the hub's
//   `registerNativeSend`, owed until it answers (./send.ts `native`); the fan is greeted for everyone.
// A greeting that went (a receipt, the echo, a registration) makes the row «Уже писали» and clears the draft.
//
// Fansly's own code (`bg/fansly` chunk); it names no site and asks Fansly nothing itself.

import { type CgAnyCode } from '@cg/contracts/errors-fansly';
import { type GreetingDraftGeneration, type StaleReason } from '@cg/contracts/ops';
import { type FanslyGreetingRequest, type FanslySendView } from '@cg/contracts/send-fansly';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { FANSLY_TAB_LIMITS, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';

import { EMPTY_DRAFTS, draftKey, findDraft, mergeDraftStores, putDraft, readDraftStore, removeDraft, type DraftStore, type PreviewDraft } from '../../../domain/newcomers/drafts';
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
  /** Its own freshness verdict (spec §3.5), kept as an advisory mark on the draft (X69). */
  readonly fresh: boolean;
  readonly mark?: StaleReason | null;
}

export interface FanslyGreetingDeps {
  readonly newcomers: Pick<FanslyNewcomers, 'row' | 'creatorOf' | 'freshProof' | 'recheck' | 'live' | 'greeted'>;
  readonly send: Pick<FanslySend, 'send' | 'native' | 'onChange' | 'status' | 'latest'>;
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
export type GreetingRequest = 'fansly.followers.proof' | 'fansly.followers.recheck' | 'fansly.followers.draft' | 'fansly.followers.outcomes' | 'fansly.followers.send' | 'fansly.followers.sent';
const REQUESTS: Readonly<Record<GreetingRequest, true>> = {
  'fansly.followers.proof': true,
  'fansly.followers.recheck': true,
  'fansly.followers.draft': true,
  'fansly.followers.outcomes': true,
  'fansly.followers.send': true,
  'fansly.followers.sent': true,
};

export type FanslyGreeting = ReturnType<typeof createFanslyGreeting>;

export function createFanslyGreeting(deps: FanslyGreetingDeps) {
  const log = deps.log ?? NO_LOG;
  /** NF-023: one action at a time per creator and fan, across passes and tabs. */
  const busy = new Map<string, string>();
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
  function write(key: string, text: string | null, historyRevision: string | null, generation?: GreetingDraftGeneration): Promise<{ readonly ok: true; readonly draft: PreviewDraft | null; readonly revision: number } | { readonly ok: false }> {
    return writes.run(async () => {
      const now = deps.now();
      const merged = mergeDraftStores(await stored(), await loaded(), now);
      const put = text === null ? { store: removeDraft(merged, key, now), draft: null, revision: 0 } : putDraft(merged, key, text, now, historyRevision, generation ?? findDraft(merged, key, now)?.generation);
      const written = await deps.local.set({ [DRAFTS_KEY]: put.store });
      if (!written.ok) {
        log({ level: 'warn', scope: 'bg.fansly.greeting', msg: 'draft not written', code: 'CG-STORAGE-WRITE', fields: { reason: written.code } });
        return { ok: false };
      }
      store = put.store;
      return { ok: true, draft: put.draft, revision: put.revision };
    });
  }

  async function draft(payload: Payload<'fansly.followers.draft'>, tab: string): Promise<Answer<'fansly.followers.draft'>> {
    const row = deps.newcomers.row(payload.passId, payload.fanRef, tab);
    if (row === null) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const page = await deps.page(row.creator, tab);
    if (!page.ok) return { ok: false, error: { code: page.code } };
    const key = keyOf(page.page.pageId, payload.fanRef);
    if (key === null) return { ok: false, error: { code: 'CG-AUTH-REQUIRED' } };
    const known = await deps.send.status(page.page, payload.fanRef);
    const active = busy.get(`${row.creator}|${payload.fanRef}`);
    const attempt = active !== undefined && known?.attemptId !== active ? { attemptId: active, fanRef: payload.fanRef, state: 'ready' as const } : known;
    const status = attempt === null ? {} : { attempt };
    const viewOf = (found: PreviewDraft | null, revision: number) => ({ text: found?.text ?? '', revision, historyRevision: found?.threadRevision ?? null, ...(found?.generation === undefined ? {} : { generation: found.generation }), ...status });
    if (payload.text === undefined) {
      const held = await loaded();
      const found = findDraft(held, key, deps.now());
      return { ok: true, draft: viewOf(found, found?.revision ?? held.removed?.find((mark) => mark.key === key)?.revision ?? 0) };
    }
    let generation: GreetingDraftGeneration | undefined;
    if (payload.generation !== undefined) {
      const op = deps.generation(payload.generation.opId);
      // The tab supplies the link, never the verdict: keep THIS operation's evidence with its text. A link the
      // background cannot vouch for (the operation is gone, another text) is no refusal (2026-10-22): the text is
      // written as it is, and it goes as the person's own.
      const text = op?.text?.trim() ?? null;
      if (op !== null && text !== null && op.fanRef === payload.fanRef && op.conversationRef === row.view.groupId && text === payload.text.trim()) {
        generation = { ...payload.generation, generationRef: op.generationRef, text, mark: op.mark ?? (op.fresh ? null : 'unverified') };
      }
    }
    // The revision of the history the person looked at when they wrote it (NF-018).
    const historyRevision = row.view.historyRevision;
    const written = await write(key, payload.text, historyRevision, generation);
    if (!written.ok) return { ok: false, error: { code: 'CG-STORAGE-WRITE' } };
    return { ok: true, draft: viewOf(written.draft, written.revision) };
  }

  /**
   * The list's word for each fan's greeting before any card is opened (the old window's «Нужно проверить»): the newest
   * attempt of every fan of the creator's page, from memory, and the clicks running in this background now. A refused
   * attempt is left out: nothing went, the row says «Не писали» as it is.
   */
  async function outcomes(payload: Payload<'fansly.followers.outcomes'>, tab: string): Promise<Answer<'fansly.followers.outcomes'>> {
    const creator = deps.newcomers.creatorOf(payload.passId, tab);
    if (creator === null) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const page = await deps.page(creator, tab);
    if (!page.ok) return { ok: false, error: { code: page.code } };
    const byFan = new Map<string, FanslySendView>();
    for (const view of await deps.send.latest(page.page)) if (view.state !== 'refused') byFan.set(view.fanRef, view);
    for (const [lock, attemptId] of busy) {
      const [owner, fanRef] = lock.split('|');
      if (owner === creator && fanRef !== undefined && byFan.get(fanRef)?.attemptId !== attemptId) byFan.set(fanRef, { attemptId, fanRef, state: 'ready' });
    }
    return { ok: true, attempts: [...byFan.values()].slice(0, FANSLY_TAB_LIMITS.followerOutcomesMax) };
  }

  // ── the generation's proof (FS-NEW-7) ──

  /** 2026-10-26: never on a check older than a couple of minutes — the card's Hi and a batch's alike (newcomers.ts `freshProof`). */
  async function proof(payload: Payload<'fansly.followers.proof'>, tab: string): Promise<Answer<'fansly.followers.proof'>> {
    const answer = await deps.newcomers.freshProof(payload.passId, payload.fanRef, tab);
    return answer.ok ? { ok: true, proof: answer.proof } : { ok: false, error: { code: answer.code } };
  }

  /**
   * 2026-10-25 (the owner: «если один нажал на hi и там месага уже есть — чтобы генерация стопнулась»): the card's Hi
   * reads the fan's history again while it generates — the send's own check (NF-036), read-only; «Уже писали» is
   * `CG-SEND-PART`, and the row says so to every window.
   */
  async function recheck(payload: Payload<'fansly.followers.recheck'>, tab: string): Promise<Answer<'fansly.followers.recheck'>> {
    const answer = await deps.newcomers.recheck(payload.passId, payload.fanRef, tab);
    if (answer.ok) return { ok: true, historyRevision: answer.historyRevision };
    return { ok: false, error: answer.retryAt === undefined ? { code: answer.code } : { code: answer.code, retryAt: answer.retryAt } };
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
    /** `retryAt` — a cooldown of Fansly's: the card says how long, at once (never «Отправляем…» while it lasts). */
    const fail = (code: CgAnyCode, retryAt?: number): Answer<'fansly.followers.send'> => {
      log({ level: 'info', scope: 'bg.fansly.greeting', msg: 'greeting refused before an attempt', fields: { attemptId: request.attemptId, code } });
      return { ok: false, error: retryAt === undefined ? { code } : { code, retryAt } };
    };
    const lock = `${request.hostAccountId}|${request.fanRef}`;
    if (busy.has(lock)) return fail('CG-SEND-BUSY');
    busy.set(lock, request.attemptId);
    try {
      const row = deps.newcomers.row(request.passId, request.fanRef, tab);
      if (row === null) return fail('CG-CONTEXT-CHANGED');
      if (row.creator !== request.hostAccountId) return fail('CG-FNEW-ACCOUNT');
      if (row.view.status !== 'ready' || row.proof === null) return fail(notReady(row.view));
      // The conversation the pass resolved, never the fan's id (FS-IDN-6).
      if (row.proof.groupId !== request.groupId) return fail('CG-CONTEXT-CHANGED');
      const page = await deps.page(request.hostAccountId, tab);
      if (!page.ok) return fail(page.code);
      const prior = await deps.send.status(page.page, request.fanRef);
      // X5: a greeting that went is never sent again.
      if (prior?.state === 'sent' || prior?.state === 'receipted') return fail('CG-SEND-PART');
      // One under way holds the fan; an unknown outcome does not («как раньше»): this is the person's own new click.
      if (prior !== null && prior.state !== 'refused' && prior.state !== 'uncertain') return fail('CG-SEND-BUSY');
      const held = await loaded();
      const key = keyOf(page.page.pageId, request.fanRef);
      const saved = key === null ? undefined : findDraft(held, key, deps.now())?.generation;
      // FS-NEW-6, X69: an unchanged AI text goes as THIS generation when it is one the background can vouch for (its
      // operation, else the draft's saved generation); a text it cannot vouch for goes as the person's own (2026-10-22) —
      // what they see in the field is what goes, to the fan of the card. Freshness marks remain advisory.
      const ownText = (): FanslyGreetingRequest => {
        const { opId: _opId, ...rest } = request;
        return { ...rest, admission: { kind: 'own' } };
      };
      let admitted: FanslyGreetingRequest = request;
      if (request.admission.kind === 'ai') {
        const generation = request.opId === undefined ? null : deps.generation(request.opId);
        const vouched =
          generation === null
            ? saved !== undefined && saved.opId === request.opId && saved.generationRef === request.admission.generationRef && saved.text === request.text
            : generation.generationRef === request.admission.generationRef && generation.fanRef === request.fanRef && generation.conversationRef === request.groupId && generation.text?.trim() === request.text;
        if (!vouched) admitted = ownText();
      }
      if (revisionNow(page.page.pageId, request.fanRef) !== request.draftRevision) return fail('CG-DRAFT-CHANGED');
      // NF-036: the history read again before the custody; another revision than the one reviewed refuses (NF-018).
      const again = await deps.newcomers.recheck(request.passId, request.fanRef, tab);
      if (!again.ok) return fail(again.code, again.retryAt);
      if (again.historyRevision !== request.historyRevision) return fail('CG-FNEW-HISTORY');
      started.set(request.attemptId, { creator: row.creator, fanRef: request.fanRef, pageId: page.page.pageId });
      const view: FanslySendView = await deps.send.send({ request: admitted, tabSessionId: tab, page: page.page });
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
        case 'fansly.followers.recheck':
          return recheck(payload as Payload<'fansly.followers.recheck'>, tab);
        case 'fansly.followers.draft':
          return draft(payload as Payload<'fansly.followers.draft'>, tab);
        case 'fansly.followers.outcomes':
          return outcomes(payload as Payload<'fansly.followers.outcomes'>, tab);
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
