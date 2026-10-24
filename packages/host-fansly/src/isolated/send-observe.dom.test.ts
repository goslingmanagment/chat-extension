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

let stamps = 0;
/**
 * The person's own event: the browser marks it trusted and times it on the page's timeline — the gesture's name both
 * worlds read (`fx.sent.gestureAt`). happy-dom has neither mark: they are stood in for.
 */
const trusted = <E extends Event>(event: E, isTrusted = true, at?: number): E => {
  stamps += 1;
  return Object.defineProperties(event, { isTrusted: { value: isTrusted }, timeStamp: { value: at ?? 1000 * stamps + 0.25 } });
};

/** The person presses Enter in the field; then the page sends its model and clears the field — a microtask, no event. Its gesture's name. */
async function pressEnter(element: HTMLTextAreaElement, init: KeyboardEventInit = {}, isTrusted = true, at?: number): Promise<number> {
  const event = trusted(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }), isTrusted, at);
  element.dispatchEvent(event);
  await Promise.resolve();
  return event.timeStamp;
}
/** The person clicks the field's own Send (the icon inside it). Its gesture's name. */
function clickSend(element: HTMLTextAreaElement): number {
  const button = element.closest('app-group-message-input')?.querySelector('.send-button');
  if (button === null || button === undefined) throw new Error('no Send');
  const icon = button.appendChild(document.createElement('i'));
  const event = trusted(new MouseEvent('click', { bubbles: true, cancelable: true }));
  icon.dispatchEvent(event);
  return event.timeStamp;
}
/** The page clears the field after its send, as Fansly does: no event. */
const cleared = (element: HTMLTextAreaElement): void => void (element.value = '');

/** A person types: the value, then a trusted-like `input`. */
const type = (element: HTMLTextAreaElement, text: string): void => {
  element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  element.value += text;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
};

/** MAIN proved the send of the gesture `at`: its group, the receipt's id, the digest of the sent text. */
const sent = (world: World, at: number, text: string, msgId: string = MSG, groupId: string = GROUP): void => world.main({ t: 'fx.sent', p: { groupId, msgId, contentDigest: digest(normalize(text)), gestureAt: at } });
const facts = (world: World): HumanSendFact[] => world.events.filter((event): event is Extract<HostEvent, { type: 'humanSend' }> => event.type === 'humanSend').map((event) => event.fact);
const sendLog = (world: World): unknown[] => world.diagnostics.filter((entry) => entry.event === 'human-send').map((entry) => entry.detail);

