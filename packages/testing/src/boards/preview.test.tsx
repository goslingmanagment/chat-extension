// The fan preview (R15; ui-design §4.16; architecture.md §6.5, §6.7.5,
// §6.7.12): what a person sees of a chat they did not open — the hub's
// archive and nothing else —, the local draft, the mini strip and the keys.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FeedItemVM, type PreviewVM } from '@cg/contracts';
import { matchesHotkey, pingHint } from '@cg/ui/spenders';

import { cgError, ctxOf, entry, iso, MIN, reason, usd, views, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, settle, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';
import { boardWorld } from './world';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.restoreAllMocks();
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });

/** State 11a with its preview changed. */
function withPreview(change: (vm: PreviewVM) => PreviewVM, state = '11a'): AppClientScenario {
  const base = boardScenario(state);
  return {
    ...base,
    views: base.views.map((view) => (view.selector.of === 'preview' ? entry({ of: 'preview', from: 'spenders' }, change(view.vm as PreviewVM)) : view)),
  };
}

const message = (id: string, patch: Partial<FeedItemVM>): FeedItemVM => ({ id, at: iso(ctx.now - 5 * MIN), sender: 'fan', text: id, deleted: false, automatic: false, tip: null, price: null, attachments: [], dayBreak: false, ...patch });

describe('fan preview: the header and the two lines under it', () => {
  it('[SP-050] [SP-051] [SP-052] name, @handle, lifetime, «+$320 за 30 дней», «Мы писали 10 ч назад, фан 7 мин назад»', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const pane = ui.$('.cg-pv') as HTMLElement;
    expect(pane.tagName).toBe('SECTION');
    expect(pane.getAttribute('aria-label')).toBe('Превью фана');
    expect(textOf(ui.$('.cg-pv__name'))).toBe('Hubert@hubert_pl');
    expect(ui.$$('.cg-pv__money > *').map(textOf)).toEqual(['$12,480', '+$320 за 30 дней']);
    expect(ui.$('.cg-pv__money .cg-money')?.textContent).toBe('+$320 за 30 дней');
    expect(ui.text('.cg-pv__meta')).toBe('Мы писали 10 ч назад, фан 7 мин назад');
    expect(ui.$$('.cg-pv__head .cg-btn').map((button) => button.getAttribute('aria-label') ?? textOf(button))).toEqual(['Открыть чат', 'Закрыть превью']);
  });

  it('an unknown side of the correspondence is «—», and a zero period is not printed', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, header: vm.header === null ? null : { ...vm.header, fanWroteAt: null, period30: 0 } })),
    );
    expect(ui.text('.cg-pv__meta')).toBe('Мы писали 10 ч назад, фан —');
    expect(ui.$$('.cg-pv__money > *').map(textOf)).toEqual(['$12,480']);
  });

  it('«Открыть чат» goes to the chat and × closes the preview: both are the person’s own clicks', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const [open, close] = ui.$$('.cg-pv__head .cg-btn') as [HTMLElement, HTMLElement];
    await flush(() => open.click());
    expect(ui.actions().at(-1)?.type).toBe('Navigate');
    await flush(() => close.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
  });

  it('«Чат не открыт, останется непрочитанным» until a send starts; then «…ChatSpace показывает его прочитанным»', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const note = ui.$('.cg-pv__note') as HTMLElement;
    expect(note.getAttribute('data-cg-unread')).toBe('kept');
    expect(note.querySelector('span')?.firstChild?.textContent).toBe('Чат не открыт, останется непрочитанным');
    expect(ui.root.getElementById(note.querySelector('span')?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Превью строится по архиву хаба; OnlyFans не отметит чат прочитанным');
    ui.unmount();

    for (const state of ['11b', '11c', '11d', '11e', '11g', '11j']) {
      ui = await mountBoardSettled('spenders', state);
      const after = ui.$('.cg-pv__note') as HTMLElement;
      expect(after.getAttribute('data-cg-unread'), state).toBe('read-after-send');
      expect(after.querySelector('span')?.firstChild?.textContent, state).toBe('Чат не открыт. После отправки ChatSpace показывает его прочитанным');
      expect(ui.root.getElementById(after.querySelector('span')?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Исходящее сообщение ChatSpace сам помечает прочитанным');
      ui.unmount();
    }
    // Unavailable is not a started send: the chat stays unread.
    ui = await mountBoardSettled('spenders', '11f');
    expect(ui.$('.cg-pv__note')?.getAttribute('data-cg-unread')).toBe('kept');
  });

  it('[DB-026] the archive line: its time, how far it lags the chat, the coverage, «Обновить архив»', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    expect(ui.text('.cg-pv__asof')).toBe('Архив на 09:18, отстаёт от чата на 2 мин');
    const refresh = ui.$('.cg-pv__arch .cg-btn') as HTMLElement;
    expect(textOf(refresh)).toBe('Обновить архив');
    await flush(() => refresh.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RefreshArchive', targetHandle: 'spenders:b002' });
    ui.unmount();

    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, archive: { ...vm.archive, lagMinutes: null, refreshing: true, stamp: { asOf: vm.archive.stamp.asOf, coverage: 'partial' } } })),
    );
    expect(ui.$('.cg-pv__asof')?.firstChild?.textContent).toBe('Архив на 09:18');
    expect(ui.text('.cg-pv__cov')).toBe('охват неполный');
    expect(ui.$('.cg-pv__arch .cg-btn')?.getAttribute('aria-busy')).toBe('true');
  });

  it('a fan message newer than the answer is one line with the blue dot — its text is not shown', async () => {
    ui = await mountBoardSettled('spenders', '11g');
    const line = ui.$('.cg-pv__lag') as HTMLElement;
    expect(textOf(line)).toBe('Фан написал новое после ответа');
    expect(line.querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')).toBe('preview-fan-wrote');
    expect(ui.$('.cg-pv__asof')).toBeNull();
    // «Обновить архив» stays the one way to see it.
    expect(ui.$$('.cg-pv__arch .cg-btn').map(textOf)).toEqual(['Обновить архив']);
  });
});

