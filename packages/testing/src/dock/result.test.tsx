// The result sheet of the dock (ui-design §4.2…§4.9, §6.3; UI-018, UI-019,
// UI-020, UI-023, AI-022, NEW-05): a click or Enter inserts exactly that part,
// once; a stray key never answers the Б2 question (X18); Fix never replaces a
// draft that changed after the consent — and nothing here sends.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PartVM, type ResultVM } from '@cg/contracts';

import { entry, meta, parts, result, uuid } from '../scenarios/app-client';
import { type MountedKit, ctx, dockScenario, dockVm, flush, keydown, mountDock, settle, text } from './harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  vi.useRealTimers();
});

const OP = uuid(101);
const TEXTS = ['Hey you, I was just thinking about you', 'Got something new today — want a peek?', 'Only if you tell me about your weekend first'];
const reply = (patch: Partial<ResultVM> = {}, partPatch: (index: number) => Partial<PartVM> = () => ({})): ResultVM =>
  result(ctx, { opId: OP, feature: 'reply', state: 'done', parts: parts(OP, TEXTS, partPatch), meta: [meta.parts(3)], splitRequested: true, ...patch });
const withResult = (value: ResultVM, patch: Parameters<typeof dockVm>[1] = {}) => dockScenario(dockVm('ready', { result: value, ...patch }));
const partRows = (): HTMLElement[] => kit?.$$('.cg-part') ?? [];
const byLabel = (label: string, scope: ParentNode = kit?.root as ShadowRoot): HTMLElement => {
  const found = [...scope.querySelectorAll<HTMLElement>('button')].find((element) => element.querySelector('.cg-btn__t')?.textContent === label || element.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};

describe('parts', () => {
  it('[UI-018] a click anywhere on a part inserts that part, as its button does — one part, one at a time', async () => {
    kit = mountDock(withResult(reply()));
    await flush(() => (partRows()[1]?.querySelector('.cg-part__t') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: OP, part: 1 }]);
    await flush(() => partRows()[2]?.click());
    await flush(() => byLabel('Вставить', partRows()[0]).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'InsertPart', operationId: OP, part: 1 },
      { type: 'InsertPart', operationId: OP, part: 2 },
      { type: 'InsertPart', operationId: OP, part: 0 },
    ]);
    // No action sends, and none inserts «all» or «the next one by itself».
    expect(kit.client.dispatched.some((action) => action.type === 'SendPart')).toBe(false);
  });

  it('[UI-023] Enter on a focused part inserts THAT part, not the next one; ↑ ↓ move between parts', async () => {
    kit = mountDock(withResult(reply()));
    const rows = partRows();
    rows[0]?.focus();
    await flush(() => rows[0]?.dispatchEvent(keydown('ArrowDown')));
    expect(kit.root.activeElement).toBe(rows[1]);
    await flush(() => rows[1]?.dispatchEvent(keydown('ArrowDown')));
    await flush(() => rows[2]?.dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: OP, part: 2 }]);
    await flush(() => rows[2]?.dispatchEvent(keydown('ArrowUp')));
    expect(kit.root.activeElement).toBe(rows[1]);
    // The physical C key copies the focused part on any layout.
    await flush(() => rows[1]?.dispatchEvent(keydown('с', { code: 'KeyC', metaKey: true })));
    expect(kit.client.dispatched[1]).toEqual({ type: 'Copy', artifactHandle: (kit.client.getSnapshot({ of: 'dock' }).result?.parts?.[1] as PartVM).copyHandle });
  });

  it('[UI-019] a running insert shows a spinner and takes no second click; a done one is announced', async () => {
    kit = mountDock(withResult(reply({}, (index) => (index === 0 ? { insert: 'pending' } : {}))));
    const insert = byLabel('Вставить', partRows()[0]);
    expect(insert.getAttribute('aria-busy')).toBe('true');
    expect(insert.querySelector('.cg-spin')).not.toBeNull();
    await flush(() => insert.click());
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => byLabel('Вставить', partRows()[1]).click());
    await settle(1);
    expect(text(kit.$('[data-cg-live]'))).toBe('вставлено');
  });
});

