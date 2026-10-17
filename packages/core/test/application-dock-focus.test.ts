// Which part the dock offers the focus to (decision X44; ui-design §6.3,
// §6.4; UI-023): the decision alone, over view models — what reaches the UI
// as `DockVM.focusPart`. The dock controller's own wiring is in
// application-dock.test.ts («the focus handed to the next part»).

import { describe, expect, it } from 'vitest';

import { type ComposerState, type DraftProvenance, type PartVM, type ResultVM } from '@cg/contracts';
import { createPartFocus } from '@cg/core/application/ai';
import { cgError, ctxOf, parts, reason, result, uuid, variants } from '@cg/testing/app-client';
import { openChat } from '@cg/testing/host';

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const OP = uuid(301);
const TEXTS = ['one', 'two'];

const reply = (patch: Partial<ResultVM> = {}, partPatch: (index: number) => Partial<PartVM> = () => ({})): ResultVM =>
  result(ctx, { opId: OP, feature: 'reply', state: 'done', parts: parts(OP, TEXTS, partPatch), splitRequested: true, ...patch });
/** Part `done` is inserted, the one after it is next — as the controller draws them. */
const afterInsert = (done: number): ResultVM =>
  reply({}, (index) => (index <= done ? { insert: 'done', collapsed: true, next: false } : { next: index === done + 1 }));
const composer = (provenance: DraftProvenance, patch: Partial<ComposerState> = {}): ComposerState => ({ chat: openChat, instanceId: 'composer-1', ready: true, hidden: false, draft: { revision: 1, provenance }, ...patch });

