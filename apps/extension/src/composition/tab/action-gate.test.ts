// The tab's gate of «Запись — только по доверенному действию» (§14):
// tab/action-gate.ts. A browser marks its own events `isTrusted` and nothing
// else can; here a trusted event is a synthetic one with that flag forced on.

import type { Surface } from '@cg/contracts/features';
import { createShadowRootRegistry } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { createActionTokens, createGestureGate, gestureRefusal, onScreen, type ActionKind, type GateEnv, type GestureRefusal } from './action-gate';

type DockKind = 'in-flow' | 'fixed-overlay' | 'copy-only-row' | 'none';

interface World {
  readonly env: GateEnv;
  readonly dockButton: HTMLButtonElement;
  readonly overlayButton: HTMLButtonElement;
  readonly pageField: HTMLElement;
  readonly hidden: Set<Element>;
  dockKind: DockKind;
  visibility: DocumentVisibilityState;
  dispose(): void;
}

/** The page with the dock in its closed root, one overlay host (a window, the preview) and a field of the page's own. */
function world(): World {
  const registry = createShadowRootRegistry();
  const host = (kind: string): { host: HTMLElement; root: ShadowRoot; button: HTMLButtonElement } => {
    const element = document.createElement('div');
    element.setAttribute('data-cg', kind);
    const root = element.attachShadow({ mode: 'closed' });
    registry.register(element, root);
    const button = document.createElement('button');
    root.append(button);
    document.body.append(element);
    return { host: element, root, button };
  };
  const dock = host('dock');
  const overlay = host('overlay');
  const pageField = document.createElement('div');
  document.body.append(pageField);
  const hidden = new Set<Element>();
  const state: World = {
    dockButton: dock.button,
    overlayButton: overlay.button,
    pageField,
    hidden,
    dockKind: 'in-flow',
    visibility: 'visible',
    env: {
      doc: {
        get visibilityState() {
          return state.visibility;
        },
      } as Document,
      mounts: {
        dock: { host: dock.host, root: dock.root, remove: () => dock.host.remove() },
        registry,
        points: () => ({ dock: { kind: state.dockKind, composerInstanceId: null, width: 600 }, overlay: { ready: true, container: null } }),
      },
      // No layout in this DOM: an element is on screen while it is connected and not marked hidden.
      visible: (element) => element.isConnected && !hidden.has(element),
    },
    dispose() {
      dock.host.remove();
      overlay.host.remove();
      pageField.remove();
    },
  };
  return state;
}

function event(type: 'click' | 'keydown' | 'pointerdown', trusted: boolean): Event {
  const created = type === 'keydown' ? new KeyboardEvent(type, { bubbles: true, composed: true, code: 'KeyE' }) : new MouseEvent(type, { bubbles: true, composed: true });
  if (trusted) Object.defineProperty(created, 'isTrusted', { value: true });
  return created;
}

/** Dispatches `created` at `target` and runs `during` from a listener on the target — the step a UI handler runs in. */
function during<T>(target: EventTarget, created: Event, run: (event: Event) => T): T {
  let out: { value: T } | null = null;
  const listener = (seen: Event): void => {
    out = { value: run(seen) };
  };
  target.addEventListener(created.type, listener);
  target.dispatchEvent(created);
  target.removeEventListener(created.type, listener);
  if (out === null) throw new Error('the listener did not run');
  return (out as { value: T }).value;
}

