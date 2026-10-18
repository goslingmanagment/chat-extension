// The tab's gate of «Запись — только по доверенному действию» (§14):
// tab/action-gate.ts. A browser marks its own events `isTrusted` and nothing
// else can; here a trusted event is a synthetic one with that flag forced on.

import type { Surface } from '@cg/contracts/features';
import { BATCH_LIMITS } from '@cg/contracts/vm';
import { createShadowRootRegistry } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { GRANTED_KINDS, GRANT_TTL_MS, KEPT_KEY_MAX_AGE_MS, createActionTokens, createGestureGate, gestureRefusal, onScreen, type ActionKind, type GateEnv, type GestureRefusal } from './action-gate';

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
    element.setAttribute('data-host', kind);
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
        dock: { host: dock.host, root: dock.root },
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

  function seam(now: () => number = () => Date.now()) {
    const w = (current = world());
    const gate = createGestureGate(window, w.env, now);
    const asked: Array<[ActionKind, Surface]> = [];
    const spent: unknown[] = [];
    const refused: GestureRefusal[] = [];
    const ungranted: string[] = [];
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
      onUngranted: (facts) => ungranted.push(`${facts.action}:${facts.refusal}`),
    });
    return { w, gate, tokens, redeem, asked, spent, refused, ungranted };
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

  it('[PU-017] [ST-076] a click on an extension page brought here by the background: one navigation token, never an insert, a send or a generation', async () => {
    const s = seam();
    // Without the background's word nothing is granted: no event of this document stands behind the request.
    expect(await s.tokens.issue('navigate', 'overlay')).toBeNull();
    s.tokens.vouched();
    expect(await s.tokens.issue('insert', 'dock')).toBeNull();
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    expect(await s.tokens.issue('navigate', 'overlay')).toBe('token-1-0123456789abcdef');
    // Once: a second navigation needs a second click.
    expect(await s.tokens.issue('navigate', 'overlay')).toBeNull();
    expect(s.asked).toEqual([['navigate', 'overlay']]);
    s.gate.dispose();
  });

  it('a vouched grant is as short-lived as a click’s: after ten seconds it gives nothing', async () => {
    let clock = 1_000_000;
    const s = seam(() => clock);
    s.tokens.vouched();
    clock += GRANT_TTL_MS + 1;
    expect(await s.tokens.issue('navigate', 'overlay')).toBeNull();
    expect(s.asked).toEqual([]);
    s.gate.dispose();
  });

  it('1.32.0 «Сгенерировать для N»: one click of a list gives its batch generate tokens over minutes — counted, never another kind', async () => {
    let clock = 1_000_000;
    const s = seam(() => clock);
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('GenerateBatch'));
    // Later, from the queue: no event is in flight, the batch's grant answers.
    clock += 60_000;
    expect(await s.tokens.issue('generate', 'preview')).toBe('token-1-0123456789abcdef');
    expect(await s.tokens.issue('generate', 'newcomers')).toBe('token-2-0123456789abcdef');
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    expect(await s.tokens.issue('insert', 'dock')).toBeNull();
    for (let n = 2; n < BATCH_LIMITS.grantTokens; n += 1) await s.tokens.issue('generate', 'preview');
    expect(await s.tokens.issue('generate', 'preview')).toBeNull();
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('GenerateBatch'));
    clock += BATCH_LIMITS.grantTtlMs + 1;
    expect(await s.tokens.issue('generate', 'preview')).toBeNull();
    s.gate.dispose();
  });

  it('the background’s own refusal comes back as its reason; no answer and no human action are «no token»', async () => {
    const w = (current = world());
    const gate = createGestureGate(window, w.env);
    let answer: string | null | { readonly error: { readonly code: 'CG-FEATURE-DISABLED'; readonly detail: string } } = { error: { code: 'CG-FEATURE-DISABLED', detail: 'bootstrap_expired' } };
    const { tokens } = createActionTokens({ gate, request: () => Promise.resolve(answer), spend: () => Promise.resolve(true) });
    expect(await during(w.dockButton, event('click', true), () => tokens.ask('insert', 'dock'))).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'bootstrap_expired' } });
    answer = null;
    expect(await during(w.dockButton, event('click', true), () => tokens.ask('insert', 'dock'))).toEqual({ ok: false, error: null });
    expect(await tokens.ask('insert', 'dock')).toEqual({ ok: false, error: null });
    answer = 'token-9-0123456789abcdef';
    expect(await during(w.dockButton, event('click', true), () => tokens.ask('insert', 'dock'))).toEqual({ ok: true, actionToken: 'token-9-0123456789abcdef' });
    gate.dispose();
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

  // ── grants: the action a person's click or key dispatched asks for its token after it read the page ──

  it('[BG-001] [AI-120] an action dispatched in the click gets its token later — once, and only of the kinds its type may need', async () => {
    const s = seam();
    // The AppClient takes the action in the step of the click; the controller reads the draft and only then asks.
    const late = during(s.w.dockButton, event('click', true), async () => {
      s.tokens.granted('InsertPart');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return s.tokens.issue('insert', 'dock');
    });
    expect(await late).toBe('token-1-0123456789abcdef');
    // The grant is spent: the same action gets no second insert, and it never covered another kind.
    expect(await s.tokens.issue('insert', 'dock')).toBeNull();
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    expect(s.asked).toEqual([['insert', 'dock']]);
    expect(s.refused).toEqual(['over', 'over', 'over']);
    s.gate.dispose();
  });

  it('[BG-001] a grant covers only what its action may need: a Generate click never inserts, navigates or sends', async () => {
    const s = seam();
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('Generate'));
    await Promise.resolve();
    for (const [kind, surface] of [['insert', 'preview'], ['navigate', 'preview'], ['send', 'preview']] as const) expect(await s.tokens.issue(kind, surface)).toBeNull();
    expect(await s.tokens.issue('generate', 'preview')).toBe('token-1-0123456789abcdef');
    expect(s.asked).toEqual([['generate', 'preview']]);
    s.gate.dispose();
  });

  it('[BG-001] every action that may write is in the table, and nothing else opens a grant', () => {
    expect(Object.fromEntries(Object.entries(GRANTED_KINDS).map(([action, kinds]) => [action, [...kinds]]))).toEqual({
      Generate: ['generate'],
      Regenerate: ['generate'],
      RefreshRecap: ['generate'],
      InsertPart: ['insert'],
      ReplaceMyDraft: ['insert'],
      RestoreMyDraft: ['insert'],
      AnswerConfirm: ['insert'],
      OpenAndInsertPart: ['navigate'],
      OpenChatToVerify: ['navigate'],
      Navigate: ['navigate'],
      SendPart: ['send'],
      SendNewcomerGreeting: ['send'],
      InsertNewcomerGreeting: ['navigate'],
    });
    const s = seam();
    // A view switch asks for nothing, with or without a person behind it.
    expect(s.gate.open('Copy')).toBeNull();
    expect(s.gate.open('ShowAnalysis')).toBeNull();
    expect(s.gate.claim('insert', 'dock')).toBe('not-granted');
    s.gate.dispose();
  });

  it('[BG-001] [AI-120] an action nobody clicked opens no grant: a synthetic click, a timer, the end of a stream', async () => {
    const s = seam();
    during(s.w.dockButton, event('click', false), () => s.tokens.granted('InsertPart'));
    s.tokens.granted('Generate');
    const pressed = event('click', true);
    during(s.w.dockButton, pressed, () => undefined);
    // The click is over: an action dispatched after it has nobody behind it.
    s.tokens.granted('SendPart');
    expect(s.ungranted).toEqual(['InsertPart:no-gesture', 'Generate:no-gesture', 'SendPart:over']);
    for (const kind of ['insert', 'generate', 'send'] as const) expect(await s.tokens.issue(kind, 'dock')).toBeNull();
    expect(s.asked).toEqual([]);
    s.gate.dispose();
  });

  it('[AI-120] a send is granted to a click through its own surface only — a key press dispatching SendPart gets nothing', async () => {
    const s = seam();
    during(s.w.overlayButton, event('keydown', true), () => s.tokens.granted('SendPart'));
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('SendPart'));
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('SendPart'));
    expect(await s.tokens.issue('send', 'preview')).toBe('token-1-0123456789abcdef');
    expect(s.asked).toEqual([['send', 'preview']]);
    s.gate.dispose();
  });

  it('[NF-019] [FS-NEW-3] a «Новые» card asks after its draft is written and read: «Отправить» clicked in its window gets ONE send, «Открыть и вставить» a navigation; a key press sends nothing', async () => {
    const s = seam();
    during(s.w.overlayButton, event('keydown', true), () => s.tokens.granted('SendNewcomerGreeting'));
    expect(await s.tokens.issue('send', 'newcomers')).toBeNull();
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('SendNewcomerGreeting'));
    // The click is over by the time the card has written and read its draft: the grant still holds its one send.
    await Promise.resolve();
    expect(await s.tokens.issue('navigate', 'newcomers')).toBeNull();
    expect(await s.tokens.issue('send', 'newcomers')).toBe('token-1-0123456789abcdef');
    expect(await s.tokens.issue('send', 'newcomers')).toBeNull();
    during(s.w.overlayButton, event('click', true), () => s.tokens.granted('InsertNewcomerGreeting'));
    await Promise.resolve();
    expect(await s.tokens.issue('send', 'newcomers')).toBeNull();
    expect(await s.tokens.issue('navigate', 'newcomers')).toBe('token-2-0123456789abcdef');
    expect(s.asked).toEqual([['send', 'newcomers'], ['navigate', 'newcomers']]);
    expect(s.ungranted).toEqual([]);
    s.gate.dispose();
  });

  it('a grant does not outlive its time, and the surface must still be on screen when the token is asked for', async () => {
    let now = 1_000_000;
    const s = seam(() => now);
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('Generate'));
    now += GRANT_TTL_MS + 1;
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('Generate'));
    now += GRANT_TTL_MS;
    // The chat was closed while the controller was reading: no dock, no token.
    s.w.dockKind = 'none';
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    s.w.dockKind = 'in-flow';
    expect(await s.tokens.issue('generate', 'dock')).toBe('token-1-0123456789abcdef');
    expect(s.refused).toEqual(['expired', 'not-mounted']);
    s.gate.dispose();
  });

  it('two clicks, two grants: the token of the first is not taken by the second action, and the newest grant answers first', async () => {
    const s = seam();
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('InsertPart'));
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('Generate'));
    expect(await s.tokens.issue('generate', 'dock')).toBe('token-1-0123456789abcdef');
    expect(await s.tokens.issue('insert', 'dock')).toBe('token-2-0123456789abcdef');
    expect(await s.tokens.issue('insert', 'dock')).toBeNull();
    s.gate.dispose();
  });

  // ── a key the early dispatcher kept (HK-024, HK-025) ──

  it('[HK-024] a kept key runs after its keydown is over: handed back, it opens the grant of its action — once, within its freshness', async () => {
    let now = 5_000_000;
    const s = seam(() => now);
    const pressed = event('keydown', true);
    during(s.w.pageField, pressed, () => undefined);
    const at = now;
    now += 1200;
    // Not handed back: the keydown is over, and that is all the gate knows.
    s.tokens.granted('Generate');
    expect(s.ungranted).toEqual(['Generate:over']);
    expect(s.gate.cause()).toBe('click');
    const release = s.gate.resume(pressed, at);
    expect(s.gate.cause()).toBe('key');
    s.tokens.granted('Generate');
    release();
    expect(await s.tokens.issue('generate', 'dock')).toBe('token-1-0123456789abcdef');
    // After the hand-over the key is over again.
    s.tokens.granted('Generate');
    expect(s.ungranted).toEqual(['Generate:over', 'Generate:over']);
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    s.gate.dispose();
  });

  it('[HK-024] only a trusted keydown that is still fresh is taken back; a kept key never sends', async () => {
    let now = 5_000_000;
    const s = seam(() => now);
    const forged = event('keydown', false);
    s.gate.resume(forged, now)();
    const click = event('click', true);
    during(s.w.dockButton, click, () => undefined);
    const releaseClick = s.gate.resume(click, now);
    s.tokens.granted('Generate');
    releaseClick();
    const old = event('keydown', true);
    during(s.w.pageField, old, () => undefined);
    const stale = s.gate.resume(old, now - KEPT_KEY_MAX_AGE_MS - 1);
    s.tokens.granted('Generate');
    stale();
    expect(await s.tokens.issue('generate', 'dock')).toBeNull();
    const fresh = event('keydown', true);
    during(s.w.pageField, fresh, () => undefined);
    const release = s.gate.resume(fresh, now);
    s.tokens.granted('SendPart');
    release();
    now += 10;
    expect(await s.tokens.issue('send', 'preview')).toBeNull();
    expect(s.asked).toEqual([]);
    s.gate.dispose();
  });

  it('the kind of the action in flight is its cause: a key press is `key`, a click — and nothing at all — is `click`', () => {
    const s = seam();
    expect(s.gate.cause()).toBe('click');
    expect(during(s.w.pageField, event('keydown', true), () => s.gate.cause())).toBe('key');
    expect(during(s.w.dockButton, event('click', true), () => s.gate.cause())).toBe('click');
    expect(s.gate.cause()).toBe('click');
    s.gate.dispose();
  });
});
