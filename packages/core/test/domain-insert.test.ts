// core/domain/insert against the host fake's world (@cg/testing/host): the
// Б2 rule, one-time consents bound to a revision, open and deferred intents
// and their guards, Fix replace/restore with CAS, «Открыть и вставить»,
// receipts and the insert journal (architecture.md §6.4, §6.5).

import { describe, expect, it } from 'vitest';

import { InsertIntentSchema, LogRecordSchema, type DraftSnapshot, type HostIdentity, type InsertReceipt } from '@cg/contracts';
import {
  ConfirmationBook,
  DeferredInsertSlot,
  FIX_RESTORE_WINDOW_MS,
  FixSession,
  buildDeferredInsert,
  buildOpenAndInsert,
  buildOpenInsert,
  decideDraft,
  insertGuard,
  insertGuardEntry,
  insertIntentEntry,
  insertReceiptEntry,
  intentMatchesHost,
  interpretInsertReceipt,
  routeChangeEntry,
  type DeferredInsert,
  type InsertGuardInput,
} from '@cg/core/domain/insert';
import { FakeHostPort, HOST_SCENARIOS, HOST_T0, emptyDraft, hostAccount, hostCause, hostUuid, humanDraft, identity, openChat, previewChat, startSnapshot } from '@cg/testing/host';

import { seeded } from './support/random';
import { binding, uuid } from './support/world';

const OP = hostUuid(0x100);
const target = { binding: { ...binding, hostAccountId: openChat.hostAccountId, platformAccountId: identity.platformAccountId }, chat: openChat, fanRef: openChat.platformFanId, conversationRef: openChat.platformFanId };
const must = <T>(value: T | null): T => {
  if (value === null) throw new Error('expected a value');
  return value;
};
const draftAt = (revision: number, over: Partial<DraftSnapshot> = {}, id: Partial<HostIdentity> = {}): DraftSnapshot => ({
  ...emptyDraft,
  revision,
  digest: `feedbeef${revision.toString(16).padStart(8, '0')}`,
  ...over,
  identity: { ...identity, ...id },
});

describe('[AI-125] Б2 draft rule and one-time consent', () => {
  it('[AI-125] empty or our own unchanged draft → direct replace; human or unknown → consent', () => {
    expect(decideDraft(emptyDraft, { editorObserved: true })).toEqual({ kind: 'direct', mode: 'replace' });
    expect(decideDraft(draftAt(5, { provenance: 'our-insert', plainText: 'ours' }), { editorObserved: true })).toEqual({ kind: 'direct', mode: 'replace' });
    expect(decideDraft(humanDraft, { editorObserved: true })).toEqual({ kind: 'confirm', reason: 'human-draft', formatLoss: false });
  });

  it('[AI-125] a consent is one-time and bound to its revision; a changed draft asks again', () => {
    let n = 0;
    const book = new ConfirmationBook(() => uuid(0x500 + ++n), () => HOST_T0);
    const asked = must(book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: humanDraft, formatLoss: false }));
    expect(book.pendingFor(OP)?.confirmationId).toBe(asked.confirmationId);
    const answer = book.answer(asked.confirmationId, 'append', humanDraft);
    expect(answer).toMatchObject({ kind: 'insert', mode: 'append' });
    expect(book.answer(asked.confirmationId, 'append', humanDraft)).toEqual({ kind: 'unknown' });

    const second = must(book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: humanDraft, formatLoss: false }));
    const changed = book.answer(second.confirmationId, 'replace', { ...humanDraft, revision: humanDraft.revision + 1 });
    expect(changed.kind).toBe('ask-again');
    if (changed.kind === 'ask-again') {
      expect(changed.confirmation.kind).toBe('draft-changed');
      expect(changed.confirmation.draftRevision).toBe(humanDraft.revision + 1);
      expect(book.answer(changed.confirmation.confirmationId, 'cancel', humanDraft)).toEqual({ kind: 'canceled' });
    }
    book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: humanDraft, formatLoss: false });
    book.dropOp(OP);
    expect(book.pendingFor(OP)).toBeNull();
    book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: humanDraft, formatLoss: false });
    book.clear();
    expect(book.pendingFor(OP)).toBeNull();
  });

  it('[AI-125] property A→B→A: a draft that changed and came back to the same text is still a changed revision', () => {
    let n = 0;
    const book = new ConfirmationBook(() => uuid(0x600 + ++n), () => HOST_T0);
    const a = draftAt(9, { provenance: 'human-or-unknown', plainText: 'A' });
    const asked = must(book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: a, formatLoss: false }));
    const backToA = draftAt(11, { provenance: 'human-or-unknown', plainText: 'A' });
    expect(book.answer(asked.confirmationId, 'replace', backToA).kind).toBe('ask-again');
  });

  it('[AI-125] a consent is bound to the operation\'s chat: a draft of another chat is never asked about, and an answer there voids the question', () => {
    let n = 0;
    const book = new ConfirmationBook(() => uuid(0x680 + ++n), () => HOST_T0);
    const onPreview = draftAt(4, { provenance: 'human-or-unknown', plainText: 'B' }, { chat: previewChat, routeEpoch: 6 });
    expect(book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: onPreview, formatLoss: false })).toBeNull();
    expect(book.pendingFor(OP)).toBeNull();
    const asked = must(book.ask({ opId: OP, part: { index: 0 }, target: openChat, kind: 'human-draft', draft: humanDraft, formatLoss: false }));
    // The person went to chat B and answered there: no write, no new question about B's draft.
    expect(book.answer(asked.confirmationId, 'replace', onPreview)).toEqual({ kind: 'chat-changed', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(book.pendingFor(OP)).toBeNull();
    expect(book.answer(asked.confirmationId, 'replace', humanDraft)).toEqual({ kind: 'unknown' });
  });
});

