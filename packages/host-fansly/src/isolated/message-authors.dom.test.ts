// «Кто написал»: which bubble is which message, where the label stands, and what makes a pass (2026-11-03: 3.20.0 put a
// colleague's name on an older message with the same text; the review of that release found the rest).

import type { FanslyOrder } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyMessageAuthorsView } from '@cg/contracts/fansly';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE_AUTHOR_ATTRIBUTE, createMessageAuthors, lineUp, textHash, type MessageAuthors } from './message-authors';

const [K, HI, BYE, OTHER] = ['good morning babe', 'hi', 'bye', 'another'].map(textHash) as [number, number, number, number];
const NO_TEXT = 0;
/** As many messages, each in its own second. */
const seconds = (count: number): number[] => Array.from({ length: count }, (_, i) => 1_762_000_000 + i);
const line = (bubbles: readonly number[], messages: readonly number[], times = seconds(messages.length)): number[] => [...lineUp(bubbles, messages, times)];

describe('lineUp', () => {
  it('the same messages on both sides pair one by one, a repeated text too', () => {
    expect(line([K, HI, K], [K, HI, K])).toEqual([0, 1, 2]);
  });

  it('a repeated text that fits several places takes none of them', () => {
    // The page has scrolled above what MAIN holds: which «good morning» is MAIN's is not known.
    expect(line([K, HI, K, BYE], [K, BYE])).toEqual([-1, -1, -1, 1]);
    // MAIN holds more than the page drew.
    expect(line([K, BYE], [K, OTHER, K, BYE])).toEqual([-1, 3]);
  });

  it('a repeated text a neighbour pins down pairs', () => {
    expect(line([HI, K, BYE, K], [K, BYE, K])).toEqual([-1, 0, 1, 2]);
  });

  it('messages in another order than the page pair with nothing', () => {
    expect(line([HI, BYE], [BYE, HI])).toEqual([-1, -1]);
  });

  it('between pairs media pairs with media and a text drawn otherwise with its text', () => {
    expect(line([K, NO_TEXT, OTHER, BYE], [K, NO_TEXT, HI, BYE])).toEqual([0, 1, 2, 3]);
    expect(line([NO_TEXT, NO_TEXT], [NO_TEXT, NO_TEXT])).toEqual([0, 1]);
  });

  it('between pairs nothing pairs when the sides differ', () => {
    expect(line([K, NO_TEXT, NO_TEXT, BYE], [K, NO_TEXT, BYE])).toEqual([0, -1, -1, 2]);
    expect(line([K, OTHER, BYE], [K, NO_TEXT, BYE])).toEqual([0, -1, 2]);
  });

  it('between pairs nothing pairs when a text there could be a message there', () => {
    expect(line([K, K, BYE], [K, OTHER, BYE])).toEqual([-1, -1, 2]);
  });

  it('messages of one second do not pair by order: Fansly and MAIN order them differently', () => {
    expect(line([NO_TEXT, NO_TEXT], [NO_TEXT, NO_TEXT], [1_762_000_000, 1_762_000_000])).toEqual([-1, -1]);
  });
});

// ── the label on a Fansly-like list (the run's template: main:58966-59086) ──

const make = (tag: string, className = '', children: ReadonlyArray<Node | string> = []): HTMLElement => {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
};
const timeLine = (): HTMLElement => make('div', 'timestamp my-message', [make('span', 'margin-right-text', [' 9:49 PM ']), make('span', '', [make('i', 'fa fa-check')])]);
const receiptsLine = (): HTMLElement =>
  make('div', 'timestamp my-message', [make('div', '', [make('span', 'margin-right-text', [make('i', 'fa fa-check')]), make('span', '', [' Sent: 9:49 PM '])]), make('div', '', [make('span', 'margin-right-text', [make('i', 'fa fa-check')]), make('span', 'margin-right-text', [' Delivered: 9:49 PM '])])]);
const bubble = (text: string | null): HTMLElement => make('div', 'flex-col width-100', [make('app-group-message', 'message my-message', text === null ? [] : [make('div', 'message-text', [text])])]);

const place: HTMLElement[] = [];
const authors: MessageAuthors[] = [];
afterEach(() => {
  for (const it of authors.splice(0)) it.dispose();
  for (const node of place.splice(0)) node.remove();
});

/** One run of the model's messages in an open chat. */
function chat(texts: ReadonlyArray<string | null>): { readonly container: HTMLElement; readonly list: HTMLElement; readonly body: HTMLElement } {
  const body = make('div', 'flex-col width-100', [...texts.map(bubble), timeLine()]);
  const list = make('div', 'message-content-list', [make('div', 'message-collection-wrapper', [make('app-group-message-collection', 'message-collection', [make('div', 'flex-row width-100', [body])])])]);
  const container = make('app-group-message-container', 'message-content', [list]);
  document.body.append(container);
  place.push(container);
  return { container, list, body };
}

