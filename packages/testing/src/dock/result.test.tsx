// The result sheet of the dock (ui-design §3.2, §4.2…§4.9, §6.3, §6.4;
// UI-018…UI-027, UI-030, UI-032, AI-007, AI-011, AI-022, AI-030, AI-137,
// AI-138, NEW-05): parts one at a time, Hi variants, Fix, the Б2 question,
// the stream, errors and the refusal — and that nothing here inserts or
// sends by itself.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PartVM, type ResultVM, type UiAction } from '@cg/contracts';
import { DEFAULT_PARTS, preloadPart, useSteadyView } from '@cg/ui/dock';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';

import { FANS, MIN, cgError, entry, iso, meta, msg, part, parts, phase, reason, result, running, scenarioById, uuid, variants } from '../scenarios/app-client';
import { type MountedKit, ctx, dockScenario, dockVm, flush, keydown, mountDock, mountDockSettled, settle, text } from './harness';

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
const sheet = (): HTMLElement => kit?.$('.cg-sheet') as HTMLElement;
const byLabel = (label: string, scope: ParentNode = kit?.root as ShadowRoot): HTMLElement => {
  const found = [...scope.querySelectorAll<HTMLElement>('button')].find((element) => element.querySelector('.cg-btn__t')?.textContent === label || element.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};
const frame = async (): Promise<void> => {
  await flush();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await flush();
};

describe('the collapsed dock and the sheet', () => {
  it('no result — no sheet: the strip alone', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(kit.$('.cg-sheet')).toBeNull();
    expect(kit.$('.cg-strip')).not.toBeNull();
  });

  it('the sheet is a labelled section above the strip; «черновик · не отправлено» stands on every draft', () => {
    kit = mountDock(withResult(reply()));
    const section = sheet();
    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('aria-label')).toBe('Результат ChatGoose');
    expect(section.nextElementSibling?.classList.contains('cg-strip')).toBe(true);
    expect(text(kit.$('.cg-head__title'))).toBe('Reply');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['3 части']);
    expect(text(kit.$('[data-cg-draft]'))).toBe('черновик · не отправлено');
  });

  it('the height limit is --cg-cap from the mount geometry (ui-design §3.2): 360, 314 bare and 312 on a sheet at 1280 × 800, never under 112', async () => {
    kit = mountDock(withResult(reply()));
    const cap = (): string => (kit?.$('.cg-dock') as HTMLElement).style.getPropertyValue('--cg-cap');
    expect(cap()).toBe('360px');
    await flush(() => kit?.deps.geometry.set({ width: 693, feedHeight: 474, viewportHeight: 800, container: null }));
    expect(cap()).toBe('314px');
    await flush(() => kit?.deps.geometry.set({ width: 693, feedHeight: 200, viewportHeight: 800, container: null }));
    expect(cap()).toBe('112px');
    kit.unmount();
    kit = mountDock(withResult(reply(), { resultStyle: 'sheet' }));
    await flush(() => kit?.deps.geometry.set({ width: 693, feedHeight: 474, viewportHeight: 800, container: null }));
    expect(cap()).toBe('312px');
    expect(kit.$('.cg-dock')?.classList.contains('cg-bare')).toBe(false);
  });

  it('«Вид ответа»: bare prints on the feed, sheet draws the frame', () => {
    kit = mountDock(withResult(reply()));
    expect(kit.$('.cg-dock')?.classList.contains('cg-bare')).toBe(true);
    kit.unmount();
    kit = mountDock('split-parts');
    expect(kit.$('.cg-dock')?.classList.contains('cg-dock--sheet')).toBe(true);
    expect(kit.$('.cg-dock')?.classList.contains('cg-bare')).toBe(false);
  });

  it('meta prints the tone by its catalog name and «3 варианта по 2 части» as one phrase', () => {
    kit = mountDock(withResult(reply({ meta: [meta.tone('flirty'), meta.parts(3), meta.inserted(1, 3)], toneUsed: 'flirty' })));
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['тон: Flirt', '3 части', 'вставлено 1 из 3']);
    kit.unmount();
    kit = mountDock('hi-variants');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['для Hubert', '3 варианта по 2 части', 'вставлено 1 из 2']);
  });
});

