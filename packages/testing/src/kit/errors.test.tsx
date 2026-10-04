import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ActionButtonVM } from '@cg/contracts';
import { Boundary, CodeLine, ErrorCard, StatusBanner, ViewState, remedyLabelKey } from '@cg/ui/kit';

import { button, cgError, ctxOf, reason, views } from '../scenarios/app-client';
import { type MountedKit, flush, mountKit, mountKitSettled } from './harness';

const ctx = ctxOf({ lang: 'ru' });
let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  vi.useRealTimers();
});

function Thrower({ when }: { readonly when: boolean }): null {
  if (when) throw new TypeError('the fan said something private');
  return null;
}

describe('[ER-020] the interface failure card: «ChatGoose · CG-UI-FAILED» «Сбой интерфейса»', () => {
  it('a render error inside a surface shows the card, reports the class name only, and offers reload and export', async () => {
    let fail: (value: boolean) => void = () => undefined;
    function Surface() {
      const [broken, setBroken] = useState(false);
      fail = setBroken;
      return (
        <>
          <p class="cg-neighbour">dock strip</p>
          <Boundary surface={null}>
            <Thrower when={broken} />
            <p class="cg-stats">stats</p>
          </Boundary>
        </>
      );
    }
    kit = mountKit(Surface, { kind: 'spenders' });
    await flush(() => fail(true));
    // The broken part shows the card, its neighbour stays (a stats failure does not take down the board).
    expect(kit.$('.cg-neighbour')?.textContent).toBe('dock strip');
    expect(kit.$('.cg-stats')).toBeNull();
    const card = kit.$('.cg-boundary .cg-card') as HTMLElement;
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.querySelector('.cg-card__code')?.textContent).toBe('ChatGoose · CG-UI-FAILED');
    expect(card.querySelector('.cg-card__title')?.textContent).toBe('Сбой интерфейса');
    expect(card.querySelector('.cg-card__tech')?.textContent).toBe('TypeError • spenders');
    expect(card.querySelector('.cg-dot--danger')).not.toBeNull();
    expect(kit.failures).toEqual([{ kind: 'render', surface: 'spenders', code: 'CG-UI-FAILED', name: 'TypeError' }]);
    expect(JSON.stringify(kit.failures) + card.textContent).not.toContain('private');

    const buttons = [...card.querySelectorAll<HTMLElement>('.cg-btn')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Перезагрузить панель', 'Выгрузить диагностику', 'Скопировать код']);
    await flush(() => fail(false));
    await flush(() => buttons[1]?.click());
    await flush(() => buttons[0]?.click());
    expect(kit.client.dispatched).toEqual([{ type: 'ExportDiagnostics' }, { type: 'ReloadSurface', surface: 'spenders' }]);
    expect(kit.$('.cg-stats')?.textContent).toBe('stats');
  });

  it('every surface sits in its own boundary through KitRoot', async () => {
    let fail: (value: boolean) => void = () => undefined;
    function Surface() {
      const [broken, setBroken] = useState(false);
      fail = setBroken;
      return <Thrower when={broken} />;
    }
    kit = mountKit(Surface, { kind: 'dock' });
    await flush(() => fail(true));
    expect(kit.$('[data-cg-surface="dock"] .cg-card__title')?.textContent).toBe('Сбой интерфейса');
    expect(kit.$('[data-cg-live]')).not.toBeNull();
    await flush(() => (kit?.$$('.cg-boundary .cg-btn')[0] as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'ReloadSurface', surface: 'dock' }]);
  });
});