describe('the part the dock offers the focus to (X44)', () => {
  it('[UI-023] a finished Reply over an empty composer offers its next part — by operation and index', () => {
    const focus = createPartFocus();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 0 });
    // Asked again with nothing changed, it is the same part: the UI moves the focus once per part.
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 0 });
  });

  it('[UI-023] the person is typing: text of theirs in the composer offers nothing — not even once they cleared it', () => {
    const focus = createPartFocus();
    expect(focus.next(reply(), 'insert', composer('human-or-unknown'), true)).toBeNull();
    // They were writing their own message, not waiting for the answer: an emptied field does not pull them away.
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toBeNull();
    // Nor a send of their own text: only our insert, sent, offers the next part.
    expect(focus.next(reply(), 'insert', composer('human-or-unknown'), true)).toBeNull();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toBeNull();
  });

  it('[UI-023] offered over the empty composer, withdrawn for good once the person types there instead', () => {
    const focus = createPartFocus();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 0 });
    expect(focus.next(reply(), 'insert', composer('human-or-unknown'), true)).toBeNull();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toBeNull();
  });

  it('nothing is judged before the composer of the chat can be read; then an empty one arms the answer', () => {
    const focus = createPartFocus();
    expect(focus.next(reply(), 'insert', composer('empty', { ready: false }), true)).toBeNull();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 0 });
  });

  it('[UI-023] after an insert the next part waits for the send: offered only once the composer held the text and is empty again', () => {
    const focus = createPartFocus();
    expect(focus.next(reply(), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 0 });
    // The receipt came before the composer's own report of the write: the field still reads empty — nothing yet.
    expect(focus.next(afterInsert(0), 'insert', composer('empty'), true)).toBeNull();
    // The part is in the field.
    expect(focus.next(afterInsert(0), 'insert', composer('our-insert'), true)).toBeNull();
    // The person sent it: the field is empty, the second part is offered.
    expect(focus.next(afterInsert(0), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 1 });
    // The last part sent too: nothing is left to offer.
    expect(focus.next(afterInsert(1), 'insert', composer('our-insert'), true)).toBeNull();
    expect(focus.next(afterInsert(1), 'insert', composer('empty'), true)).toBeNull();
  });

  it('[UI-023] a part the person changed before sending, or their own text after the offer, offers nothing more', () => {
    const edited = createPartFocus();
    edited.next(reply(), 'insert', composer('empty'), true);
    expect(edited.next(afterInsert(0), 'insert', composer('our-insert'), true)).toBeNull();
    // They added a word to our part (or the neighbour's guard wrote it back changed), then sent or cleared it.
    expect(edited.next(afterInsert(0), 'insert', composer('human-or-unknown'), true)).toBeNull();
    expect(edited.next(afterInsert(0), 'insert', composer('empty'), true)).toBeNull();

    const own = createPartFocus();
    own.next(reply(), 'insert', composer('empty'), true);
    own.next(afterInsert(0), 'insert', composer('our-insert'), true);
    expect(own.next(afterInsert(0), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 1 });
    // The person writes a line of their own instead, and sends it: part 2 is not pushed at them.
    expect(own.next(afterInsert(0), 'insert', composer('human-or-unknown'), true)).toBeNull();
    expect(own.next(afterInsert(0), 'insert', composer('empty'), true)).toBeNull();
  });

  it('[UI-023] the composer\'s report may come first: our insert seen while the part was still on its way counts once the receipt is in', () => {
    const focus = createPartFocus();
    focus.next(reply(), 'insert', composer('empty'), true);
    expect(focus.next(reply({}, (index) => (index === 0 ? { insert: 'pending', next: true } : {})), 'insert', composer('our-insert'), true)).toBeNull();
    expect(focus.next(afterInsert(0), 'insert', composer('our-insert'), true)).toBeNull();
    expect(focus.next(afterInsert(0), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 1 });
  });

  it('a result with parts inserted before this dock watched it waits for a send too', () => {
    const focus = createPartFocus();
    expect(focus.next(afterInsert(0), 'insert', composer('empty'), true)).toBeNull();
    expect(focus.next(afterInsert(0), 'insert', composer('our-insert'), true)).toBeNull();
    expect(focus.next(afterInsert(0), 'insert', composer('empty'), true)).toEqual({ opId: OP, part: 1 });
  });

  it('Ping and a Hi of one variant are offered; Fix, three Hi variants and a board\'s result are not', () => {
    const offer = (vm: ResultVM): unknown => createPartFocus().next(vm, 'insert', composer('empty'), true);
    expect(offer(reply({ feature: 'ping' }))).toEqual({ opId: OP, part: 0 });
    expect(offer(reply({ feature: 'hi' }))).toEqual({ opId: OP, part: 0 });
    expect(offer(reply({ feature: 'hi', parts: null, variants: variants(OP, [['a'], ['b'], ['c']]) }))).toBeNull();
    expect(offer(reply({ feature: 'fix', parts: parts(OP, ['better']) }))).toBeNull();
    expect(offer(reply({ fix: { sourceDraft: 'mine', canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false } }))).toBeNull();
    expect(offer(reply({ surface: 'preview' }))).toBeNull();
    expect(offer(reply({ surface: 'newcomers' }))).toBeNull();
  });

  it('nothing while the answer cannot be inserted by Enter: running, copy-only, unparsed, a Б2 question, expanded, blocked or on its way', () => {
    const offer = (vm: ResultVM, mode: 'insert' | 'copy-only' = 'insert'): unknown => createPartFocus().next(vm, mode, composer('empty'), true);
    expect(offer(reply({ state: 'streaming', parts: null }))).toBeNull();
    expect(offer(reply(), 'copy-only')).toBeNull();
    expect(offer(reply({ unparsed: true }))).toBeNull();
    expect(offer(reply({ confirm: { confirmationId: uuid(302), kind: 'human-draft', part: { index: 0 }, formatLoss: false } }))).toBeNull();
    expect(offer(reply({ expanded: true }))).toBeNull();
    expect(offer(reply({}, (index) => (index === 0 ? { insertBlocked: reason('language') } : {})))).toBeNull();
    expect(offer(reply({}, (index) => (index === 0 ? { insert: 'pending' } : {})))).toBeNull();
    // A failed insert stays next: «Вставить ↵» is its retry, and Enter on it is the person's own.
    expect(offer(reply({}, (index) => (index === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') } : {})))).toEqual({ opId: OP, part: 0 });
  });

  it('nothing without a composer of this chat that is ready and shown', () => {
    const offer = (field: ComposerState | null, sameChat = true): unknown => createPartFocus().next(reply(), 'insert', field, sameChat);
    expect(offer(null)).toBeNull();
    expect(offer(composer('empty'), false)).toBeNull();
    expect(offer(composer('empty', { ready: false }))).toBeNull();
    expect(offer(composer('empty', { hidden: true }))).toBeNull();
    expect(createPartFocus().next(null, 'insert', composer('empty'), true)).toBeNull();
  });

  it('another answer starts afresh: its first part is offered over an empty composer', () => {
    const focus = createPartFocus();
    focus.next(afterInsert(0), 'insert', composer('empty'), true);
    const other = uuid(303);
    expect(focus.next(result(ctx, { opId: other, feature: 'reply', state: 'done', parts: parts(other, ['x']) }), 'insert', composer('empty'), true)).toEqual({ opId: other, part: 0 });
  });
});
