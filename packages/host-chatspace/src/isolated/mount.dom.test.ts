import { afterEach, describe, expect, it } from 'vitest';

import { COMPOSER_SLOT_SELECTOR, waitForComposerMount } from './mount';

/** The observable composer structure of §6.3: div.relative > .composer-frame > … > slot. */
function addComposer(doc: Document): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'relative';
  const frame = doc.createElement('div');
  frame.className = 'composer-frame';
  const slot = doc.createElement('div');
  slot.setAttribute('data-id', COMPOSER_SLOT_SELECTOR.slice('[data-id="'.length, -2));
  frame.append(slot);
  root.append(frame);
  doc.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('waitForComposerMount', () => {
  it('resolves at once when the composer is already there', async () => {
    const root = addComposer(document);
    await expect(waitForComposerMount(document, { timeoutMs: 1000, signal: new AbortController().signal })).resolves.toBe(root);
  });

  it('resolves when ChatSpace renders the composer later', async () => {
    const pending = waitForComposerMount(document, { timeoutMs: 1000, signal: new AbortController().signal });
    const root = addComposer(document);
    await expect(pending).resolves.toBe(root);
  });

  it('gives up with null on abort and after the timeout', async () => {
    const life = new AbortController();
    const aborted = waitForComposerMount(document, { timeoutMs: 1000, signal: life.signal });
    life.abort();
    await expect(aborted).resolves.toBeNull();
    await expect(waitForComposerMount(document, { timeoutMs: 5, signal: new AbortController().signal })).resolves.toBeNull();
  });
});
