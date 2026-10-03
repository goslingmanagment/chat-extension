import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { type ActionReceipt, type UiAction, type ViewName, type ViewOf, type ViewSelector } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { UnservedViewError, ViewListeners, createAppRouter, type RouterFailure, type SurfaceController } from './router';

const errorOf = (code: CgCode): CgErrorView => ({ code, title: `title ${code}`, body: `body ${code}` });

/** A controller whose views are plain markers: the router never looks inside a view model. */
function controller(kinds: readonly ViewName[], takes: readonly UiAction['type'][] = []): SurfaceController & { emit(selector: ViewSelector, value: string): void; calls: string[]; subscribers(): number } {
  const views = new ViewListeners();
  const calls: string[] = [];
  let live = 0;
  return {
    kinds,
    calls,
    getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
      calls.push(`snapshot:${selector.of}`);
      return `snapshot of ${selector.of}` as unknown as Readonly<ViewOf<S>>;
    },
    subscribe(selector, listener) {
      live += 1;
      const off = views.add(selector, listener);
      return () => {
        live -= 1;
        off();
      };
    },
    dispatch(action) {
      if (!takes.includes(action.type)) return null;
      calls.push(`dispatch:${action.type}`);
      return Promise.resolve<ActionReceipt>({ ok: true, type: action.type, outcome: 'done' });
    },
    emit(selector, value) {
      views.notify(selector, value as unknown as Readonly<ViewOf<typeof selector>>);
    },
    subscribers: () => live,
  };
}

const DOCK = { of: 'dock' } as const;
const TOASTS = { of: 'toasts' } as const;
const CANCEL: UiAction = { type: 'CancelGeneration', operationId: '00000000-0000-4000-8000-000000000001' };