describe('[AI-125] insert guards and intents', () => {
  const guard = (over: Partial<InsertGuardInput['host']> = {}, current: Partial<InsertGuardInput['current']> = {}): ReturnType<typeof insertGuard> =>
    insertGuard({
      op: { target, personaDefinitionId: 'pdef_0123456789abcdef', signInEpoch: 3 },
      current: { signInEpoch: 3, bindingRevision: target.binding.bindingRevision, personaDefinitionId: 'pdef_0123456789abcdef', ...current },
      host: { route: startSnapshot.route, composer: startSnapshot.composer, identity: startSnapshot.identity, ...over },
    });

  it('[AI-125] the open chat of the operation, its ready composer: insert may be built', () => {
    expect(guard()).toBeNull();
  });

  it('[AI-125] [AU-023] [AU-024] [AU-028] a chat switch, another account, a missing or hidden composer, a changed sign-in, binding or persona refuse before the host', () => {
    const otherChat = { ...openChat, platformFanId: '2099' };
    expect(guard({ route: { ...startSnapshot.route, chat: otherChat } })).toBe('CG-INSERT-CHAT-CHANGED');
    expect(guard({ route: { ...startSnapshot.route, name: 'other' } })).toBe('CG-INSERT-CHAT-CHANGED');
    expect(guard({ identity: null })).toBe('CG-INSERT-CHAT-CHANGED');
    expect(guard({ identity: { ...identity, platformAccountId: '9999' } })).toBe('CG-CONTEXT-CHANGED');
    expect(guard({ composer: null })).toBe('CG-HOST-COMPOSER-MISSING');
    expect(guard({ composer: startSnapshot.composer === null ? null : { ...startSnapshot.composer, ready: false } })).toBe('CG-HOST-COMPOSER-MISSING');
    expect(guard({ composer: startSnapshot.composer === null ? null : { ...startSnapshot.composer, instanceId: 'composer-9' } })).toBe('CG-HOST-COMPOSER-MISSING');
    expect(guard({ composer: startSnapshot.composer === null ? null : { ...startSnapshot.composer, hidden: true } })).toBe('CG-GATE-FAN-BLOCKED');
    expect(guard({}, { signInEpoch: 4 })).toBe('CG-CONTEXT-CHANGED');
    expect(guard({}, { bindingRevision: 99 })).toBe('CG-CONTEXT-CHANGED');
    expect(guard({}, { personaDefinitionId: null })).toBe('CG-CONTEXT-CHANGED');
  });

  it('[AI-125] the open intent carries the CAS of the read draft and passes the host fake', async () => {
    const built = buildOpenInsert({ intentId: uuid(0x700), operationId: OP, part: { index: 0 }, text: 'Hi there', mode: 'replace', target: openChat, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.intent.expected).toEqual({ kind: 'open', documentEpoch: identity.documentEpoch, routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: emptyDraft.revision, draftDigest: emptyDraft.digest });
    expect(InsertIntentSchema.safeParse(built.intent).success).toBe(true);
    const scenario = HOST_SCENARIOS.find((s) => s.name === 'insert-outcomes');
    if (scenario === undefined) throw new Error('scenario missing');
    const host = new FakeHostPort(scenario.script, HOST_T0);
    expect(await host.insert(built.intent)).toMatchObject({ state: 'applied' });
    expect(host.calls.inserts).toHaveLength(1);
  });

  it('[AI-125] a draft read on chat B for an operation of chat A never becomes an intent; the intent targets the operation\'s chat', () => {
    const onPreview = draftAt(4, {}, { chat: previewChat, routeEpoch: 6 });
    expect(buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: onPreview, confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-INSERT-CHAT-CHANGED' });
    expect(buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: draftAt(4, {}, { chat: null }), confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-INSERT-CHAT-CHANGED' });
    const other = { ...openChat, hostAccountId: '1002' };
    expect(buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: other, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-INSERT-CHAT-CHANGED' });
    const built = buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 });
    expect(built.ok && built.intent.target).toEqual(openChat);
  });

  it('[AI-125] no composer or an unusable text never becomes an intent', () => {
    expect(buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: draftAt(1, {}, { composerInstanceId: null }), confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-HOST-COMPOSER-MISSING' });
    expect(buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: '', mode: 'replace', target: openChat, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-INSERT-FAILED' });
    expect(buildOpenInsert({ intentId: 'bad', operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 })).toEqual({ ok: false, code: 'CG-INSERT-FAILED' });
  });

  it('[AI-125] property A→B→A: an intent built on route A is dead after the route went to B and came back to A', () => {
    const rnd = seeded(125);
    const built = buildOpenInsert({ intentId: uuid(1), operationId: OP, part: { index: 0 }, text: 'x', mode: 'replace', target: openChat, draft: emptyDraft, confirmationId: null, cause: hostCause, now: HOST_T0 });
    if (!built.ok) throw new Error('intent');
    expect(intentMatchesHost(built.intent, identity)).toBe(true);
    for (let run = 0; run < 200; run += 1) {
      // A walk of route changes: every change of this document grows the route epoch, whatever the chat.
      let epoch = identity.routeEpoch;
      const visited: HostIdentity[] = [];
      const hops = 1 + rnd.int(6);
      for (let hop = 0; hop < hops; hop += 1) {
        epoch += 1;
        visited.push({ ...identity, routeEpoch: epoch, chat: rnd.chance(0.5) ? openChat : previewChat });
      }
      epoch += 1;
      visited.push({ ...identity, routeEpoch: epoch, chat: openChat });
      for (const seen of visited) expect(intentMatchesHost(built.intent, seen)).toBe(false);
    }
    expect(intentMatchesHost(built.intent, null)).toBe(false);
    expect(intentMatchesHost(built.intent, { ...identity, composerInstanceId: 'composer-2' })).toBe(false);
    expect(intentMatchesHost(built.intent, { ...identity, documentEpoch: 'doc-host-2' })).toBe(false);
  });
});

describe('[AI-125] Fix «Заменить мой черновик» and «Вернуть мой текст»', () => {
  const source = { revision: humanDraft.revision, digest: humanDraft.digest, text: humanDraft.plainText };
  const ids = { intentId: uuid(0x800), confirmationId: uuid(0x801) };
  const applied = (revision: number): InsertReceipt => ({ state: 'applied', draftRevision: revision, draftDigest: `feedbeef${revision.toString(16).padStart(8, '0')}`, ms: 5 });

  it('[AI-125] the replace click is the consent for the source revision', () => {
    const fix = new FixSession(OP, { index: 0 }, openChat, source, true);
    const step = fix.replace(humanDraft, 'Better words', ids, hostCause, HOST_T0);
    expect(step.kind).toBe('intent');
    if (step.kind === 'intent') {
      expect(step.intent.confirmationId).toBe(ids.confirmationId);
      expect(step.intent.expected).toMatchObject({ draftRevision: humanDraft.revision, draftDigest: humanDraft.digest });
      expect(step.intent.mode).toBe('replace');
    }
  });

  it('[AI-125] a draft changed during the generation voids the consent: ask again', () => {
    const fix = new FixSession(OP, { index: 0 }, openChat, source, true);
    expect(fix.replace({ ...humanDraft, revision: humanDraft.revision + 1 }, 'Better', ids, hostCause, HOST_T0)).toEqual({ kind: 'confirm', reason: 'draft-changed' });
    expect(new FixSession(OP, { index: 0 }, openChat, source, false).replace(humanDraft, 'Better', ids, hostCause, HOST_T0)).toEqual({ kind: 'unavailable', code: 'CG-HOST-NOT-READY' });
  });

  it('[AI-125] «Вернуть мой текст» for 30 s with a CAS on the replacement revision; typed after → a question, not a silent restore', () => {
    const fix = new FixSession(OP, { index: 0 }, openChat, source, true);
    expect(fix.restore(humanDraft, uuid(1), hostCause, HOST_T0)).toEqual({ kind: 'unavailable', code: 'CG-INSERT-FAILED' });
    fix.onReplaced({ state: 'rejected', code: 'CG-DRAFT-CHANGED' }, HOST_T0);
    expect(fix.wasReplaced).toBe(false);
    fix.onReplaced(applied(10), HOST_T0);
    expect(fix.wasReplaced).toBe(true);
    expect(fix.replace(draftAt(10), 'again', ids, hostCause, HOST_T0)).toEqual({ kind: 'unavailable', code: 'CG-INSERT-FAILED' });
    expect(fix.restoreUntil(HOST_T0 + 1000)).toBe(HOST_T0 + FIX_RESTORE_WINDOW_MS);
    expect(fix.restore(draftAt(12), uuid(2), hostCause, HOST_T0 + 1000)).toEqual({ kind: 'confirm', reason: 'draft-changed' });
    const step = fix.restore(draftAt(10, { provenance: 'our-insert' }), uuid(3), hostCause, HOST_T0 + 1000);
    expect(step.kind).toBe('intent');
    if (step.kind === 'intent') {
      expect(step.intent.text).toBe(source.text);
      expect(step.intent.confirmationId).toBeNull();
      expect(step.intent.expected).toMatchObject({ draftRevision: 10 });
    }
    fix.onRestored(applied(11));
    expect(fix.restoreUntil(HOST_T0 + 2000)).toBeNull();
    expect(fix.restore(draftAt(11), uuid(4), hostCause, HOST_T0 + 2000)).toEqual({ kind: 'unavailable', code: 'CG-INSERT-FAILED' });
  });

  it('[AI-125] Fix writes only into its operation\'s chat: a draft of another chat refuses replace and restore', () => {
    const onPreview = { ...humanDraft, identity: { ...humanDraft.identity, chat: previewChat, routeEpoch: 6 } };
    const fix = new FixSession(OP, { index: 0 }, openChat, source, true);
    expect(fix.replace(onPreview, 'Better', ids, hostCause, HOST_T0)).toEqual({ kind: 'unavailable', code: 'CG-INSERT-CHAT-CHANGED' });
    fix.onReplaced(applied(10), HOST_T0);
    expect(fix.restore({ ...draftAt(10), identity: onPreview.identity }, uuid(6), hostCause, HOST_T0 + 1000)).toEqual({ kind: 'unavailable', code: 'CG-INSERT-CHAT-CHANGED' });
  });
});

describe('[UI-029] [NEW-01] [NF-011] «Открыть и вставить»: only on a click, with a deadline and cancel', () => {
  const insert = (n: number, expiresAt = HOST_T0 + 20_000): DeferredInsert => ({ navigationId: uuid(n), insertIntentId: uuid(n + 1), opId: OP, part: { index: 0 }, chat: previewChat, expiresAt });

  it('[NEW-01] the deferred insert replaces only an empty or our draft, carries no consent and rides one navigation', async () => {
    const wire = buildDeferredInsert({ intentId: uuid(0x900), operationId: OP, part: { index: 0 }, target: previewChat, text: 'Hey', documentEpoch: identity.documentEpoch, now: HOST_T0, timeoutMs: 20_000 });
    expect(wire.ok).toBe(true);
    if (!wire.ok) return;
    expect(wire.intent).toMatchObject({ expected: { kind: 'deferred' }, mode: 'replace', confirmationId: null, expiresAt: HOST_T0 + 20_000 });
    const nav = buildOpenAndInsert({ intentId: uuid(0x901), cause: hostCause, insert: wire.intent });
    expect(nav.ok).toBe(true);
    if (!nav.ok) return;
    expect(nav.intent.target).toEqual({ hostAccountId: previewChat.hostAccountId, platformFanId: previewChat.platformFanId });
    const scenario = HOST_SCENARIOS.find((s) => s.name === 'open-and-insert');
    if (scenario === undefined) throw new Error('scenario missing');
    const host = new FakeHostPort(scenario.script, HOST_T0);
    const receipt = await host.navigate(nav.intent);
    const slot = new DeferredInsertSlot();
    slot.begin({ navigationId: nav.intent.intentId, insertIntentId: wire.intent.intentId, opId: OP, part: { index: 0 }, chat: previewChat, expiresAt: wire.intent.expiresAt });
    expect(slot.settle(nav.intent.intentId, receipt)).toMatchObject({ kind: 'inserted', draftRevision: 1 });
    expect(buildDeferredInsert({ intentId: 'bad', operationId: OP, part: { index: 0 }, target: previewChat, text: 'Hey', documentEpoch: 'doc', now: HOST_T0, timeoutMs: 1 }).ok).toBe(false);
  });

  it('[UI-029] nothing inserts by itself: a slot only settles what a click started, a late receipt of a replaced one is ignored', () => {
    const slot = new DeferredInsertSlot();
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 6, insert: { state: 'applied', draftRevision: 1, draftDigest: 'feedbeef00000101', ms: 3 } })).toBeNull();
    expect(slot.begin(insert(1))).toBeNull();
    expect(slot.begin(insert(3))).toMatchObject({ kind: 'canceled', code: 'CG-INSERT-CANCELED', reason: 'other-insert' });
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 6, insert: null })).toBeNull();
    expect(slot.pending()?.navigationId).toBe(uuid(3));
  });

  it('[NEW-01] cancel reasons and the deadline end in their codes; the generation is kept', () => {
    const slot = new DeferredInsertSlot();
    for (const reason of ['human-navigation', 'preview-closed', 'session', 'persona', 'ambiguous-composer'] as const) {
      slot.begin(insert(1));
      expect(slot.cancel(reason)).toMatchObject({ kind: 'canceled', code: 'CG-INSERT-CANCELED', reason });
    }
    expect(slot.cancel('session')).toBeNull();
    slot.begin(insert(1, HOST_T0 + 100));
    expect(slot.expire(HOST_T0 + 99)).toBeNull();
    expect(slot.expire(HOST_T0 + 100)).toMatchObject({ kind: 'canceled', code: 'CG-NAV-TIMEOUT', reason: 'expired' });
    expect(slot.expire(HOST_T0 + 200)).toBeNull();
  });

  it('[NF-011] human draft after the navigation → consent; failures and uncertain never retry', () => {
    const slot = new DeferredInsertSlot();
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 7, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } })).toMatchObject({ kind: 'needs-confirm' });
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } })).toMatchObject({ kind: 'failed', uncertain: true, code: 'CG-NAV-TIMEOUT' });
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'failed', code: 'CG-NAV-FAILED', insert: null })).toMatchObject({ kind: 'failed', uncertain: false });
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 7, insert: null })).toMatchObject({ kind: 'failed', code: 'CG-INSERT-FAILED' });
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 7, insert: { state: 'rejected', code: 'CG-INSERT-FAILED' } })).toMatchObject({ kind: 'failed', uncertain: false });
    slot.begin(insert(1));
    expect(slot.settle(uuid(1), { state: 'navigated', routeEpoch: 7, insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } })).toMatchObject({ kind: 'failed', uncertain: true });
  });
});

