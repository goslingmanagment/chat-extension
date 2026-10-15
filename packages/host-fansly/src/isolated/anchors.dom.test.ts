// The anchors of Fansly's open chat and their two lifecycles of observers (R20 P7c; docs/project-unite/
// architecture.md §7.3; FS-PLC-4, FS-RTE-2, FS-CTR-1): a search over the document until the anchors the address
// expects are there, then `childList` observers without `subtree` on the wrappers and the route — silent while the
// chat lives —, the gallery as no break, the search bounded; the contract's DOM anchors judged only where the page
// must show them. The page is a Fansly-like DOM (testing/fake-dom.ts); in Firefox on the stand: suite-fansly-tap.

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFanslyPage } from '../testing/fake-dom';
import { DOM_ANCHORS_NOT_YET, createAnchorWatcher, judgeAnchors, locateConversation, type DomAnchorStates } from './anchors';
import { createRouteWatcher } from './route';

const A = '700000000000000010';
const B = '700000000000000011';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.documentElement.className = '';
  document.body.className = '';
  history.replaceState({}, '', '/');
});

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function start(path: string, searchMs?: number) {
  history.replaceState({}, '', path);
  const page = createFakeFanslyPage();
  const route = createRouteWatcher(window);
  const anchors = createAnchorWatcher(document, route, searchMs === undefined ? {} : { searchMs });
  cleanups.push(() => page.destroy(), () => anchors.dispose(), () => route.dispose());
  return { page, route, anchors };
}

describe('[host:fansly] the anchors’ observers (FS-PLC-4)', () => {
  it('[FS-RTE-2] search over the document until the expected anchors come, then the working observers alone; anchors only through the route — the mini-chat’s field is never taken', async () => {
    history.replaceState({}, '', '/messages');
    // At document_start nothing of the page is there yet: the search runs.
    const route = createRouteWatcher(window);
    const anchors = createAnchorWatcher(document, route);
    cleanups.push(() => anchors.dispose(), () => route.dispose());
    expect(anchors.stats()).toMatchObject({ searches: 1, searching: true, exhausted: false });
    expect(anchors.current()).toEqual({ contentWrapper: null, messagesWrapper: null, conversation: null });
    const page = createFakeFanslyPage();
    cleanups.unshift(() => page.destroy());
    page.miniChat(true);
    page.openChat(A);
    await settle();
    const found = anchors.current();
    expect(anchors.stats()).toMatchObject({ searches: 1, searching: false });
    expect(found.conversation?.route).toBe(page.route());
    expect(found.conversation?.container).toBe(page.container());
    expect(found.conversation?.textarea).toBe(page.textarea());
    expect(found.conversation?.textarea?.closest('app-messages-conversation-route')).toBe(page.route());
    expect(found.conversation).toMatchObject({ gallery: false, copyOnly: false, strayField: false });
    expect(found.conversation?.subRow?.classList.contains('content-header-sub-row')).toBe(true);
    // The mini-chat repeats the classes: still not ours.
    expect(document.querySelectorAll('textarea.message-input')).toHaveLength(2);
  });

  it('[FS-PLC-4] idle, every observer is silent: the feed, the typing line and the field’s inside are not watched; a chat switch and the gallery are', async () => {
    const { page, anchors } = start(`/messages/${A}`);
    page.openChat(A);
    await settle();
    const before = anchors.stats().workCallbacks;
    const list = page.container()?.querySelector('.message-content-list');
    for (let i = 0; i < 50; i += 1) list?.append(document.createElement('app-group-message'));
    page.container()?.append(Object.assign(document.createElement('div'), { className: 'partner-is-typing' }));
    page.textarea()?.setAttribute('rows', '2');
    await settle();
    expect(anchors.stats().workCallbacks).toBe(before);
    expect(anchors.stats().searching).toBe(false);
    // The gallery takes the header and the container away, the address stays: no conversation's field, no break.
    const listened: Array<Element | null> = [];
    anchors.onChange((now) => listened.push(now.conversation?.container ?? null));
    page.gallery(true);
    await settle();
    expect(anchors.current().conversation).toMatchObject({ gallery: true, container: null, textarea: null, header: null });
    expect(anchors.stats().searching).toBe(false);
    page.gallery(false);
    await settle();
    expect(anchors.current().conversation?.container).toBe(page.container());
    page.openChat(B);
    await settle();
    expect(anchors.current().conversation?.container).toBe(page.container());
    expect(listened.filter((container) => container !== null)).toHaveLength(2);
    expect(anchors.stats().workCallbacks).toBeGreaterThan(before);
  });

  it('[FS-PLC-4] an expected anchor gone starts the search again, for a while only: then it is missing — and a new address searches anew', async () => {
    const { page, anchors, route } = start(`/messages/${A}`, 40);
    page.openChat(A);
    await settle();
    expect(anchors.stats()).toMatchObject({ searches: 1, searching: false });
    // A new Fansly build renames the route: the chat's address stays, its anchor does not come.
    page.route()?.replaceWith(document.createElement('app-messages-conversation-route-v2'));
    await settle();
    expect(anchors.stats()).toMatchObject({ searches: 2, searching: true, exhausted: false });
    await settle(80);
    expect(anchors.stats()).toMatchObject({ searching: false, exhausted: true });
    const judged = judgeAnchors(document, { anchors: anchors.current(), chat: true, path: route.current().path, exhausted: true, direct: false }, DOM_ANCHORS_NOT_YET);
    expect(judged.conversationRoute).toBe('missing');
    // Nothing watches the document now; a new address looks again.
    page.openHome();
    await settle();
    expect(route.current().path).toBe('/home');
    expect(anchors.stats()).toMatchObject({ exhausted: false, searching: false });
  });
});