describe('fan preview: the archive feed', () => {
  it('[SP-053] [NF-010] bubbles from the archive: day separators, ours on the right, tips and prices under the text', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const feed = ui.$('.cg-feed') as HTMLElement;
    expect(feed.getAttribute('role')).toBe('log');
    expect(feed.getAttribute('aria-label')).toBe('Переписка из архива хаба');
    expect(ui.$$('.cg-feed__day').map(textOf)).toEqual(['30 сен', '1 окт', '2 окт', '3 окт']);
    const bubbles = ui.$$('.cg-feed__msg');
    expect(bubbles).toHaveLength(9);
    expect(bubbles.map((bubble) => bubble.classList.contains('is-own'))).toEqual([true, false, true, false, true, false, true, false, false]);
    expect(textOf(bubbles[1]?.querySelector('small'))).toBe('21:30, чаевые +$50');
    expect(bubbles[1]?.querySelector('small .cg-money')?.textContent).toBe('+$50');
    expect(textOf(bubbles[2]?.querySelector('small'))).toBe('10:02, $30, куплено');
    expect(textOf(bubbles[8]?.querySelector('small'))).toBe('09:13');
    // A screen reader hears who wrote.
    expect(textOf(bubbles[0]?.querySelector('.cg-sr'))).toBe('Мы:');
    expect(textOf(bubbles[1]?.querySelector('.cg-sr'))).toBe('Фан:');
    // No media is ever loaded into a preview: captions only.
    expect(ui.$$('.cg-pv img, .cg-pv video, .cg-pv audio, .cg-pv iframe')).toEqual([]);
  });

  it('the extras of a message: not bought, automatic, deleted, attachments as captions, no time', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({
        ...vm,
        feed: {
          ...vm.feed,
          hasOlder: false,
          items: [
            message('m1', { sender: 'model', price: { mills: usd(40), purchased: false }, attachments: ['photo × 4'] }),
            message('m2', { sender: 'model', automatic: true }),
            message('m3', { deleted: true }),
            message('m4', { at: null, tip: usd(20) }),
            message('m5', { sender: 'system', text: 'renewed' }),
          ],
        },
      })),
    );
    const small = ui.$$('.cg-feed__msg small').map(textOf);
    expect(small).toEqual(['09:15, $40, не куплено', '09:15, авто', '09:15, сообщение удалено', 'чаевые +$20']);
    expect(ui.text('.cg-feed__att')).toBe('photo × 4');
    expect(ui.text('.cg-feed__sys')).toBe('renewed');
  });

  it('[SP-053] older pages come from the archive by the cursor: a button and the scroll both ask once', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const older = ui.$('.cg-feed__older .cg-btn') as HTMLElement;
    expect(textOf(older)).toBe('Показать более ранние');
    await flush(() => older.click());
    await flush(() => older.click());
    expect(ui.actionsOf('LoadOlder')).toEqual([{ type: 'LoadOlder', targetHandle: 'spenders:b002' }]);
    ui.unmount();

    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, feed: { ...vm.feed, olderError: cgError(ctx, 'CG-DATA-UNAVAILABLE') } })),
    );
    expect(ui.$('.cg-feed__older .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    await flush(() => (ui?.$('.cg-feed__older .cg-card .cg-btn') as HTMLElement).click());
    expect(ui.actionsOf('LoadOlder')).toHaveLength(1);
  });

  it('[SP-056] another fan’s feed opens at its newest message, not where the last fan’s was scrolled to', async () => {
    // happy-dom has no layout: a feed 800 px tall in a 200 px window.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cg-feed') ? 800 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cg-feed') ? 200 : 0;
    });
    const base = boardScenario('11a');
    const hubert = base.views.find((view) => view.selector.of === 'preview')?.vm as PreviewVM;
    // The next fan (J / →): another handle, another archive.
    const next: PreviewVM = {
      ...hubert,
      handle: 'spenders:b003',
      feed: { items: [message('c1', { dayBreak: true }), message('c2', { sender: 'model' }), message('c3', {})], hasOlder: true, loadingOlder: false, olderError: null },
    };
    // And back to the first one: an older page of ITS history must still be asked for.
    ui = await mountBoardSettled('spenders', {
      ...base,
      steps: [
        { label: 'the next fan', at: 1_000, views: [entry({ of: 'preview', from: 'spenders' }, next)] },
        { label: 'a new message of the next fan, read from the middle', at: 2_000, views: [entry({ of: 'preview', from: 'spenders' }, { ...next, feed: { ...next.feed, items: [...next.feed.items, message('c4', {})] } })] },
      ],
    });
    const feed = ui.$('.cg-feed') as HTMLElement;
    expect(feed.scrollTop).toBe(800);
    // The person scrolls up to read, to the very top: the older page is asked for once.
    await flush(() => {
      feed.scrollTop = 300;
      feed.dispatchEvent(new Event('scroll'));
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event('scroll'));
    });
    expect(ui.actionsOf('LoadOlder')).toEqual([{ type: 'LoadOlder', targetHandle: 'spenders:b002' }]);
    await flush(() => {
      feed.scrollTop = 300;
      feed.dispatchEvent(new Event('scroll'));
    });
    await flush(() => ui?.client.goTo(0));
    await settle();
    expect(ui.$$('.cg-feed__msg')).toHaveLength(3);
    // The new fan's feed stands at its end…
    expect((ui.$('.cg-feed') as HTMLElement).scrollTop).toBe(800);
    // …and asks for its own older page: what the last fan asked for is forgotten.
    await flush(() => {
      const node = ui?.$('.cg-feed') as HTMLElement;
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    expect(ui.actionsOf('LoadOlder').at(-1)).toEqual({ type: 'LoadOlder', targetHandle: 'spenders:b003' });
    expect(ui.actionsOf('LoadOlder')).toHaveLength(2);
    // Within one fan the rule stays: a new message does not pull a reader down from the middle.
    await flush(() => {
      const node = ui?.$('.cg-feed') as HTMLElement;
      node.scrollTop = 300;
      node.dispatchEvent(new Event('scroll'));
    });
    await flush(() => ui?.client.goTo(1));
    await settle();
    expect((ui.$('.cg-feed') as HTMLElement).scrollTop).toBe(300);
  });

  it('an empty archive says so, and a preview that failed is an error card, not an empty feed', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, view: views.empty({ key: 'preview.feed.empty' }), feed: { items: [], hasOlder: false, loadingOlder: false, olderError: null } })),
    );
    expect(ui.text('.cg-feed__empty')).toBe('Сообщений пока нет.');
    ui.unmount();
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, view: views.error(cgError(ctx, 'CG-DATA-UNAVAILABLE'), { type: 'RefreshArchive', targetHandle: 'spenders:b002' }), header: null })),
    );
    expect(ui.$('.cg-pv__state .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    expect(ui.$('.cg-feed')).toBeNull();
    // The preview can still be closed.
    expect(ui.$$('.cg-pv__head .cg-btn')).toHaveLength(1);
  });
});

