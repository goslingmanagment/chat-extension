// The fan preview (R15; ui-design §4.16; architecture.md §6.7.5): the local
// draft is the open fan's own — a late echo never eats what was typed, the
// next fan never gets the last one's text — and a result that arrives inserts
// and sends nothing by itself.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PreviewVM } from '@cg/contracts';

import { entry, type AppClientScenario } from '../scenarios/app-client';
import { flush, mountBoardSettled, settle, type MountedBoard } from './harness';
import { boardScenario } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.restoreAllMocks();
});

/** State 11a with its preview changed. */
function withPreview(change: (vm: PreviewVM) => PreviewVM, state = '11a'): AppClientScenario {
  const base = boardScenario(state);
  return {
    ...base,
    views: base.views.map((view) => (view.selector.of === 'preview' ? entry({ of: 'preview', from: 'spenders' }, change(view.vm as PreviewVM)) : view)),
  };
}

describe('fan preview: the work zone', () => {
  it('[NEW-10] the model’s echo of an earlier keystroke never takes back what was typed since; another fan’s draft is taken', async () => {
    const base = boardScenario('11a');
    const vm = base.views.find((view) => view.selector.of === 'preview')?.vm as PreviewVM;
    const draft = (text: string, handle = vm.handle) => entry({ of: 'preview', from: 'spenders' }, { ...vm, handle, draft: { ...vm.draft, text } });
    ui = await mountBoardSettled('spenders', {
      ...base,
      steps: [
        { label: 'the echo of «hey»', at: 100, views: [draft('hey')] },
        { label: 'the echo of «hey there»', at: 200, views: [draft('hey there')] },
        { label: 'the draft was restored from storage', at: 300, views: [draft('saved yesterday')] },
        { label: 'the next fan with a draft of its own', at: 400, views: [draft('for Chris', 'spenders:b003')] },
      ],
    });
    const field = (): HTMLTextAreaElement => ui?.$('.cg-pv__draft textarea') as HTMLTextAreaElement;
    const type = async (text: string): Promise<void> =>
      flush(() => {
        field().value = text;
        field().dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
    await type('hey');
    await type('hey there');
    await flush(() => ui?.client.goTo(0));
    await settle();
    // The late echo of «hey» did not eat « there».
    expect(field().value).toBe('hey there');
    await flush(() => ui?.client.goTo(1));
    await settle();
    expect(field().value).toBe('hey there');
    // Not an echo: the field follows the model.
    await flush(() => ui?.client.goTo(2));
    await settle();
    expect(field().value).toBe('saved yesterday');
    // Typing for one fan, then the next fan's preview: its own draft, not the last fan's unanswered text.
    await type('saved yesterday, and more');
    await flush(() => ui?.client.goTo(3));
    await settle();
    expect(field().value).toBe('for Chris');
    expect(ui.actionsOf('SetPreviewDraft').map((action) => action.text)).toEqual(['hey', 'hey there', 'saved yesterday, and more']);
  });

  it('[UI-029] a result that arrives inserts nothing and sends nothing by itself', async () => {
    const idle = withPreview((vm) => ({ ...vm, result: null, idleHint: { key: 'preview.empty' } }));
    const ready = boardScenario('11a').views.filter((view) => view.selector.of === 'preview');
    ui = await mountBoardSettled('spenders', { ...idle, steps: [{ label: 'done', at: 3_000, views: ready }] });
    await flush(() => ui?.client.goTo(0));
    expect(ui.$$('.cg-pvp')).toHaveLength(3);
    expect(ui.actions()).toEqual([]);
  });
});