describe('Б2: the composer already has the person\'s text', () => {
  const asking = (kind: 'human-draft' | 'draft-changed', formatLoss = false): ResultVM => reply({ confirm: { confirmationId: uuid(201), kind, part: { index: 0 }, formatLoss } });

  /**
   * What the browser does with a key on the focused <button> (happy-dom does none of it): Enter clicks it on
   * keydown, Space on keyup — unless a handler of ours prevented the keydown (the repeat of a held Enter is).
   */
  const pressFocused = async (key: 'Enter' | ' ', init: KeyboardEventInit = {}): Promise<void> => {
    const target = kit?.root.activeElement as HTMLElement;
    const down = keydown(key, init);
    await flush(() => target.dispatchEvent(down));
    if (down.defaultPrevented) return;
    if (key === ' ') await flush(() => target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, composed: true })));
    await flush(() => target.click());
  };

  it('[UI-020] [NEW-05] a stray Enter or Space right after the question appears is «Отмена» (X18): nothing is written, the question closes, focus is back on «Вставить»; a held Enter answers nothing by its repeat', async () => {
    // Each insert is asked anew (a new confirmation); the controller's views are stepped by hand after each action.
    const again = reply({ confirm: { confirmationId: uuid(202), kind: 'human-draft', part: { index: 0 }, formatLoss: false } });
    kit = mountDock({
      ...withResult(reply()),
      steps: [
        { label: 'asks', at: 10, views: [entry({ of: 'dock' }, dockVm('ready', { result: asking('human-draft') }))] },
        { label: 'answered', at: 20, views: [entry({ of: 'dock' }, dockVm('ready', { result: reply() }))] },
        { label: 'asks again', at: 30, views: [entry({ of: 'dock' }, dockVm('ready', { result: again }))] },
        { label: 'answered again', at: 40, views: [entry({ of: 'dock' }, dockVm('ready', { result: reply() }))] },
      ],
      reactions: [
        { on: 'InsertPart', receipt: { ok: true, type: 'InsertPart', outcome: 'needs-confirm' } },
        { on: 'AnswerConfirm', receipt: { ok: true, type: 'AnswerConfirm', outcome: 'noop' } },
      ],
    });
    const step = async (index: number): Promise<void> => {
      await flush(() => kit?.client.goTo(index));
      await settle(2);
    };
    const answers = (): string[] => (kit?.client.dispatched ?? []).map((action) => (action.type === 'AnswerConfirm' ? action.choice : action.type));
    const insert = (): HTMLElement => partRows()[0]?.querySelector('.cg-ins') as HTMLElement;
    // A click on «Вставить», then Enter typed by chance: the focused button is «Отмена».
    await flush(() => byLabel('Вставить', partRows()[0]).click());
    await step(0);
    expect(kit.root.activeElement).toBe(byLabel('Отмена', kit.$('.cg-confirm') as HTMLElement));
    await pressFocused('Enter');
    expect(answers()).toEqual(['InsertPart', 'cancel']);
    await step(1);
    expect(kit.$('.cg-confirm')).toBeNull();
    expect(kit.root.activeElement).toBe(insert());
    // Enter on «Вставить» itself asks again; the repeat of that held Enter lands on «Отмена» and is swallowed.
    await pressFocused('Enter');
    await step(2);
    expect(kit.$('.cg-confirm')).not.toBeNull();
    expect(kit.root.activeElement).toBe(byLabel('Отмена'));
    await pressFocused('Enter', { repeat: true });
    await pressFocused('Enter', { repeat: true });
    expect(answers()).toEqual(['InsertPart', 'cancel', 'InsertPart']);
    // Space typed by chance is «Отмена» as well.
    await pressFocused(' ');
    expect(kit.client.dispatched.at(-1)).toEqual({ type: 'AnswerConfirm', confirmationId: uuid(202), choice: 'cancel' });
    await step(3);
    expect(kit.$('.cg-confirm')).toBeNull();
    expect(kit.root.activeElement).toBe(insert());
    // «Заменить» and «Добавить в конец» stay one Tab away, and only their own press writes.
    expect(kit.client.dispatched.some((action) => action.type === 'AnswerConfirm' && action.choice !== 'cancel')).toBe(false);
  });
});