describe('fan preview: the work zone', () => {
  it('[NEW-10] the local draft for Fix stays in the preview: typing saves it, nothing is sent', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const field = ui.$('.cg-pv__draft textarea') as HTMLTextAreaElement;
    expect(field.getAttribute('placeholder')).toBe('Черновик для Fix. Остаётся в превью, в чат не уходит');
    expect(field.getAttribute('aria-label')).toBe('Черновик для Fix');
    expect(field.maxLength).toBe(5000);
    await flush(() => {
      field.value = 'hey sorry late';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(ui.actions().at(-1)).toEqual({ type: 'SetPreviewDraft', targetHandle: 'spenders:b002', text: 'hey sorry late' });
    // Enter in the draft is a new line of the draft: it starts nothing.
    await flush(() => keydown(field, 'Enter'));
    expect(ui.actions().filter((action) => action.type !== 'SetPreviewDraft')).toEqual([]);
  });

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

  it('[SP-055] the mini strip: Reply · Fix · Hi · Ping without key labels, Tone and Split; a click generates for this fan', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const strip = ui.$('.cg-pvb') as HTMLElement;
    expect(strip.getAttribute('role')).toBe('toolbar');
    expect(strip.getAttribute('aria-label')).toBe('ChatGoose');
    expect(ui.$$('.cg-pvb .cg-act').map((button) => button.querySelector('.cg-act__t')?.textContent)).toEqual(['Reply', 'Fix', 'Hi', 'Ping', 'Тон', 'Split']);
    expect(ui.$$('.cg-pvb kbd')).toEqual([]);
    // Its result is open: Reply is the active one.
    expect(ui.$('.cg-pvb [data-cg-strip="reply"] .cg-act')?.classList.contains('is-active')).toBe(true);
    await flush(() => (ui?.$('.cg-pvb [data-cg-strip="ping"] .cg-act') as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'spenders:b002', feature: 'ping', options: {} });
    // One tab stop for the strip.
    expect(ui.$$('.cg-pvb .cg-act[tabindex="0"]')).toHaveLength(1);
  });

  it('an unavailable action says why and does nothing', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, bar: { ...vm.bar, actions: { ...vm.bar.actions, fix: { enabled: false, busy: false, active: false, reason: reason('needs-draft'), hotkey: null, badge: null } } } })),
    );
    const fix = ui.$('.cg-pvb [data-cg-strip="fix"] .cg-act') as HTMLElement;
    expect(fix.getAttribute('aria-disabled')).toBe('true');
    expect(ui.root.getElementById(fix.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Fix недоступен: сначала напишите черновик в поле ввода');
    await flush(() => fix.click());
    expect(ui.actionsOf('Generate')).toEqual([]);
  });

  it('the tone menu: choosing a tone starts Reply in it; «Без тона» only clears it; Split is a setting', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const tone = ui.$('.cg-pvb [data-cg-strip="tone"] .cg-act') as HTMLElement;
    await flush(() => tone.click());
    expect(tone.getAttribute('aria-expanded')).toBe('true');
    const items = ui.$$('.cg-pvb [role="menuitemradio"]');
    expect(items.map((item) => item.querySelector('.cg-menu__t')?.textContent)).toEqual(['Casual', 'Flirt', 'Sell', 'Spice', 'Без тона']);
    await flush(() => (items[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'spenders:b002', feature: 'reply', options: { tone: 'flirty' } });
    await flush(() => tone.click());
    await flush(() => (ui?.$$('.cg-pvb [role="menuitemradio"]')[4] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetTone', targetHandle: 'spenders:b002', tone: null });
    const split = ui.$('.cg-pvb [data-cg-strip="split"] .cg-act') as HTMLElement;
    expect(split.getAttribute('aria-pressed')).toBe('true');
    await flush(() => split.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetPreference', key: 'generation.split', value: false });
  });

  it('[AI-038] the Ping button says the fan’s segment from the hub; unknown stays unknown', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, ping: { segment: 'segment-b', fanSilenceDays: 19 } })),
    );
    const ping = ui.$('.cg-pvb [data-cg-strip="ping"] .cg-act') as HTMLElement;
    expect(textOf(ping.querySelector('.cg-pvb__seg'))).toBe('B');
    expect(ui.root.getElementById(ping.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Фан молчит 19 д, сегмент B');
    const i18n = boardWorld('11a').deps.i18n;
    expect(pingHint(i18n, { segment: 'segment-a', fanSilenceDays: null })).toBe('Сегмент A');
    expect(pingHint(i18n, { segment: 'active', fanSilenceDays: 0 })).toBe('Фан писал недавно');
    expect(pingHint(i18n, { segment: 'unknown', fanSilenceDays: null })).toBe('Сегмент Ping неизвестен');
  });

  it('before a generation the work zone says what will happen; nothing is generated by opening a preview', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({ ...vm, result: null, idleHint: { key: 'preview.empty' } })),
    );
    expect(ui.text('.cg-pv__idle')).toBe('Нажмите Reply, Hi или Ping — ответ появится здесь. Отправка — только кнопкой у каждой части.');
    expect(ui.$('.cg-pvr')).toBeNull();
    expect(ui.actions()).toEqual([]);
  });

  it('[UI-029] a result that arrives inserts nothing and sends nothing by itself', async () => {
    const idle = withPreview((vm) => ({ ...vm, result: null, idleHint: { key: 'preview.empty' } }));
    const ready = boardScenario('11a').views.filter((view) => view.selector.of === 'preview');
    ui = await mountBoardSettled('spenders', { ...idle, steps: [{ label: 'done', at: 3_000, views: ready }] });
    await flush(() => ui?.client.goTo(0));
    expect(ui.$$('.cg-pvp')).toHaveLength(3);
    expect(ui.actions()).toEqual([]);
  });

  it('a running generation shows its stages and «Отменить»; parts appear only when it is done', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({
        ...vm,
        result:
          vm.result === null
            ? null
            : {
                ...vm.result,
                state: 'streaming',
                parts: null,
                streamText: 'good morning, my trav',
                draftNotSent: false,
                phase: {
                  startedAt: ctx.now - 3_000,
                  stages: [
                    { id: 'context', label: { key: 'result.stage.context' }, state: 'done' },
                    { id: 'writing', label: { key: 'result.stage.writing' }, state: 'current' },
                  ],
                  retryAt: null,
                  cancel: { type: 'CancelGeneration', operationId: vm.result.opId },
                },
              },
      })),
    );
    expect(ui.$$('.cg-pvr .cg-stage').map(textOf)).toEqual(['Читаю переписку', 'Пишет ответ…']);
    expect(ui.$('.cg-pvr__body')?.getAttribute('aria-busy')).toBe('true');
    expect(ui.$$('.cg-pvp')).toEqual([]);
    expect(ui.$$('.cg-pvr .cg-btn--send')).toEqual([]);
    const cancel = ui.$('.cg-pvr__head .cg-btn') as HTMLElement;
    expect(textOf(cancel)).toBe('Отменить');
    await flush(() => cancel.click());
    expect(ui.actions().at(-1)?.type).toBe('CancelGeneration');
  });

  it('a failed generation is the error card with its recovery; no parts, no send', async () => {
    ui = await mountBoardSettled(
      'spenders',
      withPreview((vm) => ({
        ...vm,
        result: vm.result === null ? null : { ...vm.result, state: 'failed', parts: null, error: cgError(ctx, 'CG-HUB-TIMEOUT', { detail: 'no first chunk in 30 s' }), draftNotSent: false },
      })),
    );
    expect(ui.$('.cg-pvr .cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-TIMEOUT');
    expect(ui.text('.cg-pvr .cg-card__tech')).toBe('no first chunk in 30 s');
    expect(ui.$$('.cg-pvp')).toEqual([]);
  });
});

