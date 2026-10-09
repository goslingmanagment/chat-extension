// The preview's own window for a fan of the palette's «Онлайн» (CS-030,
// decision X24; ui-design §4.16, §10): the Spenders pane over `preview` from
// `palette`, in a centred column over a scrim. What a person sees, where the
// focus goes, what Esc, ×, J and K dispatch — and that opening it dispatches
// nothing by itself.

import { afterEach, describe, expect, it } from 'vitest';

import { flush, keydown, mountBoardSettled, textOf, type MountedBoard } from './harness';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const CLOSE = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } } as const;

describe('[CS-030] the palette’s preview window', () => {
  it('[CS-030] a modal column «Превью фана» over a scrim: the same pane as in Spenders — the archive, «Чат не открыт, останется непрочитанным», the strip with Ping', async () => {
    ui = await mountBoardSettled('preview', 'online-a');
    const dialog = ui.$('.cg-dialog') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Превью фана');
    expect(dialog.classList.contains('cg-dialog--column')).toBe(true);
    expect(dialog.classList.contains('cg-pvw')).toBe(true);
    expect(ui.$('.cg-scrim')).not.toBeNull();
    expect(textOf(ui.$('.cg-pv__name'))).toBe('Hubert@hubert_pl');
    expect(ui.$('.cg-pv__note')?.getAttribute('data-cg-unread')).toBe('kept');
    expect(textOf(ui.$('.cg-pv__note span'))).toContain('Чат не открыт, останется непрочитанным');
    expect(ui.$$('.cg-feed__msg, .cg-feed [data-cg-msg], .cg-feed > *').length).toBeGreaterThan(0);
    expect(ui.$$('.cg-pv .cg-strip button, .cg-pv__tools button').map(textOf).join(' ')).toContain('Ping');
    expect(ui.$$('.cg-pv__head .cg-btn').map((button) => button.getAttribute('aria-label') ?? textOf(button))).toEqual(['Открыть чат', 'Закрыть превью']);
    // Opening it dispatched nothing: no read of a chat, no generation, no send.
    expect(ui.actions()).toEqual([]);
    expect(ui.failures).toEqual([]);
  });

  it('[CS-030] the archive feed takes the focus, so J and K walk the palette’s list at once and Enter presses nothing', async () => {
    ui = await mountBoardSettled('preview', 'online-a');
    const feed = ui.$('.cg-feed') as HTMLElement;
    expect(ui.root.activeElement).toBe(feed);
    await flush(() => keydown(feed, 'j', { code: 'KeyJ' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'palette:b003' });
    // The first fan of the list has nobody before it.
    const before = ui.actions().length;
    await flush(() => keydown(feed, 'k', { code: 'KeyK' }));
    await flush(() => keydown(feed, 'Enter', { code: 'Enter' }));
    expect(ui.actions()).toHaveLength(before);
  });

  it('[CS-030] Esc and × close it; «Открыть чат» is the person’s own click', async () => {
    ui = await mountBoardSettled('preview', 'online-a');
    await flush(() => keydown(ui?.$('.cg-feed') as HTMLElement, 'Escape', { code: 'Escape' }));
    expect(ui.actions().at(-1)).toEqual(CLOSE);
    const [open, close] = ui.$$('.cg-pv__head .cg-btn') as [HTMLElement, HTMLElement];
    await flush(() => close.click());
    expect(ui.actions().at(-1)).toEqual(CLOSE);
    await flush(() => open.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'chat', targetHandle: 'palette:b002' } });
    // A press on the scrim closes it as well.
    await flush(() => ui?.$('.cg-scrim')?.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(ui.actions().at(-1)).toEqual(CLOSE);
  });

  it('[CS-030] [X8] a result: the part rows of Spenders — «Отправить» on the first unsent part, the others after it — and nothing is sent until a click', async () => {
    ui = await mountBoardSettled('preview', 'online-b');
    const parts = ui.$$('.cg-pvp');
    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.querySelector('.cg-pvs')?.getAttribute('data-cg-send') ?? null)).toEqual(['available', 'after', 'after']);
    expect(ui.$$('.cg-pvs__send')).toHaveLength(1);
    expect(textOf(parts[1]?.querySelector('.cg-pvs'))).toContain('Отправка после части 1');
    expect(ui.actionsOf('SendPart')).toEqual([]);
    const send = ui.$('.cg-pvp[data-cg-part="0"] .cg-pvs__send') as HTMLElement;
    await flush(() => send.click());
    expect(ui.actionsOf('SendPart')).toHaveLength(1);
  });
});
