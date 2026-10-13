// The Fansly-like stand's composer (fixture-fansly; R20 P6a): NgModel and the
// draft cache, Enter by the component's own Shift flag, the send inside the
// handler, the branches that change without an address change, the upload
// modal (docs/project-unite/fansly-web.md §3; main:55791-56265).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_UPLOAD_MS } from '../../fixture-fansly/src/modal';
import { apiCalls, key, mainComposer, mainField, mainSend, mountStand, settle, type, type MountedStand } from './harness';

let stand: MountedStand | null = null;

afterEach(() => {
  vi.useRealTimers();
  stand?.unmount();
  stand = null;
});

async function openFirst(): Promise<{ readonly a: string; readonly b: string }> {
  stand = await mountStand('/messages');
  const [a, b] = stand.control.ids.groups as [string, string];
  await stand.control.open(a);
  await settle();
  return { a, b };
}

const main = () => stand?.control.composers().find((composer) => composer.place === 'main');
const mark = (): number => stand?.control.journal().at(-1)?.seq ?? 0;

describe('the Fansly stand: the composer', () => {
  it('a new composer gets the cached draft by a microtask, with no event; the field is empty until then', async () => {
    const { a, b } = await openFirst();
    type(mainField() as HTMLTextAreaElement, 'kept draft');
    expect(main()?.cached).toBe('kept draft');
    await stand?.control.open(b);
    const inputs: Event[] = [];
    document.addEventListener('input', (event) => inputs.push(event), true);
    // What reacts to the new container — a route observer's callback — finds the new field still empty.
    const seen: Array<string | null> = [];
    const observer = new MutationObserver(() => seen.push(mainField()?.value ?? null));
    observer.observe(document.querySelector('app-messages-conversation-route') as Node, { childList: true });
    await stand?.control.open(a);
    observer.disconnect();
    expect(seen[0]).toBe('');
    expect(main()?.model).toBe('kept draft');
    expect(mainField()?.value).toBe('kept draft');
    expect(inputs).toEqual([]);
  });

  it('Enter sends inside the keydown unless the component’s own Shift flag is up; the field clears by a microtask', async () => {
    const { a } = await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    type(field, 'line one');
    key(field, 'keydown', 'Shift');
    expect(main()?.shiftDown).toBe(true);
    const newline = key(field, 'keydown', 'Enter');
    expect(newline.defaultPrevented).toBe(false);
    key(field, 'keyup', 'Shift');
    expect(main()?.shiftDown).toBe(false);
    const before = mark();
    const enter = key(field, 'keydown', 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    // The request was made inside that keydown, before the dispatch returned.
    const posts = apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/);
    expect(posts).toEqual([expect.objectContaining({ groupId: a, content: 'line one', during: expect.objectContaining({ type: 'keydown', eventPhase: 2 }) as unknown })]);
    expect(main()?.model).toBe('');
    expect(main()?.cached).toBe('');
    expect(field.value).toBe('line one');
    await Promise.resolve();
    expect(field.value).toBe('');
  });

  it('a Shift flag that missed its keyup stays up: Enter keeps adding lines (no `shiftKey` check)', async () => {
    await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    type(field, 'text');
    const before = mark();
    key(field, 'keydown', 'Shift');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true }));
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/)).toEqual([]);
  });

  it('the Send click sends inside the click; its mousedown keeps the focus', async () => {
    await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    type(field, 'by click');
    const send = mainSend() as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(send.classList.contains('can-send')).toBe(true);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    send.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const before = mark();
    send.click();
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/)).toEqual([expect.objectContaining({ content: 'by click', during: expect.objectContaining({ type: 'click' }) as unknown })]);
    expect(send.disabled).toBe(true);
  });

  it('the model is what is sent: a value written without an `input` event leaves the model and the button as they were', async () => {
    await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    const before = mark();
    field.value = 'not seen by the page';
    expect(main()?.model).toBe('');
    expect((mainSend() as HTMLButtonElement).disabled).toBe(true);
    key(field, 'keydown', 'Enter');
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/)).toEqual([]);
    type(field, 'seen');
    key(field, 'keydown', 'Enter');
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/).map((entry) => entry['content'])).toEqual(['seen']);
  });

  it('typing announces at most every 3 s (`POST /message/typing`), and updates the status classes of NgModel', async () => {
    await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    expect([...field.classList]).toEqual(expect.arrayContaining(['ng-pristine', 'ng-untouched', 'ng-invalid']));
    const before = mark();
    type(field, 'a');
    type(field, 'ab');
    type(field, 'abc');
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\/typing/)).toHaveLength(1);
    expect([...field.classList]).toEqual(expect.arrayContaining(['ng-dirty', 'ng-valid']));
    field.dispatchEvent(new Event('blur'));
    expect(field.classList.contains('ng-touched')).toBe(true);
  });

  it('an IME composition hands the model nothing until it ends', async () => {
    await openFirst();
    const field = mainField() as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent('compositionstart'));
    type(field, 'かな');
    expect(main()?.model).toBe('');
    field.dispatchEvent(new CompositionEvent('compositionend'));
    expect(main()?.model).toBe('かな');
  });

  it('DM rules not met: `div.no-dm-allowed` appears and `div.message-composer` is hidden; the field itself stays', async () => {
    const { a } = await openFirst();
    const composer = mainComposer() as HTMLElement;
    const field = mainField();
    const path = location.pathname;
    stand?.control.setDmRulesUnmet(a, true);
    expect(composer.querySelector(':scope > div.no-dm-allowed')).not.toBeNull();
    expect(composer.querySelector(':scope > div.message-composer')?.classList.contains('hidden')).toBe(true);
    expect(mainField()).toBe(field);
    expect(mainComposer()).toBe(composer);
    stand?.control.setDmRulesUnmet(a, false);
    expect(composer.querySelector(':scope > div.no-dm-allowed')).toBeNull();
    expect(composer.querySelector(':scope > div.message-composer')?.classList.contains('hidden')).toBe(false);
    expect(location.pathname).toBe(path);
  });

  it('`recreateField` re-creates the field branch inside the same composer; the model comes back by a microtask', async () => {
    await openFirst();
    const composer = mainComposer();
    const field = mainField() as HTMLTextAreaElement;
    type(field, 'survives');
    stand?.control.recreateField();
    const next = mainField() as HTMLTextAreaElement;
    expect(next).not.toBe(field);
    expect(mainComposer()).toBe(composer);
    expect(next.value).toBe('');
    await Promise.resolve();
    expect(next.value).toBe('survives');
  });

  it('voice: the record button turns into «Stop recording»; Stop hands the recording to the upload modal, «Upload» makes the attachment', async () => {
    await openFirst();
    const composer = mainComposer() as HTMLElement;
    composer.querySelector<HTMLButtonElement>('button[title="Record voice message"]')?.click();
    expect(composer.querySelector('button[title="Record voice message"]')).toBeNull();
    const stop = composer.querySelector<HTMLButtonElement>('button.recording-action[title="Stop recording"]');
    expect(stop).not.toBeNull();
    expect(main()?.recording).toBe(true);
    stop?.click();
    expect(composer.querySelector('button[title="Record voice message"]')).not.toBeNull();
    // The modal is open: nothing is attached until a person clicks «Upload».
    expect(stand?.control.modals()).toEqual(['app-account-media-upload']);
    expect(document.body.classList.contains('modal-opened')).toBe(true);
    expect(document.querySelector('div.modal-wrapper > div.xdModal.back-drop + app-account-media-upload')).not.toBeNull();
    expect(composer.querySelector('div.message-attachments app-account-media-create-template')).toBeNull();
    await settle();
    document.querySelector<HTMLElement>('app-account-media-upload .btn.solid-blue')?.click();
    expect(stand?.control.modals()).toEqual([]);
    expect(document.body.classList.contains('modal-opened')).toBe(false);
    const template = composer.querySelector('div.message-attachments > app-account-media-create-template.attachment');
    expect(template).not.toBeNull();
    // Before the three empty placeholders, as Fansly's template has it.
    expect(template?.nextElementSibling?.matches('div.attachment:empty')).toBe(true);
    expect(main()?.attachments).toEqual([expect.objectContaining({ name: 'fansly-audio-recording', type: 'audio/webm', uploaded: false })]);
    expect(main()?.canSend).toBe(false);
  });

  it('a send with media waits for the upload and `POST /account/media`: the message is not posted inside the click', async () => {
    await openFirst();
    const composer = mainComposer() as HTMLElement;
    composer.querySelector<HTMLButtonElement>('button[title="Record voice message"]')?.click();
    composer.querySelector<HTMLButtonElement>('button.recording-action')?.click();
    await settle();
    document.querySelector<HTMLElement>('app-account-media-upload .btn.solid-blue')?.click();
    await new Promise((resolve) => setTimeout(resolve, TEMPLATE_UPLOAD_MS + 250));
    expect(main()?.attachments[0]?.uploaded).toBe(true);
    expect(main()?.canSend).toBe(true);
    const before = mark();
    (mainSend() as HTMLButtonElement).click();
    const clicked = stand?.control.journal(before) ?? [];
    expect(apiCalls(clicked, 'POST', /^\/api\/v1\/account\/media/)).toEqual([expect.objectContaining({ during: expect.objectContaining({ type: 'click' }) as unknown })]);
    expect(apiCalls(clicked, 'POST', /^\/api\/v1\/message\?/)).toEqual([]);
    await settle();
    expect(apiCalls(stand?.control.journal(before) ?? [], 'POST', /^\/api\/v1\/message\?/)).toEqual([expect.objectContaining({ attachments: 1, during: null })]);
    expect(composer.querySelector('app-account-media-create-template')).toBeNull();
  });

  it('closing the upload modal attaches nothing', async () => {
    await openFirst();
    const composer = mainComposer() as HTMLElement;
    composer.querySelector<HTMLButtonElement>('button[title="Record voice message"]')?.click();
    composer.querySelector<HTMLButtonElement>('button.recording-action')?.click();
    document.querySelector<HTMLElement>('app-account-media-upload .modal-header .fa-xmark')?.click();
    expect(stand?.control.modals()).toEqual([]);
    expect(document.body.classList.contains('modal-opened')).toBe(false);
    expect(composer.querySelector('app-account-media-create-template')).toBeNull();
  });
});