describe('fan preview: keys', () => {
  it('[SP-056] ← → and J / K go to the neighbouring fan; not while typing in the draft', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const pane = ui.$('.cg-pv') as HTMLElement;
    await flush(() => keydown(pane, 'ArrowRight', { code: 'ArrowRight' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'spenders:b003' });
    await flush(() => keydown(pane, 'л', { code: 'KeyK' }));
    expect(ui.actions().at(-1)).toEqual({ type: 'OpenPreview', targetHandle: 'spenders:b001' });
    const before = ui.actions().length;
    const field = ui.$('.cg-pv__draft textarea') as HTMLElement;
    await flush(() => keydown(field, 'j', { code: 'KeyJ' }));
    await flush(() => keydown(field, 'ArrowLeft', { code: 'ArrowLeft' }));
    expect(ui.actions()).toHaveLength(before);
  });

  it('[HK-042] ⌘E / ⌘I / ⌘G / ⌘P inside the preview generate for this fan; a key the dispatcher took is left alone', async () => {
    ui = await mountBoardSettled('spenders', '11a');
    const pane = ui.$('.cg-pv') as HTMLElement;
    await flush(() => keydown(pane, 'e', { code: 'KeyE', metaKey: true }));
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'spenders:b002', feature: 'reply', options: {} });
    // The Russian layout: the physical key decides.
    await flush(() => keydown(pane, 'з', { code: 'KeyP', metaKey: true }));
    expect(ui.actions().at(-1)).toEqual({ type: 'Generate', targetHandle: 'spenders:b002', feature: 'ping', options: {} });
    const count = ui.actionsOf('Generate').length;
    const taken = new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', metaKey: true, bubbles: true, cancelable: true });
    taken.preventDefault();
    await flush(() => pane.dispatchEvent(taken));
    expect(ui.actionsOf('Generate')).toHaveLength(count);
    // Plain letters are not shortcuts.
    await flush(() => keydown(pane, 'e', { code: 'KeyE' }));
    expect(ui.actionsOf('Generate')).toHaveLength(count);
  });

  it('a key combination is read from its aria form, by the physical key', () => {
    const event = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);
    expect(matchesHotkey(event({ code: 'KeyE', metaKey: true }), 'Meta+E')).toBe(true);
    expect(matchesHotkey(event({ code: 'KeyE', metaKey: true, shiftKey: true }), 'Meta+E')).toBe(false);
    expect(matchesHotkey(event({ code: 'KeyB', ctrlKey: true, altKey: true }), 'Control+Alt+B')).toBe(true);
    expect(matchesHotkey(event({ code: 'KeyU', altKey: true }), 'Meta+U Alt+U')).toBe(true);
    expect(matchesHotkey(event({ code: 'Enter' }), 'Enter')).toBe(false);
  });
});
