// The insert into Fansly's field (R20 P7e; docs/project-unite/architecture.md §7.5; FS-INS-1…3; UI-021): the port
// over a scripted MAIN on a Fansly-like page (testing/port-world.ts), with Firefox's `insertText` stood in for — and
// its ways of going wrong. The browser's own run is suite-fansly-insert.e2e.ts.

import { InsertReceiptSchema, SentDraftSchema, type InsertReceipt } from '@cg/contracts/host';
import { FANSLY_IDS } from '@cg/contracts/fixtures';
import { digest, normalize } from '@cg/host-kit/common/digest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editorCalls, installEditor, setEditor, settle, startWorld, until, type World } from '../testing/port-world';

const { creator: CREATOR, fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const OTHER_FAN = '700000000000000005';
const FANS = { [GROUP]: FAN, [OTHER]: OTHER_FAN };

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});
beforeEach(() => {
  cleanups.push(installEditor());
});

/** The port on chat A, MAIN having named its fan. */
async function onChat(groupId: string = GROUP, options: { readonly copyOnly?: readonly string[] } = {}): Promise<World> {
  const world = await startWorld(`/messages/${groupId}`, { fans: FANS, ...options });
  cleanups.push(() => world.dispose());
  world.page.openChat(groupId);
  await until('MAIN names the fan', () => world.port.current().composer !== null);
  return world;
}

const field = (world: World): HTMLTextAreaElement => {
  const element = world.page.textarea();
  if (element === null) throw new Error('no field');
  return element;
};

/** A person types: the value, then a trusted-like `input` (what Firefox sends on a key). */
const type = (element: HTMLTextAreaElement, text: string): void => {
  element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  element.value += text;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
};