const orderOf = (messages: ReadonlyArray<readonly [string, string | null]>): FanslyOrder => ({
  ids: messages.map(([id]) => id),
  bits: messages.map(([, text]) => (text === null ? 2 : 16)),
  hashes: messages.map(([, text]) => (text === null ? 0 : textHash(text))),
  times: seconds(messages.length),
});
const viewOf = (byId: Readonly<Record<string, string>>, onUnknownLive?: (ids: readonly string[]) => void): FanslyMessageAuthorsView => ({
  groupId: 'g',
  byId: new Map(Object.entries(byId).map(([id, name]) => [id, { name, how: null }])),
  unknown: (count) => `+${String(count)}`,
  ...(onUnknownLive === undefined ? {} : { onUnknownLive }),
});
/** A pass and the promises after it. */
const pass = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 90));
const labelIn = (root: ParentNode): Element | null => root.querySelector(`[${MESSAGE_AUTHOR_ATTRIBUTE}]`);

function start(order: () => Promise<FanslyOrder | null>): MessageAuthors {
  const made = createMessageAuthors(document, { order });
  authors.push(made);
  return made;
}

describe('the label', () => {
  it('stands before the time, in the line the page has', async () => {
    const { container } = chat(['hi']);
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    const label = labelIn(container);
    expect(label?.textContent).toBe('anna · ');
    expect(label?.parentElement?.classList.contains('timestamp')).toBe(true);
    expect(label?.nextElementSibling?.classList.contains('margin-right-text')).toBe(true);
  });

  it('goes with the read receipts into their «Sent» line and comes back, no line of its own', async () => {
    const { container, body } = chat(['hi']);
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    const receipts = receiptsLine();
    body.querySelector(':scope > .timestamp')?.replaceWith(receipts);
    await pass();
    expect(labelIn(receipts)?.parentElement).toBe(receipts.firstElementChild);
    expect(labelIn(receipts)?.nextElementSibling?.classList.contains('margin-right-text')).toBe(true);
    const time = timeLine();
    receipts.replaceWith(time);
    await pass();
    expect(labelIn(time)?.parentElement).toBe(time);
  });

  it('takes FBuddy\'s translation in a text for nothing', async () => {
    const { container, body } = chat(['older', 'hi', 'bye']);
    const translated = body.querySelectorAll('.message-text')[1];
    translated?.append(make('div', 'fb-translation-output', ['привет']));
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi'], ['2', 'bye']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna', 2: 'max' }));
    await pass();
    expect(labelIn(container)?.textContent).toBe('anna, max · ');
  });

  it('counts a message MAIN named with no sender, never a bubble that lined up with nothing', async () => {
    const { container } = chat(['older than MAIN holds', 'hi', 'bye']);
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi'], ['2', 'bye']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    expect(labelIn(container)?.textContent).toBe('anna · +1 · ');
  });

  it('stays when MAIN cannot say the order, which is asked again', async () => {
    const { container } = chat(['hi']);
    const order = vi.fn<() => Promise<FanslyOrder | null>>().mockResolvedValueOnce(orderOf([['1', 'hi']])).mockResolvedValue(null);
    const labels = start(order);
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    labels.changed('g');
    await pass();
    expect(order).toHaveBeenCalledTimes(2);
    expect(labelIn(container)?.textContent).toBe('anna · ');
  });

  it('goes when the chat goes', async () => {
    const { container } = chat(['hi']);
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    labels.place(null, 'another');
    expect(labelIn(container)).toBeNull();
  });
});

describe('what makes a pass', () => {
  it('a change of the page asks MAIN nothing; MAIN\'s word that the chat moved does', async () => {
    const { container, body } = chat(['hi']);
    const order = vi.fn(() => Promise.resolve(orderOf([['1', 'hi'], ['2', 'bye']])));
    const labels = start(order);
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna', 2: 'max' }));
    await pass();
    expect(labelIn(container)?.textContent).toBe('anna · ');
    body.querySelector(':scope > .timestamp')?.before(bubble('bye'));
    await pass();
    expect(labelIn(container)?.textContent).toBe('anna, max · ');
    expect(order).toHaveBeenCalledTimes(1);
    labels.changed('g');
    await pass();
    expect(order).toHaveBeenCalledTimes(2);
  });

  it('a node inside a bubble, FBuddy\'s, makes none', async () => {
    const { container, list } = chat(['hi']);
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }));
    await pass();
    const looks = vi.spyOn(list, 'querySelectorAll');
    list.querySelector('.message-text')?.append(make('div', 'fb-translation-output', ['привет']));
    await pass();
    expect(looks).not.toHaveBeenCalled();
  });
});

describe('a message with no sender yet', () => {
  it('is told once it comes, once; a message of the history never is', async () => {
    const { container } = chat(['phone', 'hi', 'new']);
    const told = vi.fn<(ids: readonly string[]) => void>();
    const labels = start(() => Promise.resolve(orderOf([['1', 'phone'], ['2', 'hi'], ['3', 'new']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 2: 'anna' }, told));
    await pass();
    expect(told).not.toHaveBeenCalled();
    labels.changed('g', '3');
    await pass();
    labels.changed('g');
    await pass();
    expect(told.mock.calls).toEqual([[['3']]]);
  });

  it('is not told when its sender is known, nor after the chat changed', async () => {
    const { container } = chat(['hi']);
    const told = vi.fn<(ids: readonly string[]) => void>();
    const labels = start(() => Promise.resolve(orderOf([['1', 'hi']])));
    labels.place(container, 'g');
    labels.set(viewOf({ 1: 'anna' }, told));
    labels.changed('g', '1');
    await pass();
    labels.changed('g', '9');
    labels.place(container, 'another');
    labels.place(container, 'g');
    await pass();
    expect(told).not.toHaveBeenCalled();
  });
});