describe('createAppRouter', () => {
  it('routes a snapshot, a subscription and an action to the controller of the view', async () => {
    const router = createAppRouter({ errorOf });
    const dock = controller(['dock'], ['CancelGeneration']);
    router.register(dock);
    expect(router.getSnapshot(DOCK)).toBe('snapshot of dock');
    const seen: unknown[] = [];
    const off = router.subscribe(DOCK, (view) => seen.push(view));
    dock.emit(DOCK, 'dock v2');
    expect(seen).toEqual(['dock v2']);
    off();
    dock.emit(DOCK, 'dock v3');
    expect(seen).toEqual(['dock v2']);
    expect(dock.subscribers()).toBe(0);
    await expect(router.dispatch(CANCEL)).resolves.toEqual({ ok: true, type: 'CancelGeneration', outcome: 'done' });
    expect(router.serves('dock')).toBe(true);
    expect(router.serves('coach')).toBe(false);
    expect(router.views()).toEqual(['dock']);
  });

  it('a snapshot of a view nobody serves is a wiring error, not an empty view', () => {
    const router = createAppRouter({ errorOf });
    expect(() => router.getSnapshot(DOCK)).toThrow(UnservedViewError);
  });

  it('a subscription made before its controller hears the first snapshot when the controller plugs in', () => {
    const router = createAppRouter({ errorOf });
    const seen: unknown[] = [];
    router.subscribe(DOCK, (view) => seen.push(view));
    expect(seen).toEqual([]);
    const dock = controller(['dock']);
    router.register(dock);
    expect(seen).toEqual(['snapshot of dock']);
    dock.emit(DOCK, 'dock v2');
    expect(seen).toEqual(['snapshot of dock', 'dock v2']);
  });

  it('one controller per view: a second one for the same view throws at registration', () => {
    const router = createAppRouter({ errorOf });
    router.register(controller(['dock', 'toasts']));
    expect(() => router.register(controller(['toasts']))).toThrow(/already served: toasts/);
    expect(() => router.register(controller(['coach', 'coach']))).toThrow(/twice/);
    expect(router.views()).toEqual(['dock', 'toasts']);
  });

  it('a replaced controller: subscribers wait and follow the next one', () => {
    const router = createAppRouter({ errorOf });
    const first = controller(['dock']);
    const unplug = router.register(first);
    const seen: unknown[] = [];
    router.subscribe(DOCK, (view) => seen.push(view));
    unplug();
    expect(first.subscribers()).toBe(0);
    expect(router.serves('dock')).toBe(false);
    first.emit(DOCK, 'late');
    expect(seen).toEqual([]);
    const second = controller(['dock']);
    router.register(second);
    second.emit(DOCK, 'second v2');
    expect(seen).toEqual(['snapshot of dock', 'second v2']);
  });

  it('an action goes to the first controller that takes it, in registration order', async () => {
    const router = createAppRouter({ errorOf });
    const a = controller(['dock']);
    const b = controller(['toasts'], ['CancelGeneration']);
    const c = controller(['coach'], ['CancelGeneration']);
    router.register(a);
    router.register(b);
    router.register(c);
    await router.dispatch(CANCEL);
    expect(b.calls).toEqual(['dispatch:CancelGeneration']);
    expect(c.calls).toEqual([]);
  });

  it('an action nobody takes, or one whose controller fails, is a refusal with CG-UI-FAILED — never a rejection', async () => {
    const failures: RouterFailure[] = [];
    const router = createAppRouter({ errorOf, onFailure: (failure) => failures.push(failure) });
    await expect(router.dispatch(CANCEL)).resolves.toEqual({ ok: false, type: 'CancelGeneration', code: 'CG-UI-FAILED', error: errorOf('CG-UI-FAILED') });
    const throwing: SurfaceController = {
      kinds: ['dock'],
      getSnapshot: () => {
        throw new Error('boom');
      },
      subscribe: () => () => undefined,
      dispatch: () => {
        throw new Error('boom');
      },
    };
    const unplug = router.register(throwing);
    await expect(router.dispatch(CANCEL)).resolves.toMatchObject({ ok: false, code: 'CG-UI-FAILED' });
    unplug();
    router.register({ ...throwing, dispatch: () => Promise.reject(new Error('later')) });
    await expect(router.dispatch(CANCEL)).resolves.toMatchObject({ ok: false, code: 'CG-UI-FAILED' });
    expect(failures).toEqual([
      { kind: 'unhandled', action: 'CancelGeneration' },
      { kind: 'dispatch', action: 'CancelGeneration' },
      { kind: 'dispatch', action: 'CancelGeneration' },
    ]);
  });

  it('a listener that throws does not stop the others and is reported by its view', () => {
    const failures: RouterFailure[] = [];
    const router = createAppRouter({ errorOf, onFailure: (failure) => failures.push(failure) });
    const dock = controller(['dock']);
    router.register(dock);
    const seen: unknown[] = [];
    router.subscribe(DOCK, () => {
      throw new Error('surface bug');
    });
    router.subscribe(DOCK, (view) => seen.push(view));
    dock.emit(DOCK, 'dock v2');
    expect(seen).toEqual(['dock v2']);
    expect(failures).toEqual([{ kind: 'listener', view: 'dock' }]);
  });

  it('dispose drops every subscription and controller', () => {
    const router = createAppRouter({ errorOf });
    const dock = controller(['dock', 'toasts']);
    router.register(dock);
    const seen: unknown[] = [];
    router.subscribe(TOASTS, (view) => seen.push(view));
    router.dispose();
    dock.emit(TOASTS, 'late');
    expect(seen).toEqual([]);
    expect(dock.subscribers()).toBe(0);
    expect(router.views()).toEqual([]);
    expect(() => router.getSnapshot(TOASTS)).toThrow(UnservedViewError);
  });
});

describe('ViewListeners', () => {
  it('keeps listeners per selector (a preview from Spenders is not a preview from «Новые»)', () => {
    const views = new ViewListeners();
    const spenders: unknown[] = [];
    const newcomers: unknown[] = [];
    const off = views.add({ of: 'preview', from: 'spenders' }, (view) => spenders.push(view));
    views.add({ of: 'preview', from: 'newcomers' }, (view) => newcomers.push(view));
    views.notify({ of: 'preview', from: 'spenders' }, 'a' as never);
    expect([spenders, newcomers]).toEqual([['a'], []]);
    expect(views.has({ of: 'preview', from: 'spenders' })).toBe(true);
    off();
    expect(views.has({ of: 'preview', from: 'spenders' })).toBe(false);
    views.clear();
    expect(views.has({ of: 'preview', from: 'newcomers' })).toBe(false);
  });
});