describe('the error card (ui-design §4.8; ER-005…ER-007 rendered)', () => {
  it('a failure: red dot, code line, title, explanation, technical line cut at 400, recovery buttons', async () => {
    const detail = `HTTP 503 • overloaded • ${'x'.repeat(500)}`;
    const error = cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { detail });
    const retry: ActionButtonVM = button('common.retry', { type: 'Regenerate', operationId: '00000000-0000-4000-8000-000000000101' });
    kit = mountKit(() => <ErrorCard error={error} tone="failure" actions={[retry]} />);
    expect(kit.$('.cg-gut .cg-dot--danger')).not.toBeNull();
    expect(kit.$('.cg-card__code')?.textContent).toBe('ChatGoose · CG-PROVIDER-RATE-LIMIT');
    expect(kit.$('.cg-card__title')?.textContent).toBe(error.title);
    expect(kit.$('.cg-card__text')?.textContent).toBe(error.body);
    const tech = kit.$('.cg-card__tech')?.textContent ?? '';
    expect(tech.length).toBe(400);
    expect(tech.endsWith('…')).toBe(true);
    const first = kit.$('.cg-card__acts .cg-btn') as HTMLElement;
    expect(first.classList.contains('cg-btn--line')).toBe(true);
    await flush(() => first.click());
    expect(kit.client.dispatched).toHaveLength(1);
  });

  it('[ER-022] «Скопировать код»: a refused copy and a rejected clipboard port are both reported, never unhandled', async () => {
    const error = cgError(ctx, 'CG-HUB-UNAVAILABLE');
    kit = mountKit(() => <ErrorCard error={error} tone="failure" />);
    const copy = kit.$('.cg-card__acts .cg-btn') as HTMLElement;
    kit.deps.clipboard.fail = true;
    await flush(async () => {
      copy.click();
      await Promise.resolve();
    });
    Object.assign(kit.deps.clipboard, { writeText: () => Promise.reject(new TypeError('Clipboard write was blocked')) });
    await flush(async () => {
      copy.click();
      await Promise.resolve();
    });
    expect(kit.failures).toEqual([
      { kind: 'clipboard', surface: 'dock', code: 'CG-CLIPBOARD', name: 'ClipboardError' },
      { kind: 'clipboard', surface: 'dock', code: 'CG-CLIPBOARD', name: 'TypeError' },
    ]);
    expect(copy.textContent).toBe('Скопировать код');
  });

  it('a state: a ring, not a red dot; inline in a part: the dot moves into the code line; copy can be off', () => {
    const error = cgError(ctx, 'CG-CLIPBOARD');
    kit = mountKit(() => (
      <>
        <ErrorCard error={cgError(ctx, 'CG-OP-TAB-LIMIT')} tone="state" alert={false} />
        <ErrorCard error={error} tone="failure" inline copyCode={false} />
      </>
    ));
    const [state, inline] = kit.$$('.cg-card');
    expect(state?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(state?.hasAttribute('role')).toBe(false);
    expect(inline?.classList.contains('cg-card--inline')).toBe(true);
    expect(inline?.querySelector('.cg-card__code .cg-dot--danger')).not.toBeNull();
    expect([...(inline?.querySelectorAll('.cg-btn') ?? [])].map((b) => b.textContent)).toEqual([]);
  });

  it('[ER-006] «Повторить» waits for the fixed deadline, counts down from it, then turns on by itself; the press stays the person’s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kitNow());
    const retryAt = kitNow() + 24_000;
    const error = cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { retryAt });
    const retry = button('common.retry', { type: 'Regenerate', operationId: '00000000-0000-4000-8000-000000000101' }, { enabled: false, reason: reason('wait-until', { n: 24 }) });
    kit = await mountKitSettled(() => <ErrorCard error={error} tone="failure" actions={[retry]} />, { now: () => Date.now() });
    const now = (): number => Date.now();
    expect(kit.$('.cg-card__acts .cg-btn')?.getAttribute('aria-disabled')).toBe('true');
    expect(kit.$('.cg-count')?.textContent).toBe('через 24 с');
    await flush(() => vi.advanceTimersByTime(4_000));
    expect(kit.$('.cg-count')?.textContent).toBe('через 20 с');
    await flush(() => vi.advanceTimersByTime(20_100));
    expect(now()).toBeGreaterThan(retryAt);
    expect(kit.$('.cg-count')).toBeNull();
    expect(kit.$('.cg-card__acts .cg-btn')?.hasAttribute('aria-disabled')).toBe(false);
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[ER-005] the actions row as §4.8 draws it: «Повторить», the countdown right after it, and ONE «Скопировать код» — the controller’s own copy action is not a second button', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kitNow());
    const error = cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { retryAt: kitNow() + 24_000 });
    // What a controller builds from the registry: the recovery first, «Скопировать код» last.
    const actions = [
      button('common.retry', { type: 'Regenerate', operationId: '00000000-0000-4000-8000-000000000101' }, { enabled: false, reason: reason('wait-until', { n: 24 }) }),
      button('common.copyCode', { type: 'CopyReport', scope: 'error', code: 'CG-PROVIDER-RATE-LIMIT' }),
    ];
    kit = await mountKitSettled(() => <ErrorCard error={error} tone="failure" actions={actions} />, { now: () => Date.now() });
    const row = [...(kit.$('.cg-card__acts') as HTMLElement).children].filter((node) => node.matches('.cg-btn, .cg-count')).map((node) => node.textContent);
    expect(row).toEqual(['Повторить', 'через 24 с', 'Скопировать код']);
    // Where the card has no copy button of its own (the clipboard itself failed), the controller's action stays.
    kit.unmount();
    kit = await mountKitSettled(() => <ErrorCard error={error} tone="failure" actions={actions} copyCode={false} />, { now: () => Date.now() });
    expect(kit.$$('.cg-card__acts .cg-btn').map((node) => node.textContent)).toEqual(['Повторить', 'Скопировать код']);
  });

  it('the daily quota counts to its reset in hours and minutes, never as a time of day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(kitNow());
    const error = cgError(ctx, 'CG-QUOTA-DAILY', { retryAt: kitNow() + (17 * 60 + 39) * 60_000 + 30_000 });
    kit = await mountKitSettled(() => <ErrorCard error={error} tone="state" />, { now: () => Date.now() });
    expect(kit?.$('.cg-count')?.textContent).toBe('До обновления 17 ч 39 мин');
  });
});

