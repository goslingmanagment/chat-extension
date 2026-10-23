// The tab's gate of «Запись — только по доверенному действию» (§14):
// tab/action-gate.ts. A browser marks its own events `isTrusted` and nothing
// else can; here a trusted event is a synthetic one with that flag forced on.

import type { Surface } from '@cg/contracts/features';
import { createShadowRootRegistry } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { GRANTED_KINDS, GRANT_TTL_MS, KEPT_KEY_MAX_AGE_MS, createActionTokens, createGestureGate, gestureRefusal, type ActionKind, type GateEnv, type GestureRefusal } from './action-gate';

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

  it('[AI-120] a preview send is a click through the surface it is sent from — never a key press, never another root', () => {
    const w = make();
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'preview')).toBeNull();
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'newcomers')).toBeNull();
    expect(refusalOf(w, w.overlayButton, event('keydown', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.pageField, event('keydown', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.dockButton, event('click', true), 'send', 'preview')).toBe('outside');
    expect(refusalOf(w, w.overlayButton, event('click', true), 'send', 'dock')).toBe('outside');
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
      SetRecap: ['generate'],
      RefreshRecap: ['generate'],
      InsertPart: ['insert'],
      ReplaceMyDraft: ['insert'],
      RestoreMyDraft: ['insert'],
      AnswerConfirm: ['insert'],
      OpenAndInsertPart: ['navigate'],
      OpenChatToVerify: ['navigate'],
      Navigate: ['navigate'],
      SendPart: ['send'],
      SendDraft: ['send'],
      SendNewcomerGreeting: ['send'],
      InsertNewcomerGreeting: ['navigate'],
      SendOutreach: ['send'],
      GreetNewcomer: ['generate'],
      ShowVoice: ['generate'],
      WriteVoiceScript: ['generate'],
      NewVoice: ['generate'],
      MakeVoiceTake: ['generate'],
      CheckVoiceTake: ['generate'],
      AttachVoiceTake: ['insert'],
      ClearVoiceDraft: ['insert'],
      RestoreVoiceDraft: ['insert'],
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

  // ── X68: the Fix of a click writes its own result later ──

  it('[X68] a Fix clicked in the dock leaves ONE deferred insert for the dock, asked for when it is done — long after the click', async () => {
    let now = 1_000_000;
    const s = seam(() => now);
    during(s.w.dockButton, event('click', true), () => s.tokens.granted('Generate', true));
    expect(await s.tokens.issue('generate', 'dock')).toBe('token-1-0123456789abcdef');
    // An ordinary request never takes the deferred insert.
    expect(await s.tokens.issue('insert', 'dock')).toBeNull();
    now += GRANT_TTL_MS + 30_000;
    expect(await s.tokens.ask('insert', 'preview', true)).toEqual({ ok: false, error: null });
    expect(await s.tokens.ask('insert', 'dock', true)).toEqual({ ok: true, actionToken: 'token-2-0123456789abcdef' });
    // One write: the grant is gone.
    expect(await s.tokens.ask('insert', 'dock', true)).toEqual({ ok: false, error: null });
    expect(s.asked).toEqual([['generate', 'dock'], ['insert', 'dock']]);
    s.gate.dispose();
  });

  // ── a key the early dispatcher kept (HK-024, HK-025) ──

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
});