describe('the gesture an action token is asked for', () => {
  let current: World | null = null;
  const make = (): World => (current = world());
  afterEach(() => {
    current?.dispose();
    current = null;
  });

  const refusalOf = (w: World, target: EventTarget, created: Event, kind: ActionKind, surface: Surface): GestureRefusal | null =>
    during(target, created, (seen) => gestureRefusal(seen, kind, surface, w.env));

  it('[BG-001] [AI-120] a trusted click in the dock allows a generation, an insert and a navigation of the dock', () => {
    const w = make();
    for (const kind of ['generate', 'insert', 'navigate'] as const) expect(refusalOf(w, w.dockButton, event('click', true), kind, 'dock')).toBeNull();
  });

  it('[BG-001] [AI-120] a synthetic click gets nothing: dispatchEvent is not a human', () => {
    const w = make();
    for (const kind of ['generate', 'insert', 'navigate', 'send'] as const) {
      expect(refusalOf(w, w.dockButton, event('click', false), kind, 'dock')).toBe('untrusted');
      expect(refusalOf(w, w.overlayButton, event('click', false), kind, 'preview')).toBe('untrusted');
    }
  });

  it('[BG-001] an event whose dispatch is over allows nothing: a timer, a toast or a stream end cannot reuse the click', () => {
    const w = make();
    const click = event('click', true);
    expect(refusalOf(w, w.dockButton, click, 'generate', 'dock')).toBeNull();
    expect(gestureRefusal(click, 'insert', 'dock', w.env)).toBe('over');
    expect(gestureRefusal(null, 'insert', 'dock', w.env)).toBe('no-gesture');
  });

  it('only a click or a key press is an action', () => {
    const w = make();
    expect(refusalOf(w, w.dockButton, event('pointerdown', true), 'generate', 'dock')).toBe('not-a-gesture');
  });

  it('a click outside our roots is not ours; a key press there is (AI hotkeys work in the native composer)', () => {
    const w = make();
    expect(refusalOf(w, w.pageField, event('click', true), 'generate', 'dock')).toBe('outside');
    expect(refusalOf(w, w.pageField, event('keydown', true), 'generate', 'dock')).toBeNull();
    expect(refusalOf(w, w.pageField, event('keydown', false), 'generate', 'dock')).toBe('untrusted');
  });

  it('[AI-120] a preview send is a click through the surface it is sent from — never a key press, never another root', () => {
    const w = make();
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'preview')).toBeNull();
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'newcomers')).toBeNull();
    expect(refusalOf(w, w.overlayButton, event('keydown', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.pageField, event('keydown', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.dockButton, event('click', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'dock')).toBe('outside');
  });

  it('a window of ours may start an action of the dock (the palette), while the dock is on screen', () => {
    const w = make();
    expect(refusalOf(w, w.overlayButton, event('click', true), 'generate', 'dock')).toBeNull();
    w.dockKind = 'none';
    expect(refusalOf(w, w.overlayButton, event('click', true), 'generate', 'dock')).toBe('not-mounted');
    expect(refusalOf(w, w.pageField, event('keydown', true), 'generate', 'dock')).toBe('not-mounted');
  });

  it('the surface must be visible and working: a hidden document, a hidden root, a dock that is not placed', () => {
    const w = make();
    w.visibility = 'hidden';
    expect(refusalOf(w, w.dockButton, event('click', true), 'insert', 'dock')).toBe('document-hidden');
    w.visibility = 'visible';
    w.hidden.add(w.env.mounts.dock.host);
    expect(refusalOf(w, w.dockButton, event('click', true), 'insert', 'dock')).toBe('surface-hidden');
    // The key press came from the page, the dock it is for is hidden.
    expect(refusalOf(w, w.pageField, event('keydown', true), 'generate', 'dock')).toBe('not-mounted');
    w.hidden.clear();
    w.env.mounts.dock.host.remove();
    expect(refusalOf(w, w.pageField, event('keydown', true), 'generate', 'dock')).toBe('not-mounted');
  });

  it('the default visibility test asks the element: a detached one is never on screen', () => {
    expect(onScreen(document.createElement('div'))).toBe(false);
  });
});

