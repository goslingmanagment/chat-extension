// The modal confirmation behind DialogPort (@cg/ui/overlays/dialogs): the
// host the composition root hands to the surfaces, and the view it mounts on
// the modal layer while a question stands.

import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { type ConfirmDialogRequest } from '@cg/contracts';
import { DIALOGS_CSS, DIALOGS_ROOT, createDialogHost, mountDialogs, type DialogHost, type DialogsMount } from '@cg/ui/overlays/dialogs';

import { flush, kitWorld } from '../kit/harness';

const request = (patch: Partial<ConfirmDialogRequest> = {}): ConfirmDialogRequest => ({
  title: { key: 'coach.newDialog' },
  body: { key: 'coach.newDialogTooltip' },
  confirm: { key: 'coach.newDialog' },
  cancel: { key: 'common.cancel' },
  tone: 'normal',
  ...patch,
});

let mounted: DialogsMount | null = null;
let host: DialogHost | null = null;
afterEach(() => {
  mounted?.unmount();
  host?.dispose();
  mounted = null;
  host = null;
  document.body.replaceChildren();
});

async function mount(): Promise<{ readonly host: DialogHost; readonly root: ShadowRoot; readonly element: HTMLElement }> {
  const made = (host = createDialogHost());
  const world = kitWorld('gallery-ready', 'ru');
  const element = document.createElement('div');
  element.setAttribute('data-host', 'overlay');
  document.body.append(element);
  const root = element.attachShadow({ mode: 'closed' });
  await act(() => {
    mounted = mountDialogs(root, world.deps, { host: made });
  });
  return { host: made, root, element };
}

describe('the dialogs host (DialogPort)', () => {
  it('a question waits for its answer; «Отмена» and «confirm» are what the asker hears', async () => {
    const made = (host = createDialogHost());
    expect(made.pending.value).toBeNull();
    const first = made.confirm(request());
    expect(made.pending.value).toMatchObject({ tone: 'normal' });
    made.answer('confirm');
    expect(await first).toBe('confirm');
    expect(made.pending.value).toBeNull();
    const second = made.confirm(request());
    made.answer('cancel');
    expect(await second).toBe('cancel');
  });

  it('one question at a time: a second one cancels the first; dispose cancels what is asked', async () => {
    const made = (host = createDialogHost());
    const first = made.confirm(request());
    const second = made.confirm(request({ tone: 'destructive' }));
    expect(await first).toBe('cancel');
    expect(made.pending.value).toMatchObject({ tone: 'destructive' });
    made.dispose();
    expect(await second).toBe('cancel');
    expect(made.pending.value).toBeNull();
    // An answer with nothing asked is nothing.
    made.answer('confirm');
  });
});

describe('the dialogs view on the modal layer', () => {
  it('[UI-017] nothing is drawn until something is asked; the question is a dialog with its two buttons, and a press answers it', async () => {
    const { host: made, root, element } = await mount();
    expect(root.querySelector(`[data-cg-surface="${DIALOGS_ROOT}"]`)).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    // On the windows' layer (950): above the panels, under the toasts and ChatSpace's own dialogs.
    expect(DIALOGS_CSS).toContain('z-index: 950;');
    // The scheme of the tab is on the host, as for any surface.
    expect(element.hasAttribute('data-scheme')).toBe(true);

    const answer = made.confirm(request());
    await flush();
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])];
    expect(buttons).toHaveLength(2);
    await flush(() => buttons[1]?.click());
    expect(await answer).toBe('confirm');
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a destructive question is an alertdialog; Esc is «Отмена»', async () => {
    const { host: made, root } = await mount();
    const answer = made.confirm(request({ tone: 'destructive' }));
    await flush();
    const dialog = root.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    await flush(() => dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(await answer).toBe('cancel');
  });

  it('unmount takes the tree, the root element and the host’s attributes away, once', async () => {
    const { root, element } = await mount();
    mounted?.unmount();
    mounted?.unmount();
    expect(root.querySelector(`[data-cg-surface="${DIALOGS_ROOT}"]`)).toBeNull();
    expect(element.hasAttribute('data-scheme')).toBe(false);
  });
});