describe('[host:fansly] the contract’s DOM anchors (FS-CTR-1)', () => {
  const judge = (path: string, before: DomAnchorStates = DOM_ANCHORS_NOT_YET, direct = false): DomAnchorStates => {
    const route = document.querySelector('app-messages-conversation-route');
    return judgeAnchors(document, { anchors: { contentWrapper: null, messagesWrapper: null, conversation: route === null ? null : locateConversation(route) }, chat: /^\/messages\/\d+$/.test(path), path, exhausted: false, direct }, before);
  };

  it('[FS-CTR-1] judged where the page must show them, `notYet` (or as they were) where it need not; a branch seen once stays `ok`', () => {
    history.replaceState({}, '', '/messages');
    const page = createFakeFanslyPage();
    cleanups.push(() => page.destroy());
    expect(judge('/messages')).toEqual({ ...DOM_ANCHORS_NOT_YET, vaultUpload: 'missing' });
    page.openChat(A, { copyOnly: true });
    document.documentElement.classList.add('bright-theme');
    document.body.classList.add('modal-opened');
    const open = judge(`/messages/${A}`);
    expect(open).toEqual({
      conversationRoute: 'ok',
      container: 'ok',
      composer: 'ok',
      textarea: 'ok',
      sendButton: 'ok',
      fileInput: 'ok',
      headerContact: 'ok',
      headerSubRow: 'ok',
      attachments: 'ok',
      noDmAllowed: 'ok',
      modalFlag: 'ok',
      themeClass: 'ok',
      vaultUpload: 'missing',
    });
    expect(locateConversation(page.route() as Element).copyOnly).toBe(true);
    // The gallery and another chat without the DM rule's branch: nothing of it is a break; what was seen stays seen.
    document.body.classList.remove('modal-opened');
    page.gallery(true);
    expect(judge(`/messages/${A}`, open)).toEqual(open);
    page.openChat(B);
    expect(judge(`/messages/${A}`, open)).toEqual(open);
    // A group chat (two partners): no contact block, and that is no break.
    page.openChat(A, { partners: 2 });
    expect(judge(`/messages/${A}`, DOM_ANCHORS_NOT_YET)).toMatchObject({ headerContact: 'notYet', headerSubRow: 'notYet', container: 'ok' });
  });

  it('[FS-CTR-1] a field outside the container’s chain, a direct chat without its contact block, the vault page’s input', () => {
    history.replaceState({}, '', '/messages');
    const page = createFakeFanslyPage();
    cleanups.push(() => page.destroy());
    page.openChat(A, { partners: 2 });
    // MAIN says the group is direct, the page renders it and shows no contact block: the anchor is gone (FS-REG-4).
    expect(judge(`/messages/${A}`, DOM_ANCHORS_NOT_YET, true)).toMatchObject({ headerContact: 'missing', headerSubRow: 'missing' });
    // The container renamed in a new build, the field still under the route: the container's anchor is gone (FS-PLC-3).
    const container = page.container() as Element;
    const renamed = document.createElement('app-group-message-container-v2');
    renamed.append(...container.childNodes);
    container.replaceWith(renamed);
    expect(locateConversation(page.route() as Element)).toMatchObject({ container: null, strayField: true, textarea: null });
    expect(judge(`/messages/${A}`).container).toBe('missing');
    // The vault's upload input is there only on its page (and the vault is the owner's switch).
    const upload = document.createElement('app-media-upload-input');
    upload.append(Object.assign(document.createElement('input'), { type: 'file' }));
    document.body.append(upload);
    cleanups.push(() => upload.remove());
    expect(judge('/creator/vault/album').vaultUpload).toBe('ok');
    expect(judge(`/messages/${A}`).vaultUpload).toBe('missing');
  });
});