describe('the action tokens of a tab', () => {
  let current: World | null = null;
  afterEach(() => {
    current?.dispose();
    current = null;
  });

  function seam() {
    const w = (current = world());
    const gate = createGestureGate(window, w.env);
    const asked: Array<[ActionKind, Surface]> = [];
    const spent: unknown[] = [];
    const refused: GestureRefusal[] = [];
    let serial = 0;
    const { tokens, redeem } = createActionTokens({
      gate,
      request(kind, surface) {
        asked.push([kind, surface]);
        serial += 1;
        return Promise.resolve(`token-${serial}-0123456789abcdef`);
      },
      spend(request) {
        spent.push(request);
        return Promise.resolve(true);
      },
      onRefused: (facts) => refused.push(facts.refusal),
    });
    return { w, gate, tokens, redeem, asked, spent, refused };
  }

  it('[BG-001] [AI-120] a synthetic dispatchEvent click gets no token and the background is not asked', async () => {
    const s = seam();
    const token = await during(s.w.dockButton, event('click', false), () => s.tokens.issue('generate', 'dock'));
    expect(token).toBeNull();
    expect(s.asked).toEqual([]);
    expect(s.refused).toEqual(['no-gesture']);
    s.gate.dispose();
  });

  it('[BG-001] a trusted click in the dock gets one token of a kind, asked for in the step of the click', async () => {
    const s = seam();
    const [first, second, insert] = await during(s.w.dockButton, event('click', true), () => Promise.all([s.tokens.issue('generate', 'dock'), s.tokens.issue('generate', 'dock'), s.tokens.issue('insert', 'dock')]));
    expect(first).toBe('token-1-0123456789abcdef');
    expect(second).toBeNull();
    expect(insert).toBe('token-2-0123456789abcdef');
    expect(s.asked).toEqual([['generate', 'dock'], ['insert', 'dock']]);
    expect(s.refused).toEqual(['spent']);
    s.gate.dispose();
  });

  it('[BG-001] nothing that runs after the click gets a token: a timer, a continuation after an await, the end of a stream', async () => {
    const s = seam();
    const late = during(s.w.dockButton, event('click', true), async () => {
      await Promise.resolve();
      return s.tokens.issue('insert', 'dock');
    });
    expect(await late).toBeNull();
    expect(await new Promise<string | null>((resolve) => setTimeout(() => void s.tokens.issue('send', 'preview').then(resolve), 0))).toBeNull();
    expect(s.asked).toEqual([]);
    expect(s.refused).toEqual(['over', 'over']);
    s.gate.dispose();
  });

  it('a synthetic event inside a human click does not take its place', async () => {
    const s = seam();
    const token = await during(s.w.dockButton, event('click', true), () => {
      s.w.pageField.dispatchEvent(event('click', false));
      return s.tokens.issue('generate', 'dock');
    });
    expect(token).toBe('token-1-0123456789abcdef');
    s.gate.dispose();
  });

  it('the hotkey dispatcher hands a key press in; a disposed gate sees nothing', async () => {
    const s = seam();
    s.gate.dispose();
    const press = event('keydown', true);
    expect(await during(s.w.pageField, press, () => s.tokens.issue('generate', 'dock'))).toBeNull();
    const again = event('keydown', true);
    expect(
      await during(s.w.pageField, again, (seen) => {
        s.tokens.noteGesture(seen);
        return s.tokens.issue('generate', 'dock');
      }),
    ).toBe('token-1-0123456789abcdef');
  });

  it('a write spends the token for the surface it was issued for, once; a token this tab did not issue is not spent', async () => {
    const s = seam();
    const token = await during(s.w.overlayButton, event('click', true), () => s.tokens.issue('insert', 'coach'));
    const intentId = '00000000-0000-4000-8000-000000000001';
    expect(await s.redeem({ kind: 'insert', actionToken: token ?? '', intentId })).toBe(true);
    expect(s.spent).toEqual([{ kind: 'insert', surface: 'coach', actionToken: token, intentId }]);
    expect(await s.redeem({ kind: 'insert', actionToken: token ?? '', intentId })).toBe(false);
    expect(await s.redeem({ kind: 'navigate', actionToken: 'token-x-0123456789abcdef', intentId })).toBe(false);
    expect(s.spent).toHaveLength(1);
    s.gate.dispose();
  });
});
