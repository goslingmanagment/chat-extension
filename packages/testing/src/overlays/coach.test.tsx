// The Coach window (ui-design §3.7, §4.19; AI-080, AI-099): a question typed
// for one fan is never asked about another — a chat switched under the open
// panel keeps each chat's question and asks it for that chat's fan only.

import { afterEach, describe, expect, it } from 'vitest';

import { type CoachVM } from '@cg/contracts';
import { coachSurface, forgetUnsentQuestions } from '@cg/ui/overlays/coach';

import { FANS, coach, dock, entry, handles, views, type ScenarioStep } from '../scenarios/app-client';
import { type MountedKit, ctx, flush, keydown, mountSurface, scenarioOf, settle, text } from '../dock/harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  // Unasked questions live in the module, by chat: no test inherits another's.
  forgetUnsentQuestions();
});

const HANDLE = handles.dock(FANS.hubert);
const mount = (vm: CoachVM, dockPatch: Parameters<typeof dock>[2] = {}, reactions?: Parameters<typeof scenarioOf>[1]): MountedKit =>
  mountSurface(coachSurface.view, scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready', dockPatch)), entry({ of: 'coach' }, vm)], reactions), 'coach', coachSurface.styles ?? []);
const byLabel = (label: string): HTMLElement => {
  const found = kit?.$$('button').find((element) => element.querySelector('.cg-btn__t')?.textContent === label || element.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};
const field = (): HTMLTextAreaElement => kit?.$('textarea') as HTMLTextAreaElement;
const type = async (value: string): Promise<void> => {
  await flush(() => {
    field().value = value;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('the Coach window', () => {
  it('[AI-080] [AI-099] a chat switched under the open panel moves no focus, and the field shows the question of the chat that is open', async () => {
    const other = handles.dock(FANS.theodore);
    const steps: ScenarioStep[] = [
      { label: 'theodore', at: 10, views: [entry({ of: 'dock' }, dock(ctx, 'ready', { fan: FANS.theodore })), entry({ of: 'coach' }, coach(ctx, views.ready(), [], { targetName: FANS.theodore.name }))] },
      { label: 'hubert again', at: 20, views: [entry({ of: 'dock' }, dock(ctx, 'ready')), entry({ of: 'coach' }, coach(ctx, views.ready(), []))] },
    ];
    kit = mount(coach(ctx, views.ready(), []), {}, { steps });
    await type('вопрос про Hubert');
    await flush(() => (kit?.$('.cg-co__attach button') as HTMLElement).click());
    // The person went back to ChatSpace and opened another chat there.
    await flush(() => field().blur());
    await flush(() => kit?.client.goTo(0));
    expect(text(kit.$('.cg-co__name'))).toBe('Theodore Whitfield');
    expect(kit.root.activeElement).toBeNull();
    // Hubert's question is not Theodore's; «Приложить мой ответ» was asked for Hubert's chat only.
    expect(field().value).toBe('');
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-pressed')).toBe('false');
    await flush(() => field().dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toEqual([]);
    await type('вопрос про Theodore');
    await flush(() => kit?.client.goTo(1));
    // Back in Hubert's chat his question is in the field again, with his «Приложить мой ответ», and it is asked about him.
    expect(field().value).toBe('вопрос про Hubert');
    expect(kit.$('.cg-co__attach button')?.getAttribute('aria-pressed')).toBe('true');
    await flush(() => field().dispatchEvent(keydown('Enter')));
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: HANDLE, feature: 'coach', options: { question: 'вопрос про Hubert', attachMyDraft: true } }]);
    expect(field().value).toBe('');
    // Theodore's unasked question waits for his chat.
    kit.unmount();
    kit = mount(coach(ctx, views.ready(), [], { targetName: FANS.theodore.name }), { fan: FANS.theodore });
    expect(field().value).toBe('вопрос про Theodore');
    await flush(() => byLabel('Спросить').click());
    expect(kit.client.dispatched).toEqual([{ type: 'Generate', targetHandle: other, feature: 'coach', options: { question: 'вопрос про Theodore' } }]);
  });
});
