// The person's send linked to our draft on the isolated side (R20 P7f; docs/project-unite/architecture.md §5.9 п. 7,
// §7.5 п. 5, §9.3; FS-SEND-2, TL-004): the port over a scripted MAIN on a Fansly-like page (testing/port-world.ts).
// The draft is read at the person's trusted Enter or Send click, before the page clears the field; MAIN's `fx.sent`
// — stood in for here, its own proof is main/send-gesture.test.ts — is linked to the one reading of its group and
// text, and the port says `humanSend`. Firefox's own gestures and the stand's page are suite-fansly-send-observe's.

import { HumanSendFactSchema, type HostEvent, type HumanSendFact } from '@cg/contracts/host';
import { FANSLY_IDS, fanslyIdentityWire } from '@cg/contracts/fixtures';
import { digest, normalize } from '@cg/host-kit/common/digest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installEditor, settle, startWorld, until, type World } from '../testing/port-world';

const { fan: FAN, group: GROUP, otherGroup: OTHER } = FANSLY_IDS;
const OTHER_FAN = '700000000000000005';
const FANS = { [GROUP]: FAN, [OTHER]: OTHER_FAN };
const MSG = '700000000000000501';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState({}, '', '/');
});
beforeEach(() => {
  cleanups.push(installEditor());
});

async function onChat(groupId: string = GROUP): Promise<World> {
  const world = await startWorld(`/messages/${groupId}`, { fans: FANS });
  cleanups.push(() => world.dispose());
  world.page.openChat(groupId);
  await until('MAIN names the fan', () => world.port.current().composer !== null);
  return world;
}

const fieldOf = (world: World): HTMLTextAreaElement => {
  const element = world.page.textarea();
  if (element === null) throw new Error('no field');
  return element;
};

/** The person's own event: the browser marks it trusted (happy-dom has no such mark: it is stood in for). */
const trusted = <E extends Event>(event: E, isTrusted = true): E => Object.defineProperty(event, 'isTrusted', { value: isTrusted });

/** The person presses Enter in the field; then the page sends its model and clears the field — a microtask, no event. */
async function pressEnter(element: HTMLTextAreaElement, init: KeyboardEventInit = {}, isTrusted = true): Promise<void> {
  element.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }), isTrusted));
  await Promise.resolve();
}
/** The person clicks the field's own Send (the icon inside it). */
function clickSend(element: HTMLTextAreaElement): void {
  const button = element.closest('app-group-message-input')?.querySelector('.send-button');
  if (button === null || button === undefined) throw new Error('no Send');
  const icon = button.appendChild(document.createElement('i'));
  icon.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, cancelable: true })));
}
/** The page clears the field after its send, as Fansly does: no event. */
const cleared = (element: HTMLTextAreaElement): void => void (element.value = '');

/** A person types: the value, then a trusted-like `input`. */
const type = (element: HTMLTextAreaElement, text: string): void => {
  element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  element.value += text;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
};

/** MAIN proved the send: its group, the receipt's id, the digest of the sent text. */
const sent = (world: World, text: string, msgId: string = MSG, groupId: string = GROUP): void => world.main({ t: 'fx.sent', p: { groupId, msgId, contentDigest: digest(normalize(text)) } });
const facts = (world: World): HumanSendFact[] => world.events.filter((event): event is Extract<HostEvent, { type: 'humanSend' }> => event.type === 'humanSend').map((event) => event.fact);
const sendLog = (world: World): unknown[] => world.diagnostics.filter((entry) => entry.event === 'human-send').map((entry) => entry.detail);