describe('[AI-125] receipts and [LG-017] the insert journal', () => {
  it('[AI-125] applied → inserted; consent needed; refused; uncertain and the P1 misplaced', () => {
    expect(interpretInsertReceipt({ state: 'applied', draftRevision: 5, draftDigest: 'feedbeef00000005', ms: 7 })).toEqual({ kind: 'applied', telemetry: 'inserted', ours: { revision: 5, digest: 'feedbeef00000005' }, ms: 7 });
    expect(interpretInsertReceipt({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' })).toEqual({ kind: 'needs-confirm', reason: 'human-draft' });
    expect(interpretInsertReceipt({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' })).toEqual({ kind: 'needs-confirm', reason: 'draft-changed' });
    expect(interpretInsertReceipt({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' })).toEqual({ kind: 'refused', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(interpretInsertReceipt({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' })).toEqual({ kind: 'uncertain', code: 'CG-INSERT-UNCERTAIN', p1: false });
    expect(interpretInsertReceipt({ state: 'uncertain', code: 'CG-INSERT-MISPLACED' })).toEqual({ kind: 'uncertain', code: 'CG-INSERT-MISPLACED', p1: true });
  });

  it('[LG-017] route changes, intents, receipts and refusals are journaled without any text', () => {
    const secret = 'my private words';
    const built = buildOpenInsert({ intentId: uuid(0x700), operationId: OP, part: { index: 1 }, text: secret, mode: 'append', target: openChat, draft: humanDraft, confirmationId: uuid(0x701), cause: hostCause, now: HOST_T0 });
    if (!built.ok) throw new Error('intent');
    const deferred = buildDeferredInsert({ intentId: uuid(0x702), operationId: OP, part: { index: 0 }, target: previewChat, text: secret, documentEpoch: identity.documentEpoch, now: HOST_T0, timeoutMs: 20_000 });
    if (!deferred.ok) throw new Error('deferred');
    const entries = [
      routeChangeEntry(startSnapshot.route, uuid(0xa1)),
      routeChangeEntry({ epoch: 6, name: 'other', account: hostAccount, chat: null }),
      insertIntentEntry(built.intent),
      insertIntentEntry(deferred.intent),
      insertReceiptEntry(built.intent, { state: 'applied', draftRevision: 10, draftDigest: 'feedbeef0000000a', ms: 9 }),
      insertReceiptEntry(built.intent, { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' }),
      insertReceiptEntry(built.intent, { state: 'uncertain', code: 'CG-INSERT-MISPLACED' }),
      insertReceiptEntry(built.intent, { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' }),
      insertGuardEntry(OP, 'CG-INSERT-CHAT-CHANGED', 6),
      insertGuardEntry(OP, 'CG-CONTEXT-CHANGED', null),
    ];
    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toContain(secret);
      expect(LogRecordSchema.safeParse({ ts: '2026-10-03T10:00:00.000Z', seq: 1, ...entry }).success).toBe(true);
    }
    expect(entries[2]?.fields).toMatchObject({ textLength: secret.length, consent: true, mode: 'append', draftRevision: humanDraft.revision });
    expect(entries[6]?.level).toBe('error');
  });
});