describe('parts', () => {
  it('[UI-018] each part has its number, its text and a Copy icon; «Вставить ↵» stands on the next part only', () => {
    kit = mountDock(withResult(reply()));
    const rows = partRows();
    expect(rows.map((row) => text(row.querySelector('.cg-part__n')))).toEqual(['1', '2', '3']);
    expect(rows.map((row) => text(row.querySelector('.cg-part__t')))).toEqual(TEXTS);
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Часть 1', 'Часть 2', 'Часть 3']);
    expect(rows.map((row) => row.querySelector('.cg-part__copy') !== null)).toEqual([true, true, true]);
    expect(rows.map((row) => row.classList.contains('is-next'))).toEqual([true, false, false]);
    expect(rows.map((row) => row.querySelector('.cg-ins kbd')?.textContent ?? null)).toEqual(['↵', null, null]);
    // One tab stop: the next part.
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  it('[UI-018] a click on the text inserts nothing; the button inserts that part, one at a time', async () => {
    kit = mountDock(withResult(reply()));
    await flush(() => (partRows()[1]?.querySelector('.cg-part__t') as HTMLElement).click());
    await flush(() => partRows()[1]?.click());
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => byLabel('Вставить', partRows()[1]).click());
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: OP, part: 1 }]);
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

  it('[UI-025] Copy asks for the part by its handle and says «Скопировано»; a failed copy shows the card under the text', async () => {
    kit = mountDock(withResult(reply({}, (index) => (index === 1 ? { copy: 'failed', copyError: cgError(ctx, 'CG-CLIPBOARD') } : {}))));
    await flush(() => byLabel('Копировать часть 1').click());
    await settle(1);
    expect(kit.client.dispatched).toEqual([{ type: 'Copy', artifactHandle: `part:${OP.slice(-4)}:0:0` }]);
    expect(text(kit.$('[data-cg-live]'))).toBe('Скопировано');
    const card = partRows()[1]?.querySelector('.cg-part__card') as HTMLElement;
    expect(text(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-CLIPBOARD');
    expect(card.querySelector('.cg-dot--danger')).not.toBeNull();
    // The clipboard itself failed: no «Скопировать код» there.
    expect([...card.querySelectorAll('button')].map(text)).toEqual([]);
  });

  it('[UI-022] an inserted part collapses into one line «✓ вставлено» and offers «Вставить ещё раз»', async () => {
    kit = mountDock(withResult(reply({}, (index) => (index === 0 ? { insert: 'done', collapsed: true, next: false } : { next: index === 1 }))));
    const [done, next] = partRows();
    expect(done?.classList.contains('is-done')).toBe(true);
    expect(text(done?.querySelector('.cg-part__state'))).toBe('вставлено');
    expect(next?.classList.contains('is-next')).toBe(true);
    expect(next?.tabIndex).toBe(0);
    await flush(() => byLabel('Вставить ещё раз', done).click());
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: OP, part: 0 }]);
    // Enter on the collapsed line never inserts again by itself.
    done?.focus();
    await flush(() => done?.dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toHaveLength(1);
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

  it('[UI-026] a failed insert keeps the sheet open and the part «next», with the card «ChatGoose · CG-INSERT-FAILED» under its text', () => {
    kit = mountDock(withResult(reply({}, (index) => (index === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') } : {}))));
    const row = partRows()[0] as HTMLElement;
    expect(row.classList.contains('is-next')).toBe(true);
    expect(byLabel('Вставить', row).querySelector('kbd')?.textContent).toBe('↵');
    const card = row.querySelector('.cg-part__card') as HTMLElement;
    expect(card.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-INSERT-FAILED');
    expect([...card.querySelectorAll('button')].map(text)).toEqual(['Скопировать код']);
    kit.unmount();
    kit = mountDock(withResult(reply({}, (index) => (index === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-CHAT-CHANGED') } : {}))));
    expect(text(partRows()[0]?.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-INSERT-CHAT-CHANGED');
  });

  it('[UI-027] copy-only: «Копировать» takes the place of «Вставить» in every part and nothing can be inserted', async () => {
    kit = mountDock('blocked-fan');
    const rows = partRows();
    expect(kit.$('.cg-dock')?.getAttribute('data-cg-mode')).toBe('copy-only');
    expect(kit.$$('.cg-ins')).toEqual([]);
    expect(rows.map((row) => text(row.querySelector('.cg-copy-main .cg-btn__t')))).toEqual(['Копировать', 'Копировать', 'Копировать']);
    expect(rows[0]?.querySelector('.cg-copy-main kbd')?.textContent).toBe('↵');
    rows[0]?.focus();
    await flush(() => rows[0]?.dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched.map((action) => action.type)).toEqual(['Copy']);
  });

  it('[UI-032] a raw answer that did not parse is one copy-only part with «ответ не разобран»', async () => {
    const raw = part(0, 'Hey [VARIANT] broken markers', { opId: OP, numbered: false, next: true, insertBlocked: reason('unparsed') });
    kit = mountDock(withResult(reply({ parts: [raw], meta: [meta.unparsed()], unparsed: true })));
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['ответ не разобран']);
    expect(text(partRows()[0]?.querySelector('.cg-part__n'))).toBe('');
    expect(kit.$$('.cg-ins')).toEqual([]);
    await flush(() => (kit?.$('.cg-copy-main') as HTMLElement).click());
    expect(kit.client.dispatched.map((action) => action.type)).toEqual(['Copy']);
  });

  it('[AI-087] a part the language gate blocks keeps Copy; «Вставить» is off with the reason and Enter only says why', async () => {
    kit = mountDock(withResult(reply({ parts: parts(OP, ['Привет, как прошли выходные?'], () => ({ insertBlocked: reason('language') })), meta: [meta.single()] })));
    const row = partRows()[0] as HTMLElement;
    const insert = byLabel('Вставить', row);
    expect(insert.getAttribute('aria-disabled')).toBe('true');
    row.focus();
    await flush(() => row.dispatchEvent(keydown('Enter')));
    await flush(() => insert.click());
    expect(kit.client.dispatched).toEqual([]);
    expect(text(kit.$('[data-cg-live]'))).toBe('черновик кириллицей, а фан пишет не кириллицей');
  });

  it('[AI-011] one message has no number; «получилась одна часть» when Split was asked', () => {
    kit = mountDock(withResult(reply({ parts: parts(OP, [TEXTS[0] ?? '']), meta: [meta.single()], splitRequested: false })));
    expect(text(partRows()[0]?.querySelector('.cg-part__n'))).toBe('');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['одним сообщением']);
    kit.unmount();
    kit = mountDock(withResult(reply({ parts: parts(OP, [TEXTS[0] ?? '']), meta: [meta.onePart()], splitRequested: true })));
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['получилась одна часть']);
  });
});

describe('Hi variants', () => {
  const HI = [
    ['Hi Tomasz, welcome!', 'So happy you are here'],
    ['Hey there, new face!', 'Tell me what brought you'],
    ['Welcome in, handsome', 'I have a little gift for new fans'],
  ];
  const hi = (): ResultVM => result(ctx, { opId: uuid(102), feature: 'hi', state: 'done', variants: variants(uuid(102), HI), meta: [meta.variants(3), meta.partsEach(2)], targetName: FANS.tomasz.name });

  it('[AI-030] three labelled variants, each with its parts; the insert names the variant', async () => {
    kit = mountDock(withResult(hi()));
    const columns = kit.$$('.cg-hi__col');
    expect(columns.map((column) => column.getAttribute('aria-label'))).toEqual(['Вариант 1', 'Вариант 2', 'Вариант 3']);
    expect(columns.map((column) => column.querySelectorAll('.cg-part').length)).toEqual([2, 2, 2]);
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['для Tomasz', '3 варианта по 2 части']);
    // The next part is the first of the first variant until the person picks one.
    expect(partRows().map((row) => row.classList.contains('is-next'))).toEqual([true, false, false, false, false, false]);
    await flush(() => byLabel('Вставить', columns[1]?.querySelectorAll<HTMLElement>('.cg-part')[1]).click());
    expect(kit.client.dispatched).toEqual([{ type: 'InsertPart', operationId: uuid(102), variant: 1, part: 1 }]);
  });

  it('← → move to the same part of the neighbouring variant (ui-design §6.4)', async () => {
    kit = mountDock(withResult(hi()));
    const at = (variant: number, index: number): HTMLElement => kit?.$(`.cg-part[data-cg-variant="${variant}"][data-cg-part="${index}"]`) as HTMLElement;
    at(0, 1).focus();
    await flush(() => at(0, 1).dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(at(1, 1));
    await flush(() => at(1, 1).dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(at(2, 1));
    await flush(() => at(2, 1).dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(at(2, 1));
    await flush(() => at(2, 1).dispatchEvent(keydown('ArrowLeft')));
    expect(kit.root.activeElement).toBe(at(1, 1));
  });
});

describe('Б2: the composer already has the person\'s text', () => {
  const asking = (kind: 'human-draft' | 'draft-changed', formatLoss = false): ResultVM => reply({ confirm: { confirmationId: uuid(201), kind, part: { index: 0 }, formatLoss } });

  it('[UI-020] [NEW-05] the question opens inside the part being inserted: «Заменить», «Добавить в конец», «Отмена Esc»', async () => {
    kit = mountDock(withResult(asking('human-draft')));
    const row = partRows()[0] as HTMLElement;
    expect(row.classList.contains('is-confirm')).toBe(true);
    const group = row.querySelector('.cg-confirm') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('В поле ввода уже есть ваш текст.');
    expect(text(group.querySelector('.cg-confirm__q'))).toBe('В поле ввода уже есть ваш текст.');
    expect([...group.querySelectorAll('button')].map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Заменить', 'Добавить в конец', 'Отмена']);
    await flush(() => byLabel('Добавить в конец', group).click());
    await flush(() => byLabel('Заменить', group).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'AnswerConfirm', confirmationId: uuid(201), choice: 'append' },
      { type: 'AnswerConfirm', confirmationId: uuid(201), choice: 'replace' },
    ]);
  });

  it('[UI-020] «Текст в поле изменился после генерации» and «Форматирование черновика пропадёт» when the append goes through setText', () => {
    kit = mountDock(withResult(asking('draft-changed', true)));
    const group = kit.$('.cg-confirm') as HTMLElement;
    expect(group.classList.contains('is-long')).toBe(true);
    expect(text(group.querySelector('.cg-confirm__q'))).toBe('Текст в поле изменился после генерации. Форматирование черновика пропадёт.');
  });

  it('[UI-020] the person\'s own insert puts focus on «Добавить в конец»; Esc is «Отмена» and gives focus back to «Вставить» of that part', async () => {
    kit = mountDock('human-draft-conflict');
    // The scenario answers InsertPart with `needs-confirm`; its first view already asks.
    kit.unmount();
    const scenario = scenarioById('human-draft-conflict');
    const start = withResult(reply());
    kit = mountDock({ ...start, steps: [{ label: 'asks', at: 10, views: [entry({ of: 'dock' }, dockVm('ready', { result: asking('human-draft') }))] }], reactions: [{ on: 'InsertPart', receipt: { ok: true, type: 'InsertPart', outcome: 'needs-confirm' }, thenStep: 0 }, ...(scenario.reactions ?? []).filter((item) => item.on === 'AnswerConfirm').map((item) => ({ on: item.on, receipt: item.receipt }))] });
    await flush(() => byLabel('Вставить', partRows()[0]).click());
    await settle(2);
    const append = byLabel('Добавить в конец');
    expect(kit.root.activeElement).toBe(append);
    await flush(() => append.dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched.map((action) => action.type)).toEqual(['InsertPart', 'AnswerConfirm']);
    expect(kit.client.dispatched[1]).toEqual({ type: 'AnswerConfirm', confirmationId: uuid(201), choice: 'cancel' });
    expect(kit.root.activeElement).toBe(partRows()[0]?.querySelector('.cg-ins'));
    // Esc answered the question; it did not also hide the result.
    expect(kit.client.dispatched.some((action) => action.type === 'HideResult')).toBe(false);
  });

  it('a question that was already there when the dock appeared does not take focus from the composer', async () => {
    kit = mountDock(withResult(asking('human-draft')));
    await settle(1);
    expect(kit.root.activeElement).toBeNull();
  });
});

describe('Fix', () => {
  const fix = (patch: Partial<NonNullable<ResultVM['fix']>> = {}, draftNotSent = true): ResultVM =>
    result(ctx, {
      opId: uuid(103),
      feature: 'fix',
      state: 'done',
      parts: parts(uuid(103), ['hey, sorry I was late — missed you']),
      meta: [meta.byDraft()],
      draftNotSent,
      fix: { sourceDraft: 'hey sorry late missed u', canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false, ...patch },
    });

  it('[AI-022] [NEW-05] «Ваш текст» above «После Fix»; «Заменить мой черновик ↵» is the consent — one click, no second question', async () => {
    kit = mountDock(withResult(fix()));
    expect(kit.$$('.cg-cap').map(text)).toEqual(['Ваш текст', 'После Fix']);
    expect(kit.$$('.cg-fix__t').map(text)).toEqual(['hey sorry late missed u', 'hey, sorry I was late — missed you']);
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['по вашему черновику']);
    const replace = byLabel('Заменить мой черновик');
    expect(replace.querySelector('kbd')?.textContent).toBe('↵');
    expect(replace.classList.contains('cg-btn--line')).toBe(true);
    await flush(() => replace.click());
    expect(kit.client.dispatched).toEqual([{ type: 'ReplaceMyDraft', operationId: uuid(103), part: 0 }]);
    // Enter on the focused block is the same click.
    const box = kit.$('.cg-fixbox') as HTMLElement;
    box.focus();
    await flush(() => box.dispatchEvent(keydown('Enter')));
    expect(kit.client.dispatched).toHaveLength(2);
    expect(kit.$('.cg-confirm')).toBeNull();
  });

  it('[AI-022] after the replacement: «Черновик заменён», «Вернуть мой текст» and the seconds left of 30; then «Вернуть текст уже нельзя»', async () => {
    const until = ctx.now + 30_000;
    kit = mountDock(withResult(fix({ replaced: true, restoreUntil: until }, false)));
    expect(kit.$$('.cg-cap').map(text)).toEqual(['После Fix, уже в поле ввода']);
    expect(text(kit.$('.cg-done'))).toBe('Черновик заменён');
    expect(text(kit.$('.cg-fix__acts .cg-count'))).toBe('30 с');
    // No «Ещё раз» and no draft label once the draft is replaced.
    expect(kit.$('.cg-again')).toBeNull();
    expect(kit.$('[data-cg-draft]')).toBeNull();
    await flush(() => byLabel('Вернуть мой текст').click());
    expect(kit.client.dispatched).toEqual([{ type: 'RestoreMyDraft', operationId: uuid(103) }]);
    kit.unmount();
    kit = mountDock(withResult(fix({ replaced: true, restoreExpired: true }, false)));
    expect(text(kit.$('.cg-fix__acts .cg-count'))).toBe('Вернуть текст уже нельзя');
    expect([...(kit.$('.cg-fix__acts') as HTMLElement).querySelectorAll('button')]).toEqual([]);
  });

  it('[AI-022] the offer counts down by itself and ends by the clock, one tick a second', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountDockSettled(withResult(fix({ replaced: true, restoreUntil: ctx.now + 30_000 }, false)), { now: () => Date.now() });
    expect(text(kit.$('.cg-fix__acts .cg-count'))).toBe('30 с');
    // The kit's timers land a few ms past the boundary, so the text has already changed when they fire.
    await flush(() => vi.advanceTimersByTime(20));
    for (let second = 29; second >= 20; second -= 1) {
      await flush(() => vi.advanceTimersByTime(1_000));
      expect(text(kit.$('.cg-fix__acts .cg-count'))).toBe(`${second} с`);
      // One timer: the next whole second.
      expect(vi.getTimerCount()).toBe(1);
    }
    for (let second = 0; second < 21; second += 1) await flush(() => vi.advanceTimersByTime(1_000));
    expect(text(kit.$('.cg-fix__acts .cg-count'))).toBe('Вернуть текст уже нельзя');
    expect(kit.$$('.cg-fix__acts button')).toEqual([]);
    // Nothing ticks once the offer is over.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('[AI-022] without a verified editor «Заменить» is off with its reason and «Копировать ↵» is the line button', async () => {
    kit = mountDock(withResult(fix({ canReplace: false, replaceReason: reason('draft-unverifiable') })));
    const replace = byLabel('Заменить мой черновик');
    expect(replace.getAttribute('aria-disabled')).toBe('true');
    expect(replace.querySelector('kbd')).toBeNull();
    const copy = kit.$('.cg-fix__acts .cg-copy-main') as HTMLElement;
    expect(copy.classList.contains('cg-btn--line')).toBe(true);
    expect(copy.querySelector('kbd')?.textContent).toBe('↵');
    expect(text(kit.$('.cg-fix__why'))).toBe('поле ввода нельзя проверить, скопируйте текст');
    await flush(() => replace.click());
    await flush(() => copy.click());
    expect(kit.client.dispatched.map((action) => action.type)).toEqual(['Copy']);
  });
});

describe('the head: «Ещё раз» and «Скрыть»', () => {
  it('[AI-007] «Ещё раз ⌘E» regenerates this operation (the controller keeps its tone)', async () => {
    kit = mountDock(withResult(reply({ toneUsed: 'flirty' })));
    const again = kit.$('.cg-again') as HTMLElement;
    expect(text(again.querySelector('.cg-btn__t'))).toBe('Ещё раз');
    expect(again.querySelector('kbd')?.textContent).toBe('⌘E');
    await flush(() => again.click());
    expect(kit.client.dispatched).toEqual([{ type: 'Regenerate', operationId: OP }]);
    kit.unmount();
    kit = mountDock(withResult(reply({ canRegenerate: false, regenerateReason: reason('parts-sending') })));
    expect(kit.$('.cg-again')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('«Скрыть Esc» collapses and keeps the result; focus goes back to the composer; Esc inside the sheet does the same', async () => {
    let restored = 0;
    kit = mountDock(withResult(reply()));
    (kit.deps.focus as { restore: () => boolean }).restore = () => {
      restored += 1;
      return true;
    };
    await flush(() => (kit?.$('.cg-hide') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'HideResult', operationId: OP }]);
    expect(restored).toBe(1);
    partRows()[0]?.focus();
    await flush(() => partRows()[0]?.dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched).toHaveLength(2);
    expect(restored).toBe(2);
  });

  it('«Фан написал новое»: a status row with the accent dot and «Ещё раз»; inserting stays allowed', async () => {
    kit = mountDock(withResult(reply({ stale: { reason: 'fan-wrote', at: iso(ctx.now - MIN) } })));
    const row = kit.$('.cg-stale') as HTMLElement;
    expect(row.getAttribute('role')).toBe('status');
    expect(text(row.querySelector('.cg-stale__t'))).toBe('Фан написал новое после генерации. Ответ его не учитывает.');
    expect(row.querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')).toBe('result-stale');
    await flush(() => byLabel('Ещё раз', row).click());
    await flush(() => byLabel('Вставить', partRows()[0]).click());
    expect(kit.client.dispatched.map((action) => action.type)).toEqual(['Regenerate', 'InsertPart']);
  });

  it('the keys footer shows while the view model says so; its «Скрыть» writes the preference', async () => {
    kit = mountDock(withResult(reply()));
    expect(kit.$('.cg-keys')).toBeNull();
    kit.unmount();
    kit = mountDock(withResult(reply(), { keysFooter: true }));
    expect(kit.$$('.cg-keys .cg-key').map(text)).toEqual(['↑↓часть', '↵вставить', '⌘Cкопировать', 'Escсвернуть']);
    expect(kit.$('.cg-keys .cg-key--x')?.textContent).toContain('копировать');
    await flush(() => (kit?.$('.cg-keys__hide') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetPreference', key: 'onboarding.keysFooter.dismissed', value: true }]);
    kit.unmount();
    kit = mountDock('hi-variants');
    expect(kit.$$('.cg-keys .cg-key').map(text)).toEqual(['↑↓часть', '←→вариант', '↵вставить', 'Escсвернуть']);
  });
});

describe('a running generation', () => {
  it('[AI-138] the sheet appears with the click: spinner, stage line, timer and «Отменить ⌘.»; the preliminary text has no buttons', async () => {
    kit = mountDock('streaming');
    await flush(() => kit?.client.goTo(1));
    expect(kit.$('.cg-head .cg-spin')).not.toBeNull();
    expect(kit.$$('.cg-stage').map(text)).toEqual(['Читаю переписку', 'Думает', 'Пишет ответ…']);
    expect(kit.$('.cg-stage.is-now')?.textContent).toBe('Пишет ответ…');
    expect(text(kit.$('.cg-timer'))).toMatch(/^\d:\d\d$/);
    expect(kit.$('.cg-body')?.getAttribute('aria-busy')).toBe('true');
    // No part rows, no Insert, no Copy, no «Ещё раз», no «Скрыть» until `done`.
    expect(partRows()).toEqual([]);
    expect(kit.$$('.cg-sheet button').map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Отменить']);
    expect(kit.$('[data-cg-draft]')).toBeNull();
    await flush(() => (kit?.$('.cg-cancel') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'CancelGeneration', operationId: OP }]);
    // ⌘. inside the sheet cancels too; Esc does not.
    await flush(() => sheet().dispatchEvent(keydown('.', { code: 'Period', metaKey: true })));
    await flush(() => sheet().dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched).toHaveLength(2);
    expect(kit.client.dispatched[1]).toEqual({ type: 'CancelGeneration', operationId: OP });
  });

  it('[AI-137] a batch of streamed text changes one text node inside a frame and re-renders nothing else', async () => {
    kit = mountDock('streaming');
    await flush(() => kit?.client.goTo(1));
    await frame();
    const node = kit.$('[data-cg-stream]')?.firstChild as Text;
    const head = kit.$('.cg-head') as HTMLElement;
    const stage = kit.$('.cg-stage.is-now') as HTMLElement;
    const reply = kit.$('.cg-strip .cg-act') as HTMLElement;
    expect(node.nodeType).toBe(3);
    expect(node.data).toBe('Hey you, I was');
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(kit.$('.cg-dock') as HTMLElement, { subtree: true, childList: true, attributes: true, characterData: true });
    await flush(() => kit?.client.goTo(2));
    // Nothing is painted before the frame.
    expect(node.data).toBe('Hey you, I was');
    await frame();
    observer.disconnect();
    expect(kit.$('[data-cg-stream]')?.firstChild).toBe(node);
    expect(node.data).toBe('Hey you, I was just thinking about you [NEXT] Got something');
    expect(kit.$('[data-cg-stream]')?.childNodes).toHaveLength(1);
    // One character-data change of that node; no element was replaced or touched.
    expect(mutations).toBe(1);
    expect(kit.$('.cg-head')).toBe(head);
    expect(kit.$('.cg-stage.is-now')).toBe(stage);
    expect(kit.$('.cg-strip .cg-act')).toBe(reply);
    // The stream is not read out piece by piece.
    expect(kit.$('.cg-body')?.hasAttribute('aria-live')).toBe(false);
    expect(kit.deps.marks.paints).toContainEqual({ metric: 'firstChunkPaintMs', mark: OP });
  });

  it('[AI-137] the tree reads a steady view model: a batch that changes only the streamed text renders nothing', async () => {
    const view = signal({ status: 'ready', result: { opId: OP, streamText: 'Hey', stages: ['context'] } });
    const seen: unknown[] = [];
    function Probe(): null {
      const steady = useSteadyView(view);
      seen.push(steady.value);
      return null;
    }
    const host = document.createElement('div');
    await act(() => render(<Probe />, host));
    await act(() => {
      view.value = { ...view.value, result: { ...view.value.result, streamText: 'Hey you' } };
    });
    expect(seen).toHaveLength(1);
    // Anything else changed: the new model reaches the tree.
    await act(() => {
      view.value = { ...view.value, result: { ...view.value.result, stages: ['context', 'thinking'] } };
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(view.value);
    render(null, host);
  });

  it('several batches inside one frame paint once, with the last text', async () => {
    kit = mountDock('streaming');
    await flush(() => kit?.client.goTo(1));
    await frame();
    const node = kit.$('[data-cg-stream]')?.firstChild as Text;
    const writes: string[] = [];
    const observer = new MutationObserver(() => writes.push(node.data));
    observer.observe(node, { characterData: true });
    const base = kit.client.getSnapshot({ of: 'dock' });
    const emit = (streamText: string): void => {
      const next = { ...base, result: base.result === null ? null : { ...base.result, streamText } };
      (kit?.client as unknown as { current: Map<string, unknown>; listeners: Map<string, Set<(view: unknown) => void>> }).current.set('dock', next);
      for (const listener of (kit?.client as unknown as { listeners: Map<string, Set<(view: unknown) => void>> }).listeners.get('dock') ?? []) listener(next);
    };
    await flush(() => {
      emit('one');
      emit('one two');
      emit('one two three');
    });
    await frame();
    observer.disconnect();
    expect(writes).toEqual(['one two three']);
  });

  it('the one transparent retry after a 503 replaces the stages with a countdown; «Отменить» stays', () => {
    kit = mountDock('retry-503');
    expect(kit.$$('.cg-stage').map(text)).toEqual(['Сервис недоступен, повтор через 5 с…']);
    expect(kit.$('.cg-cancel')).not.toBeNull();
    expect(text(kit.$('[data-cg-stream]'))).toBe('');
  });

  it('when the result is done the stream gives way to parts; it is reported shown once it is really on screen', async () => {
    // happy-dom's observer never reports: this one says «visible» as soon as it is asked.
    class VisibleAtOnce {
      constructor(private readonly report: (entries: { isIntersecting: boolean }[]) => void) {}
      observe(): void {
        this.report([{ isIntersecting: true }]);
      }
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', VisibleAtOnce);
    kit = mountDock('streaming');
    expect(kit.deps.marks.shown).toEqual([]);
    await flush(() => kit?.client.goTo(3));
    await settle(1);
    expect(kit.$('[data-cg-stream]')).toBeNull();
    expect(partRows()).toHaveLength(3);
    expect(kit.$('.cg-keys')).not.toBeNull();
    expect(kit.deps.marks.shown).toEqual([OP]);
    vi.unstubAllGlobals();
  });

  it('a canceled operation closes the sheet', () => {
    kit = mountDock(withResult(result(ctx, { opId: OP, feature: 'reply', state: 'canceled' })));
    expect(kit.$('.cg-sheet')).toBeNull();
  });
});

describe('errors in the sheet', () => {
  it('[ER-005] [ER-007] the card says whose error it is first: «ChatGoose · CG-…», title, explanation, the technical line', () => {
    kit = mountDock('provider-rate-limit');
    const card = kit.$('.cg-card') as HTMLElement;
    expect(card.getAttribute('role')).toBe('alert');
    expect(text(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-PROVIDER-RATE-LIMIT');
    expect(text(card.querySelector('.cg-card__title'))).not.toBe('');
    expect(text(card.querySelector('.cg-card__tech'))).toBe('HTTP 429 • provider_rate_limited • retry in 24 s');
    // Our operation failed: the red dot. The head says «не выполнен» and offers only «Скрыть».
    expect(card.querySelector('.cg-gut .cg-dot--danger')).not.toBeNull();
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['не выполнен']);
    expect(kit.$('.cg-again')).toBeNull();
    expect(kit.$('.cg-hide')).not.toBeNull();
    expect(kit.$('[data-cg-draft]')).toBeNull();
  });

  it('[ER-006] «Повторить» stays off until the fixed deadline and is only ever pressed by a person', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountDockSettled('provider-rate-limit', { now: () => Date.now() });
    const retry = (): HTMLElement => byLabel('Повторить', kit?.$('.cg-card') as HTMLElement);
    expect(retry().getAttribute('aria-disabled')).toBe('true');
    expect(text(kit.$('.cg-card .cg-count'))).toBe('через 24 с');
    await flush(() => retry().click());
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => vi.advanceTimersByTime(25_000));
    expect(retry().hasAttribute('aria-disabled')).toBe(false);
    expect(kit.$('.cg-card .cg-count')).toBeNull();
    // Nothing was retried by itself.
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => retry().click());
    expect(kit.client.dispatched).toEqual([{ type: 'Regenerate', operationId: OP }]);
  });

  it('quota 0 is a state, not a failure: a ring and the countdown to the reset written as «17 ч 0 мин»', () => {
    kit = mountDock('quota-zero');
    const card = kit.$('.cg-card') as HTMLElement;
    expect(card.querySelector('.cg-gut .cg-dot--ring')).not.toBeNull();
    expect(card.querySelector('.cg-dot--danger')).toBeNull();
    expect(text(card.querySelector('.cg-count'))).toBe('До обновления 17 ч 0 мин');
  });

  it('an interrupted generation is a failure with «Ещё раз» — never re-posted by itself', async () => {
    kit = mountDock('interrupted');
    const card = kit.$('.cg-card') as HTMLElement;
    expect(text(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-OP-INTERRUPTED');
    expect(card.querySelector('.cg-gut .cg-dot--danger')).not.toBeNull();
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => byLabel('Ещё раз', card).click());
    expect(kit.client.dispatched).toEqual([{ type: 'Regenerate', operationId: OP }]);
  });
});

describe('the refusal of a fourth generation', () => {
  const list = [running(ctx, FANS.theodore, 'reply', 14, uuid(111)), running(ctx, FANS.marco, 'recap', 40, uuid(112)), running(ctx, FANS.jake, 'hi', 6, uuid(113))];
  const refusal = { feature: 'reply' as const, error: cgError(ctx, 'CG-OP-TAB-LIMIT'), running: list };

  it('«не запущен», the ring card and the three that run with «Перейти» and «Отменить»; there is no queue', async () => {
    kit = mountDock('three-running-fourth-refused');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['не запущен']);
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-OP-TAB-LIMIT');
    expect(kit.$('.cg-card .cg-dot--ring')).not.toBeNull();
    expect(kit.$('.cg-ops')?.getAttribute('aria-label')).toBe('Идут сейчас');
    const rows = kit.$$('.cg-op');
    expect(rows.map((row) => text(row.querySelector('.cg-op__fan')))).toEqual(['Theodore Whitfield', 'Marco Rinaldi', 'Jake Morrison']);
    expect(rows.map((row) => text(row.querySelector('.cg-op__feat')))).toEqual(['Reply', 'Recap', 'Hi']);
    expect(rows.map((row) => text(row.querySelector('.cg-op__t')))).toEqual(['14 с', '40 с', '6 с']);
    await flush(() => byLabel('Перейти', rows[1]).click());
    await flush(() => byLabel('Отменить', rows[2]).click());
    expect(kit.client.dispatched).toEqual([list[1]?.go, list[2]?.cancel] as UiAction[]);
  });

  it('«Скрыть» hides it here (no operation exists to hide); the next refused click shows it again', async () => {
    kit = mountDock({ ...dockScenario(dockVm('ready', { refusal })), reactions: [{ on: 'Generate', receipt: { ok: false, type: 'Generate', code: 'CG-OP-TAB-LIMIT', error: refusal.error, running: list } }] });
    await flush(() => (kit?.$('.cg-hide') as HTMLElement).click());
    expect(kit.$('.cg-sheet')).toBeNull();
    expect(kit.client.dispatched).toEqual([]);
    await flush(() => (kit?.$('.cg-strip .cg-act') as HTMLElement).click());
    await settle(1);
    expect(kit.$('.cg-sheet')).not.toBeNull();
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-OP-TAB-LIMIT');
  });
});

describe('debug', () => {
  it('[UI-030] [DB-007] [DB-020] the cost line, «Промпт» and the profiler show only when the controller sends `debug`; never in a collapsed dock', async () => {
    await preloadPart(DEFAULT_PARTS.debug);
    kit = mountDock('debug-on');
    await settle(1);
    const foot = kit.$('.cg-debug') as HTMLElement;
    expect(foot.getAttribute('aria-label')).toBe('Отладка');
    expect(text(foot.querySelector('.cg-debug__line span'))).toBe('in 3 412 tok • out 286 tok • $0.0143 • 3.8 s • model-test');
    expect(foot.querySelector('.cg-prof')?.getAttribute('role')).toBe('img');
    expect(foot.querySelector('.cg-prof')?.getAttribute('aria-label')).toBe('Этапы генерации');
    expect(foot.querySelectorAll('.cg-prof i')).toHaveLength(6);
    expect([...foot.querySelectorAll('.cg-prof__legend:not(.cg-prof__legend--hub) span')].map(text)).toEqual([
      'запрос 38',
      'meta 312',
      'первый чанк 1 120',
      'поток 2 041',
      'разбор 6',
      'отрисовка 9',
      'мс, всего 3,53 с',
    ]);
    await flush(() => (foot.querySelector('.cg-debug__link') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-1' } }]);
    kit.unmount();
    // The same result without debug: no cost, no counters, anywhere.
    kit = mountDock('debug-off');
    await settle(1);
    expect(kit.$('.cg-debug')).toBeNull();
    expect(kit.$('.cg-dock')?.textContent).not.toMatch(/tok|\$0\./);
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { debug: { renderTrace: false, contract: 'index-0000test · ok' } })));
    await settle(1);
    expect(kit.$('.cg-debug')).toBeNull();
    expect(kit.$('.cg-sheet')).toBeNull();
  });

  it('[DB-013] the profile stands under a failed result too, with the stages it got through', async () => {
    await preloadPart(DEFAULT_PARTS.debug);
    const failed = result(ctx, {
      opId: OP,
      feature: 'reply',
      state: 'failed',
      draftNotSent: false,
      meta: [msg('result.meta.failed')],
      error: cgError(ctx, 'CG-PROVIDER-STREAM'),
      debug: { costLine: null, stages: [{ name: 'request', ms: 38 }, { name: 'meta', ms: 312 }], totalMs: 350, hubStages: [{ name: 'context', ms: 182 }], prompt: null, reasoning: null, context: null, liveTimer: false },
    });
    kit = mountDock(withResult(failed));
    await settle(1);
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-PROVIDER-STREAM');
    const foot = kit.$('.cg-debug') as HTMLElement;
    expect([...foot.querySelectorAll('.cg-prof__legend:not(.cg-prof__legend--hub) span')].map(text)).toEqual(['запрос 38', 'meta 312', 'мс, всего 0,35 с']);
    // No cost line and no «Промпт» when the controller sent none.
    expect(foot.querySelector('.cg-debug__line')).toBeNull();
    expect(text(foot.querySelector('.cg-prof__legend--hub'))).toBe('хаб: context 182, provider —, stream —');
  });

  it('[DB-012] the live timer runs ten times a second only while a debugged generation streams', async () => {
    await preloadPart(DEFAULT_PARTS.debug);
    vi.useFakeTimers();
    let now = ctx.now;
    const live = result(ctx, {
      opId: OP,
      feature: 'reply',
      state: 'streaming',
      startedAt: ctx.now,
      phase: phase(OP, ctx.now, ['context'], 'writing'),
      streamText: 'Hey',
      draftNotSent: false,
      debug: { costLine: null, stages: [], totalMs: null, hubStages: [], prompt: null, reasoning: null, context: null, liveTimer: true },
    });
    kit = await mountDockSettled(withResult(live, { actionsOptions: { busy: 'reply' } }), { now: () => now });
    expect(text(kit.$('[data-cg-total]'))).toBe('мс, всего 0,00 с');
    now += 1_300;
    await flush(() => vi.advanceTimersByTime(100));
    expect(text(kit.$('[data-cg-total]'))).toBe('мс, всего 1,30 с');
    // The same footer of a finished result holds no fast timer.
    kit.unmount();
    kit = await mountDockSettled(withResult(reply({ debug: { ...(live.debug as NonNullable<ResultVM['debug']>), totalMs: 3_526 } })), { now: () => now });
    expect(text(kit.$('[data-cg-total]'))).toBe('мс, всего 3,53 с');
    await flush(() => vi.advanceTimersByTime(1_000));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('no timers in idle', () => {
  it('a ready dock, with or without a finished result, holds no timer at all', async () => {
    vi.useFakeTimers();
    // Once the frame after the mount passed (the paint marks), nothing is scheduled.
    kit = await mountDockSettled(dockScenario(dockVm()));
    await flush(() => vi.advanceTimersByTime(100));
    expect(vi.getTimerCount()).toBe(0);
    kit.unmount();
    kit = await mountDockSettled(withResult(reply(), { keysFooter: true }));
    await flush(() => vi.advanceTimersByTime(100));
    expect(vi.getTimerCount()).toBe(0);
    kit.unmount();
    kit = await mountDockSettled('three-running-fourth-refused');
    await flush(() => vi.advanceTimersByTime(100));
    // The refusal shows three elapsed times: one timer each, for its next whole second.
    expect(vi.getTimerCount()).toBe(3);
  });

  it('a running generation ticks once a second: the timer of the stage line, nothing faster', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountDockSettled('streaming', { now: () => Date.now() });
    await flush(() => kit?.client.goTo(1));
    await flush(() => vi.advanceTimersByTime(50));
    const before = text(kit.$('.cg-timer'));
    let renders = 0;
    const observer = new MutationObserver((records) => {
      renders += records.length;
    });
    observer.observe(kit.$('.cg-dock') as HTMLElement, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let second = 0; second < 3; second += 1) {
      await flush(() => vi.advanceTimersByTime(1_000));
      // One pending timer at any moment: the next whole second.
      expect(vi.getTimerCount()).toBe(1);
    }
    observer.disconnect();
    expect(text(kit.$('.cg-timer'))).not.toBe(before);
    // Three seconds, three changes of the timer text — and nothing else moved.
    expect(renders).toBe(3);
  });
});