describe('Fix', () => {
  const fix = (patch: Partial<NonNullable<ResultVM['fix']>> = {}, draftNotSent = true): ResultVM =>
    result(ctx, {
      opId: uuid(103),
      feature: 'fix',
      state: 'done',
      parts: parts(uuid(103), ['hey, sorry I was late — missed you']),
      meta: [],
      draftNotSent,
      fix: { sourceDraft: 'hey sorry late missed u', canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false, ...patch },
    });

  const changed = { confirmationId: uuid(203), kind: 'draft-changed', part: { index: 0 }, formatLoss: false } as const;

  it('[AI-022] [NEW-05] the draft changed while Fix was made: the consent is void, and the question opens under «После Fix» with focus on «Отмена»', async () => {
    kit = mountDock({
      ...withResult(fix()),
      steps: [
        { label: 'asks', at: 10, views: [entry({ of: 'dock' }, dockVm('ready', { result: { ...fix(), confirm: changed } }))] },
        { label: 'answered', at: 20, views: [entry({ of: 'dock' }, dockVm('ready', { result: fix() }))] },
      ],
      reactions: [
        { on: 'ReplaceMyDraft', receipt: { ok: true, type: 'ReplaceMyDraft', outcome: 'needs-confirm' }, thenStep: 0 },
        { on: 'AnswerConfirm', receipt: { ok: true, type: 'AnswerConfirm', outcome: 'done' }, thenStep: 1 },
      ],
    });
    await flush(() => byLabel('Заменить мой черновик').click());
    await settle(2);
    const group = kit.$('.cg-confirm') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('data-cg-confirm')).toBe('draft-changed');
    expect(text(group.querySelector('.cg-confirm__q'))).toBe('Текст в поле изменился после генерации.');
    expect([...group.querySelectorAll('button')].map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Заменить', 'Добавить в конец', 'Отмена']);
    // Under the text of «После Fix», on the sunk background of the block it is about.
    expect(text(group.parentElement?.querySelector('.cg-cap'))).toBe('После Fix');
    expect(kit.$('.cg-fixbox')?.classList.contains('is-confirm')).toBe(true);
    expect(kit.root.activeElement).toBe(byLabel('Отмена', group));
    // The button that asked gives its place to the question; «Копировать» stays.
    expect(kit.$('.cg-fix__go')).toBeNull();
    expect(kit.$('.cg-fix__acts .cg-copy-main')).not.toBeNull();
    // Enter on the block does not ask to replace again over an open question.
    await flush(() => kit?.$('.cg-fixbox')?.dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toHaveLength(1);
    await flush(() => byLabel('Отмена', group).dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched).toEqual([
      { type: 'ReplaceMyDraft', operationId: uuid(103), part: 0 },
      { type: 'AnswerConfirm', confirmationId: uuid(203), choice: 'cancel' },
    ]);
    // «Отмена»: the question is gone, focus is back on «Заменить мой черновик», the result stays open.
    expect(kit.$('.cg-confirm')).toBeNull();
    expect(kit.root.activeElement).toBe(kit.$('.cg-fix__go'));
  });

  it('[UI-019] a replacement on its way takes no second Enter, and a held Enter replaces once', async () => {
    kit = mountDock(withResult({ ...fix(), parts: parts(uuid(103), ['hey, sorry I was late — missed you'], () => ({ insert: 'pending' })) }));
    const pending = kit.$('.cg-fixbox') as HTMLElement;
    expect(byLabel('Заменить мой черновик').getAttribute('aria-busy')).toBe('true');
    pending.focus();
    await flush(() => pending.dispatchEvent(keydown('Enter')));
    await flush(() => byLabel('Заменить мой черновик').click());
    expect(kit.client.dispatched).toEqual([]);
    kit.unmount();
    kit = mountDock(withResult(fix()));
    const box = kit.$('.cg-fixbox') as HTMLElement;
    box.focus();
    const held = keydown('Enter', { repeat: true });
    await flush(() => box.dispatchEvent(keydown('Enter')));
    await flush(() => box.dispatchEvent(held));
    expect(kit.client.dispatched).toEqual([{ type: 'ReplaceMyDraft', operationId: uuid(103), part: 0 }]);
    expect(held.defaultPrevented).toBe(true);
  });
});