/** FBuddy's write (S5 §2.6): the native setter, then an untrusted `input` and `change`. */
const neighbourWrites = (element: HTMLTextAreaElement, value: string): void => {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

const parsed = (receipt: InsertReceipt): InsertReceipt => InsertReceiptSchema.parse(receipt);

describe('the insert into Fansly’s field (FS-INS-1, FS-INS-2, UI-021)', () => {
  it('[UI-019] [UI-021] [RB-009] into an empty field: the editor command, one write; the field focused, the caret after the text; the draft is our own insert', async () => {
    const world = await onChat();
    const element = field(world);
    const intent = await world.intent('Привет!\r\nКак дела?');
    const receipt = parsed(await world.port.insert(intent));
    expect(receipt).toMatchObject({ state: 'applied', draftDigest: digest('Привет!\nКак дела?') });
    expect(element.value).toBe('Привет!\nКак дела?');
    expect(editorCalls).toEqual(['Привет!\nКак дела?']);
    expect(document.activeElement).toBe(element);
    expect([element.selectionStart, element.selectionEnd]).toEqual([element.value.length, element.value.length]);
    expect(world.redeemed).toEqual(['insert']);
    const draft = await world.draft();
    expect(draft).toMatchObject({ plainText: 'Привет!\nКак дела?', provenance: 'our-insert' });
    expect(receipt.state === 'applied' && receipt.draftRevision).toBe(draft.revision);
    expect(world.port.current().composer?.draft.provenance).toBe('our-insert');
    // A second part of the same result replaces our own unchanged insert without asking (Б2 asks only for the person's text).
    expect(await world.port.insert(await world.intent('Второй вариант'))).toMatchObject({ state: 'applied' });
    expect(element.value).toBe('Второй вариант');
  });

  it('[UI-021] [FS-INS-2] [ER-074] no editor command: the fallback — the value and an input — only because the field provably did not change; a field that keeps refusing is «Текст не вставился»', async () => {
    const world = await onChat();
    const element = field(world);
    for (const mode of ['noop', 'throws'] as const) {
      setEditor(mode);
      element.value = '';
      element.dispatchEvent(new Event('input'));
      const receipt = parsed(await world.port.insert(await world.intent(`fallback ${mode}`)));
      expect(receipt).toMatchObject({ state: 'applied' });
      expect(element.value).toBe(`fallback ${mode}`);
      expect(world.diagnostics.filter((d) => d.event === 'insert').at(-1)).toMatchObject({ detail: { state: 'applied', path: 'fallback' } });
    }
    // The field takes no value at all (the page froze it): nothing was written — a new click may try again.
    setEditor('noop');
    element.value = '';
    element.dispatchEvent(new Event('input'));
    Object.defineProperty(element, 'value', { configurable: true, get: () => '', set: () => undefined });
    const refused = parsed(await world.port.insert(await world.intent('never there')));
    expect(refused).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    Reflect.deleteProperty(element, 'value');
  });

  it('[FS-INS-2] [UI-026] half of it written, or written with no event: `uncertain` — never written again, no fallback over it', async () => {
    const world = await onChat();
    const element = field(world);
    setEditor('partial');
    expect(parsed(await world.port.insert(await world.intent('abcdef')))).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(element.value).toBe('abc');
    expect(editorCalls).toEqual(['abcdef']);
    setEditor('silent');
    element.value = '';
    element.dispatchEvent(new Event('input'));
    // The text is in the field, but the page's model never heard of it: a send would carry another text.
    expect(parsed(await world.port.insert(await world.intent('quiet')))).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(editorCalls).toEqual(['abcdef', 'quiet']);
  });
});

describe('the person’s draft (FS-INS-3, Б2)', () => {
  it('[NEW-05] [UI-020] a typed draft needs one-time consent for its revision; append keeps it, replace replaces it; a consent writes once', async () => {
    const world = await onChat();
    const element = field(world);
    type(element, 'my words');
    expect((await world.draft()).provenance).toBe('human-or-unknown');
    expect(await world.port.insert(await world.intent('AI text'))).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
    expect(element.value).toBe('my words');
    const append = await world.intent('appended', { mode: 'append', confirm: true });
    expect(await world.port.insert(append)).toMatchObject({ state: 'applied' });
    expect(element.value).toBe('my words\nappended');
    // The person's words are still there: a plain insert asks again.
    expect((await world.draft()).provenance).toBe('human-or-unknown');
    expect(await world.port.insert(await world.intent('replaced'))).toMatchObject({ needs: 'confirm-human-draft' });
    // The same consent once more is no consent.
    const again = await world.intent('replaced', { confirm: true });
    expect(await world.port.insert(again)).toMatchObject({ state: 'applied' });
    expect(element.value).toBe('replaced');
    type(element, '!');
    expect(await world.port.insert({ ...(await world.intent('third')), confirmationId: again.confirmationId })).toMatchObject({ needs: 'confirm-human-draft' });
    expect(element.value).toBe('replaced!');
  });

  it('[AI-022] the person types between the read and the write: the old revision is refused — the question is asked about the draft as it is now', async () => {
    const world = await onChat();
    const element = field(world);
    type(element, 'hel');
    const stale = await world.draft();
    type(element, 'lo');
    expect(await world.port.insert(await world.intent('x', { from: stale, confirm: true }))).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
    expect(element.value).toBe('hello');
    // And the neighbour's write between the read and the write (its untrusted `input`): the same.
    const read = await world.draft();
    neighbourWrites(element, 'hello 💕');
    expect(await world.port.insert(await world.intent('x', { from: read, confirm: true }))).toMatchObject({ needs: 'confirm-changed-draft' });
    expect(element.value).toBe('hello 💕');
  });

  it('a restored draft: the page writes its cached text into a new field a microtask later, with no event — the digest catches a read from before it, and the text is the person’s', async () => {
    const world = await onChat();
    world.page.cacheDrafts(true);
    type(field(world), 'kept by the page');
    world.page.openChat(OTHER);
    await until('chat B', () => world.port.current().route.chat?.platformFanId === OTHER_FAN && world.port.current().composer !== null);
    world.page.openChat(GROUP);
    // The new field of A, empty for a moment: a read taken now…
    await until('chat A again', () => world.port.current().route.chat?.platformFanId === FAN && world.port.current().composer !== null);
    const element = field(world);
    expect(element.value).toBe('kept by the page');
    expect((await world.draft()).provenance).toBe('human-or-unknown');
    expect(await world.port.insert(await world.intent('over it'))).toMatchObject({ needs: 'confirm-human-draft' });
    // …and the restore landing between a read and the write.
    element.value = '';
    element.dispatchEvent(new Event('input'));
    const empty = await world.draft();
    element.value = 'restored late';
    expect(await world.port.insert(await world.intent('x', { from: empty }))).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
    expect(element.value).toBe('restored late');
  });

  it('IME: while a composition runs nothing is written (Angular does not update its model then); after it ends, the insert goes', async () => {
    const world = await onChat();
    const element = field(world);
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    element.value = 'に';
    const intent = await world.intent('AI', { confirm: true });
    expect(await world.port.insert(intent)).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
    expect(element.value).toBe('に');
    expect(editorCalls).toEqual([]);
    element.dispatchEvent(new CompositionEvent('compositionend', { data: 'に' }));
    element.dispatchEvent(new Event('input'));
    expect(await world.port.insert(await world.intent('AI', { confirm: true }))).toMatchObject({ state: 'applied' });
    expect(element.value).toBe('AI');
  });

  it('the neighbour writes before ours (a template): the field is the person’s; right after ours, within the check: `uncertain`; after the receipt: ours stands, edited', async () => {
    const world = await onChat();
    const element = field(world);
    neighbourWrites(element, 'Hey babe 💕');
    expect(await world.port.insert(await world.intent('AI'))).toMatchObject({ needs: 'confirm-human-draft' });
    element.value = '';
    element.dispatchEvent(new Event('input'));
    // Its write lands in the microtask right after our synchronous step, before the page's task is over.
    element.addEventListener('input', () => queueMicrotask(() => neighbourWrites(element, `${element.value} 😘`)), { once: true });
    expect(await world.port.insert(await world.intent('first'))).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(element.value).toBe('first 😘');
    element.value = '';
    element.dispatchEvent(new Event('input'));
    const applied = await world.port.insert(await world.intent('second'));
    expect(applied).toMatchObject({ state: 'applied' });
    neighbourWrites(element, 'second 😘');
    // The draft still descends from our insert — edited since (P7f reports `sent` with `edited`).
    expect(world.port.sentDraft()).toEqual({ revision: (await world.draft()).revision, provenance: 'human-or-unknown', insertIntentId: world.port.insertion()?.intentId, editedSinceInsert: true });
  });
});

describe('the field this port owns (FS-INS-1 п. 1–2, FS-RTE-4)', () => {
  it('[AI-125] [UI-026] an intent for the chat that was open is refused after a switch — in the field of the new chat nothing is written; expired and unredeemed intents write nothing, and a stale one spends no token', async () => {
    const world = await onChat();
    const prepared = await world.intent('meant for A');
    world.page.openChat(OTHER);
    await until('chat B', () => world.port.current().route.chat?.platformFanId === OTHER_FAN && world.port.current().composer !== null);
    expect(await world.port.insert(prepared)).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(field(world).value).toBe('');
    expect(world.redeemed).toEqual([]);
    expect(await world.port.insert(await world.intent('late', { ttlMs: 1 }).then(async (intent) => (await settle(), intent)))).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    world.allowRedeem(false);
    expect(await world.port.insert(await world.intent('no token'))).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    expect(field(world).value).toBe('');
    expect(editorCalls).toEqual([]);
  });

  it('[AI-125] the address moves first (Fansly’s `popstate`): the old chat’s field still on the page is nobody’s now — an intent read from it, or one for the new chat, writes nothing into it', async () => {
    const world = await onChat();
    const old = field(world);
    const prepared = await world.intent('meant for A');
    history.pushState({}, '', `/messages/${OTHER}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(old.isConnected).toBe(true);
    expect(await world.port.insert(prepared)).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    expect(world.port.current().composer).toBeNull();
    expect(old.value).toBe('');
  });

  it('[AI-125] another creator on the page, the mini-chat’s field, the DM rules unmet: refused, nothing written', async () => {
    const world = await onChat(GROUP, { copyOnly: [OTHER] });
    world.page.miniChat(true);
    const mini = document.querySelector<HTMLTextAreaElement>('app-messaging-overlay textarea');
    mini?.focus();
    expect(await world.port.insert(await world.intent('main field'))).toMatchObject({ state: 'applied' });
    expect(mini?.value).toBe('');
    world.page.openChat(OTHER);
    await until('chat B', () => world.port.current().route.chat?.platformFanId === OTHER_FAN && world.port.current().composer?.hidden === true);
    expect(await world.port.insert(await world.intent('copy only', { confirm: true }))).toEqual({ state: 'rejected', code: 'CG-GATE-FAN-BLOCKED' });
    expect(field(world).value).toBe('');
  });

  it('[RB-014] 200 switches with inserts in flight: not one write lands in a field of a chat it was not aimed at', async () => {
    const world = await onChat();
    const groups: readonly string[] = [GROUP, OTHER];
    const writes: Array<{ readonly group: string; readonly text: string; readonly receipt: Promise<InsertReceipt> }> = [];
    for (let i = 0; i < 200; i += 1) {
      const group = world.port.current().route.conversationRef ?? '';
      const intent = await world.intent(`R${i}@${group}`).catch(() => null);
      const next = groups[(groups.indexOf(group) + 1) % groups.length] as string;
      // Every third time the person switches first and the insert for the chat being left follows at once; otherwise
      // the switch comes a microtask or a task into the insert's way (its schema check, its token).
      if (i % 3 === 0) world.page.openChat(next);
      if (intent !== null) writes.push({ group, text: intent.text, receipt: world.port.insert(intent) });
      if (i % 3 === 1) await Promise.resolve();
      if (i % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
      if (i % 3 !== 0) world.page.openChat(next);
      await until(`switch ${i}`, () => world.port.current().route.conversationRef === next && world.port.current().composer !== null);
    }
    const receipts = await Promise.all(writes.map((write) => write.receipt));
    expect(writes.length).toBe(200);
    // The writes the editor saw: each one's text names the group it was aimed at, and it went into that group's field.
    const states = receipts.map((receipt) => receipt.state);
    expect(states.filter((state) => state === 'applied').length).toBeGreaterThan(0);
    expect(states.filter((state) => state === 'rejected').length).toBeGreaterThan(50);
    expect(receipts.filter((receipt) => receipt.state === 'uncertain')).toEqual([]);
    const applied = writes.filter((_, index) => receipts[index]?.state === 'applied');
    expect(editorCalls).toEqual(applied.map((write) => write.text));
    for (const write of applied) expect(write.text.endsWith(`@${write.group}`)).toBe(true);
  });
});

describe('the record of our insert (§7.5 п. 5, §5.9 п. 7: what P7f links a human send to)', () => {
  it('names the intent, the field and what the write left — the digest of the content as MAIN digests it; the chain ends when the field is emptied or changed with no event', async () => {
    const world = await onChat();
    const element = field(world);
    expect(world.port.insertion()).toBeNull();
    expect(world.port.sentDraft()).toEqual({ revision: 0, provenance: 'empty', insertIntentId: null, editedSinceInsert: null });
    const intent = await world.intent('  Привет, зая  ');
    await world.port.insert(intent);
    const record = world.port.insertion();
    expect(record).toEqual({
      intentId: intent.intentId,
      operationId: intent.operationId,
      part: { index: 0 },
      chat: { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN },
      composerInstanceId: world.identity().composerInstanceId,
      revision: (await world.draft()).revision,
      digest: digest('  Привет, зая  '),
      contentDigest: digest(normalize('  Привет, зая  ')),
      whole: true,
    });
    expect(SentDraftSchema.parse(world.port.sentDraft())).toEqual({ revision: record?.revision, provenance: 'our-insert', insertIntentId: intent.intentId, editedSinceInsert: false });
    type(element, '!');
    expect(world.port.sentDraft()).toMatchObject({ provenance: 'human-or-unknown', insertIntentId: intent.intentId, editedSinceInsert: true });
    // The page clears the field after a send with no event: what is typed next descends from nothing of ours.
    element.value = '';
    type(element, 'new text');
    expect(world.port.insertion()).toBeNull();
    expect(world.port.sentDraft()).toMatchObject({ insertIntentId: null, editedSinceInsert: null });
    // A new field (a chat switch, the branch made anew) ends it too.
    await world.port.insert(await world.intent('again', { confirm: true }));
    expect(world.port.insertion()).not.toBeNull();
    world.page.recreateField();
    await settle();
    expect(world.port.insertion()).toBeNull();
  });

  it('[LG-017] the tab’s log hears of every insert and every refusal — its outcome, its way, its code — and of every chat switch through the route; never a text', async () => {
    const world = await onChat();
    type(field(world), 'secret words');
    await world.port.insert(await world.intent('secret answer'));
    await world.port.insert(await world.intent('secret answer', { confirm: true }));
    world.page.openChat(OTHER);
    await until('chat B', () => world.port.current().route.chat?.platformFanId === OTHER_FAN);
    const inserts = world.diagnostics.filter((diagnostic) => diagnostic.event === 'insert');
    expect(inserts).toEqual([
      { event: 'insert', code: 'CG-DRAFT-CHANGED', detail: { state: 'rejected', path: 'none', mode: 'replace', ms: null, needs: 'confirm-human-draft' } },
      { event: 'insert', detail: { state: 'applied', path: 'exec', mode: 'replace', ms: expect.any(Number) as unknown, needs: null } },
    ]);
    const routes = world.events.filter((event) => event.type === 'route').map((event) => (event.type === 'route' ? event.route.conversationRef : null));
    expect(routes.at(-1)).toBe(OTHER);
    expect(JSON.stringify(world.diagnostics)).not.toMatch(/secret/);
  });
});