describe('the Fansly stand: around the composer', () => {
  it('the typing line comes before the composer with the fan’s 5/22 and goes after 3.1 s or with the fan’s message', async () => {
    const { a, b } = await openFirst();
    // The container's sweep timer under fake time: a new container (B's), then back to A's, made after the switch.
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'Date'] });
    await stand?.control.open(b);
    await stand?.control.open(a);
    const container = document.querySelector('app-messages-conversation-route > app-group-message-container') as HTMLElement;
    stand?.control.fanTyping(a);
    const line = container.querySelector(':scope > div.partner-is-typing');
    expect(line).not.toBeNull();
    expect(line?.nextElementSibling?.localName).toBe('app-group-message-input');
    vi.advanceTimersByTime(2000);
    expect(container.querySelector(':scope > div.partner-is-typing')).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(container.querySelector(':scope > div.partner-is-typing')).toBeNull();
    stand?.control.fanTyping(a);
    expect(container.querySelector(':scope > div.partner-is-typing')).not.toBeNull();
    stand?.control.fanMessage(a, 'here I am');
    expect(container.querySelector(':scope > div.partner-is-typing')).toBeNull();
    expect(stand?.control.list()?.messages).toBeGreaterThan(0);
  });

  it('the mini-chat has its own container and composer outside the route, the same draft cache; the route’s anchors stay the main chat’s', async () => {
    const { a, b } = await openFirst();
    stand?.control.setMiniChat(b);
    await settle();
    const overlay = document.querySelector('app-root > app-messaging-overlay.fansly-chat-client-wrapper > app-messaging-overlay-group');
    expect(overlay?.querySelector('.message-content-header .content-header-sub-row')).not.toBeNull();
    const miniField = overlay?.querySelector<HTMLTextAreaElement>('app-group-message-container > app-group-message-input textarea.message-input');
    expect(miniField).not.toBeNull();
    expect(document.querySelectorAll('app-group-message-input')).toHaveLength(2);
    expect(stand?.control.composers().map((composer) => [composer.place, composer.groupId])).toEqual([
      ['main', a],
      ['mini', b],
    ]);
    type(miniField as HTMLTextAreaElement, 'from the mini-chat');
    expect(stand?.control.composers().find((composer) => composer.place === 'mini')?.cached).toBe('from the mini-chat');
    expect(mainField()?.closest('app-messaging-overlay')).toBeNull();
    stand?.control.setMiniChat(null);
    expect(document.querySelectorAll('app-group-message-input')).toHaveLength(1);
  });

  it('the virtual inbox: rows are `<a href="/messages/<id>">`, 20 groups loaded, the open one `.selected`, a row click opens the chat', async () => {
    stand = await mountStand('/messages');
    const inbox = stand.control.inbox();
    expect(inbox.loaded).toBe(20);
    expect(inbox.rendered.length).toBeGreaterThan(0);
    expect(inbox.rendered.length).toBeLessThanOrEqual(20);
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('.messages-list-wrapper .message-list > a')];
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(inbox.rendered.map((id) => `/messages/${id}`));
    for (const row of rows) expect(row.querySelector(':scope > app-messaging-group.message')).not.toBeNull();
    const target = rows[2] as HTMLAnchorElement;
    target.click();
    await Promise.resolve();
    expect(stand.control.route().groupId).toBe(inbox.rendered[2]);
    expect(target.classList.contains('selected')).toBe(true);
    expect(rows.filter((row) => row.classList.contains('selected'))).toEqual([target]);
  });

  it('the theme is a class on `<html>`: bright-theme or dark-theme', async () => {
    stand = await mountStand('/messages');
    stand.control.setTheme('dark');
    expect([...document.documentElement.classList]).toEqual(['dark-theme']);
    stand.control.setTheme('bright');
    expect([...document.documentElement.classList]).toEqual(['bright-theme']);
  });

  it('the old extension’s four marks; its root moves into every new container, right before the composer', async () => {
    const { b } = await openFirst();
    stand?.control.setOldExtension(true);
    expect(document.querySelector('head > style#chatgoose-bootstrap-style')).not.toBeNull();
    expect(document.querySelector('head > style#chatgoose-style')).not.toBeNull();
    expect(document.querySelector('body > button#chatgoose-followers-launcher')).not.toBeNull();
    expect(document.querySelector('#chatgoose-root')?.nextElementSibling).toBe(mainComposer());
    await stand?.control.open(b);
    expect(document.querySelector('#chatgoose-root')?.nextElementSibling).toBe(mainComposer());
    stand?.control.setOldExtension(false);
    expect(document.querySelector('[id^="chatgoose-"]')).toBeNull();
  });

  it('Angular-like markup: `ng-version`, emulated-encapsulation attributes, `ngIf` comments after their views', async () => {
    await openFirst();
    expect(document.querySelector('app-root')?.getAttribute('ng-version')).toBe('19.1.2');
    const composer = mainComposer() as HTMLElement;
    expect([...composer.attributes].some((attribute) => attribute.name.startsWith('_nghost-ng-c'))).toBe(true);
    expect([...(mainField()?.attributes ?? [])].some((attribute) => attribute.name.startsWith('_ngcontent-ng-c'))).toBe(true);
    const container = composer.parentElement as HTMLElement;
    expect(container.lastChild?.nodeType).toBe(Node.COMMENT_NODE);
    expect(container.lastChild?.previousSibling).toBe(composer);
  });
});