describe('[FS-SEND-2] [TL-004] [host:fansly] the person’s send linked to our draft (§5.9 п. 7)', () => {
  it('our insert, the person’s Enter, MAIN’s fx.sent of that text: `humanSend` with our intent, not edited, the receipt’s id — and no text anywhere', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    const text = 'Привет!\nКак  прошёл день?';
    expect(await world.port.insert(await world.intent(text))).toMatchObject({ state: 'applied' });
    const intentId = world.port.insertion()?.intentId;
    await pressEnter(element);
    cleared(element);
    sent(world, ` ${text} `);
    await settle();
    const [fact] = facts(world);
    expect(facts(world)).toHaveLength(1);
    expect(HumanSendFactSchema.parse(fact)).toEqual({
      chat: { host: 'fansly-web', hostAccountId: fanslyIdentityWire.creatorId, platformFanId: FAN },
      pendingId: 'g1',
      platformMessageId: MSG,
      textDigest: digest(normalize(text)),
      draft: { revision: expect.any(Number) as number, provenance: 'our-insert', insertIntentId: intentId, editedSinceInsert: false },
    });
    expect(sendLog(world)).toEqual([{ link: 'linked', ours: true, edited: false }]);
    expect(JSON.stringify([world.events, world.diagnostics])).not.toContain('Привет');
    expect((await world.port.health()).isolated.sends).toEqual({ gestures: 1, linked: 1, unmatched: 0, ambiguous: 0 });
  });

  it('the trusted click on the field’s own Send reads the draft too; edited after our insert — `edited`; the person’s own text — no intent: the tab reports nothing for it', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('AI text'));
    type(element, ' and mine');
    clickSend(element);
    cleared(element);
    sent(world, 'AI text and mine');
    type(element, 'all mine');
    await pressEnter(element);
    cleared(element);
    sent(world, 'all mine', '700000000000000502');
    await settle();
    expect(facts(world).map((fact) => [fact.platformMessageId, fact.draft.provenance, fact.draft.insertIntentId !== null, fact.draft.editedSinceInsert])).toEqual([
      [MSG, 'human-or-unknown', true, true],
      ['700000000000000502', 'human-or-unknown', false, null],
    ]);
    for (const fact of facts(world)) expect(HumanSendFactSchema.safeParse(fact).success).toBe(true);
  });

  it('[UI-033] a text equal to our insert with no gesture — sent from elsewhere, or MAIN’s word with no reading — is no send of ours: no `humanSend`', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('Same words'));
    sent(world, 'Same words');
    // Not the person's gesture: a script's Enter, Shift+Enter, Enter inside an IME composition, another key.
    await pressEnter(element, {}, false);
    await pressEnter(element, { shiftKey: true });
    await pressEnter(element, { isComposing: true });
    element.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
    sent(world, 'Same words', '700000000000000503');
    await settle();
    expect(facts(world)).toEqual([]);
    expect(sendLog(world)).toEqual([
      { link: 'unmatched', ours: null, edited: null },
      { link: 'unmatched', ours: null, edited: null },
    ]);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 0, linked: 0, unmatched: 2 });
  });

  it('the link is by group and text: another chat’s send, or a text changed between the gesture and the send, is not linked; an empty field is no reading', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await pressEnter(element);
    await world.port.insert(await world.intent('Ours'));
    await pressEnter(element);
    sent(world, 'Ours', MSG, OTHER);
    sent(world, 'Ours, changed', '700000000000000504');
    await settle();
    expect(facts(world)).toEqual([]);
    sent(world, 'Ours', '700000000000000505');
    await settle();
    expect(facts(world).map((fact) => fact.platformMessageId)).toEqual(['700000000000000505']);
    expect((await world.port.health()).isolated.sends).toEqual({ gestures: 2, linked: 1, unmatched: 2, ambiguous: 0 });
  });

  it('[FS-SEND-2] a send the neighbour swallowed — no fx.sent —, the text written back and pressed again: the reading of the same draft replaces the first; the person’s fix of the text is linked as edited', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('this is forbidden'));
    const intentId = world.port.insertion()?.intentId;
    await pressEnter(element);
    cleared(element);
    // FBuddy writes the text back on the next frame: the native setter and an untrusted input.
    element.value = 'this is forbidden';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await pressEnter(element);
    await pressEnter(element);
    // The person takes the word out and sends: MAIN proves this send only.
    element.value = 'this is fine';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await pressEnter(element);
    cleared(element);
    sent(world, 'this is fine');
    await settle();
    expect(facts(world).map((fact) => [fact.platformMessageId, fact.draft.insertIntentId, fact.draft.editedSinceInsert])).toEqual([[MSG, intentId, true]]);
  });

  it('two readings one send cannot tell apart — the same text, another link to our insert —: not linked, and they go with it', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('twice'));
    await pressEnter(element);
    // The person types and takes it back: the same text, but no longer our unchanged insert.
    type(element, 'x');
    element.value = 'twice';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await pressEnter(element);
    sent(world, 'twice');
    sent(world, 'twice', '700000000000000506');
    await settle();
    expect(facts(world)).toEqual([]);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 2, linked: 0, ambiguous: 1, unmatched: 1 });
  });

  it('only the field the port owns: the mini-chat’s Enter is no reading; another creator forgets what was read under the old one', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    world.page.miniChat(true);
    const mini = document.querySelector<HTMLTextAreaElement>('app-messaging-overlay textarea.message-input');
    if (mini === null) throw new Error('no mini-chat field');
    mini.value = 'mini words';
    await pressEnter(mini);
    sent(world, 'mini words');
    await world.port.insert(await world.intent('before the switch'));
    await pressEnter(element);
    world.main({ t: 'fx.identity', p: { ...fanslyIdentityWire, creatorId: '700000000000000077' } });
    await settle();
    sent(world, 'before the switch', '700000000000000507');
    await settle();
    expect(facts(world)).toEqual([]);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 1, unmatched: 2 });
  });
});