describe('[FS-SEND-2] [TL-004] [host:fansly] the person’s send linked to our draft (§5.9 п. 7)', () => {
  it('our insert, the person’s Enter, MAIN’s fx.sent of that gesture: `humanSend` with our intent, not edited, the receipt’s id — and no text anywhere', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    const text = 'Привет!\nКак  прошёл день?';
    expect(await world.port.insert(await world.intent(text))).toMatchObject({ state: 'applied' });
    const intentId = world.port.insertion()?.intentId;
    const at = await pressEnter(element);
    cleared(element);
    sent(world, at, ` ${text} `);
    await settle();
    const [fact] = facts(world);
    expect(facts(world)).toHaveLength(1);
    expect(HumanSendFactSchema.parse(fact)).toEqual({
      chat: { host: 'fansly-web', hostAccountId: fanslyIdentityWire.creatorId, platformFanId: FAN },
      pendingId: 'g1',
      platformMessageId: MSG,
      textDigest: digest(normalize(text)),
      draft: { revision: expect.any(Number) as number, provenance: 'our-insert', insertIntentId: intentId, editedSinceInsert: false },
      // Chat Memory week 1: the chat's group, for the hub's record of who sent the message.
      conversationRef: GROUP,
    });
    expect(sendLog(world)).toEqual([{ link: 'linked', ours: true, edited: false }]);
    expect(JSON.stringify([world.events, world.diagnostics])).not.toContain('Привет');
    expect((await world.port.health()).isolated.sends).toEqual({ gestures: 1, linked: 1, unmatched: 0, mismatched: 0, ambiguous: 0 });
  });

  it('the trusted click on the field’s own Send reads the draft too; edited after our insert — `edited`; the person’s own text — no intent: the tab reports nothing for it', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('AI text'));
    type(element, ' and mine');
    const click = clickSend(element);
    cleared(element);
    sent(world, click, 'AI text and mine');
    type(element, 'all mine');
    const enter = await pressEnter(element);
    cleared(element);
    sent(world, enter, 'all mine', '700000000000000502');
    await settle();
    expect(facts(world).map((fact) => [fact.platformMessageId, fact.draft.provenance, fact.draft.insertIntentId !== null, fact.draft.editedSinceInsert])).toEqual([
      [MSG, 'human-or-unknown', true, true],
      ['700000000000000502', 'human-or-unknown', false, null],
    ]);
    for (const fact of facts(world)) expect(HumanSendFactSchema.safeParse(fact).success).toBe(true);
  });

  it('[UI-033] a text equal to our insert with no gesture read — sent from elsewhere, a script’s Enter, Shift+Enter, IME, another key — is no send of ours: no `humanSend`', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    await world.port.insert(await world.intent('Same words'));
    // MAIN's word for a gesture this side never read (it names a time no reading has).
    sent(world, 999_999.5, 'Same words');
    const notGestures = [await pressEnter(element, {}, false), await pressEnter(element, { shiftKey: true }), await pressEnter(element, { isComposing: true })];
    const other = trusted(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    element.dispatchEvent(other);
    for (const at of [...notGestures, other.timeStamp]) sent(world, at, 'Same words', `70000000000000050${String(at).length}`);
    await settle();
    expect(facts(world)).toEqual([]);
    expect(sendLog(world).every((entry) => JSON.stringify(entry) === JSON.stringify({ link: 'unmatched', ours: null, edited: null }))).toBe(true);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 0, linked: 0, unmatched: 5 });
  });

  it('the link is the gesture’s, checked by group and text: another chat or a changed text is not linked; an empty field is no reading — its name poisoned', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    const empty = await pressEnter(element);
    sent(world, empty, '');
    await world.port.insert(await world.intent('Ours'));
    sent(world, await pressEnter(element), 'Ours', MSG, OTHER);
    sent(world, await pressEnter(element), 'Ours, changed', '700000000000000504');
    await settle();
    expect(facts(world)).toEqual([]);
    sent(world, await pressEnter(element), 'Ours', '700000000000000505');
    await settle();
    expect(facts(world).map((fact) => fact.platformMessageId)).toEqual(['700000000000000505']);
    expect((await world.port.health()).isolated.sends).toEqual({ gestures: 4, linked: 1, unmatched: 0, mismatched: 2, ambiguous: 1 });
  });

  it('only the field the port owns: the mini-chat’s Enter is no gesture of MAIN’s; another creator poisons what was read under the old one', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    world.page.miniChat(true);
    const mini = document.querySelector<HTMLTextAreaElement>('app-messaging-overlay textarea.message-input');
    if (mini === null) throw new Error('no mini-chat field');
    mini.value = 'mini words';
    sent(world, await pressEnter(mini), 'mini words');
    await world.port.insert(await world.intent('before the switch'));
    const before = await pressEnter(element);
    world.main({ t: 'fx.identity', p: { ...fanslyIdentityWire, creatorId: '700000000000000077' } });
    await settle();
    sent(world, before, 'before the switch', '700000000000000507');
    await settle();
    expect(facts(world)).toEqual([]);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 1, unmatched: 1, ambiguous: 1, linked: 0 });
  });
  it('[FS-SEND-2] two real sends sharing a name: neither is linked — rarely unattributed, never misattributed', async () => {
    const world = await onChat();
    const element = fieldOf(world);
    const at = 99_999.5;
    await world.port.insert(await world.intent('Twin'));
    await pressEnter(element, {}, true, at);
    cleared(element);
    await world.port.insert(await world.intent('Twin'));
    await pressEnter(element, {}, true, at);
    cleared(element);
    sent(world, at, 'Twin', '700000000000000541');
    sent(world, at, 'Twin', '700000000000000542');
    await settle();
    expect(facts(world)).toEqual([]);
    expect((await world.port.health()).isolated.sends).toMatchObject({ gestures: 2, linked: 0, ambiguous: 2 });
  });
});