function kitNow(): number {
  return Date.UTC(2026, 9, 3, 6, 20, 0);
}

describe('the status banner (ui-design §4.10)', () => {
  it('code, **title.** and explanation in one row with one line button; role=status', async () => {
    const error = cgError(ctx, 'CG-HUB-UNAVAILABLE');
    kit = mountKit(() => <StatusBanner error={error} dot="danger" action={button('common.retry', { type: 'RecheckStatus' })} />);
    const banner = kit.$('.cg-banner') as HTMLElement;
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.querySelector('.cg-code')?.textContent).toBe('ChatGoose · CG-HUB-UNAVAILABLE');
    expect(banner.querySelector('b')?.textContent).toBe('Хаб недоступен.');
    expect(banner.querySelector('.cg-btn--line')?.textContent).toBe('Повторить');
    await flush(() => (banner.querySelector('.cg-btn') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'RecheckStatus' }]);
  });

  it('a state banner without a button keeps its ring', () => {
    kit = mountKit(() => (
      <>
        <StatusBanner error={{ ...cgError(ctx, 'CG-GATE-FAN-BLOCKED'), title: 'Фан заблокирован.' }} dot="ring" />
        <StatusBanner error={cgError(ctx, 'CG-HOST-CONTRACT')} dot={null} />
        <CodeLine code="CG-UNKNOWN" dot="ring" />
      </>
    ));
    expect(kit.$$('.cg-banner')[0]?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(kit.$$('.cg-banner')[0]?.querySelector('b')?.textContent).toBe('Фан заблокирован.');
    expect(kit.$$('.cg-banner')[1]?.querySelector('.cg-dot')).toBeNull();
    expect(kit.$$('.cg-banner .cg-btn')).toHaveLength(0);
  });
});

describe('[ER-025] the seven view states: an error is never an empty list', () => {
  it('loading, empty, partial, error, forbidden and offline each look like themselves', () => {
    kit = mountKit(() => (
      <>
        <ViewState view={views.loading(null, { key: 'result.stage.context' })}>
          <i>never</i>
        </ViewState>
        <ViewState view={views.loading()} keepWhileLoading>
          <i class="cg-kept">kept</i>
        </ViewState>
        <ViewState view={views.empty({ key: 'spenders.empty' })} />
        <ViewState view={views.partial({ kind: 'coverage', level: 'partial' }, { kind: 'coverage', level: 'unknown' }, { kind: 'truncated', shown: 1000, total: null })}>
          <i class="cg-rows">rows</i>
        </ViewState>
        <ViewState view={views.error(cgError(ctx, 'CG-HUB-TIMEOUT'), { type: 'ReloadView', selector: { of: 'spenders.board' } })} />
        <ViewState view={views.forbidden(cgError(ctx, 'CG-AUTH-REQUIRED'), { type: 'OpenSettings', route: { section: 'status' } })} />
        <ViewState view={views.ready()}>
          <i class="cg-ready">ready</i>
        </ViewState>
      </>
    ));
    expect(kit.$('.cg-state--loading')?.textContent).toBe('Читаю переписку…');
    expect(kit.$('.cg-kept')).not.toBeNull();
    expect(kit.$('.cg-state--empty')?.getAttribute('role')).toBe('status');
    expect(kit.$('.cg-rows')).not.toBeNull();
    expect(kit.$('.cg-state--gaps')?.textContent).toBe('охват неполный · охват неизвестен');
    const cards = kit.$$('.cg-card');
    expect(cards.map((card) => card.getAttribute('data-cg-code'))).toEqual(['CG-HUB-TIMEOUT', 'CG-AUTH-REQUIRED']);
    expect(cards[0]?.querySelector('.cg-dot--danger')).not.toBeNull();
    expect(cards[1]?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(cards.map((card) => card.querySelector('.cg-btn')?.textContent)).toEqual(['Повторить', 'Настройки']);
    expect(kit.$('.cg-ready')).not.toBeNull();
  });

  it('a remedy is labelled by what it does', () => {
    expect(remedyLabelKey({ type: 'ReloadTab' })).toBe('common.reloadTab');
    expect(remedyLabelKey({ type: 'Navigate', to: { kind: 'next-unread' } })).toBe('common.openChat');
    expect(remedyLabelKey({ type: 'RecheckStatus' })).toBe('common.retry');
  });
});
