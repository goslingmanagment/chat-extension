// The tab's side of «Запись — только по доверенному действию» (architecture.md
// §14; BG-001, AI-120). The background issues an action token to any
// registered tab session that asks: it cannot see the event. So the tab asks
// only for a human action that is happening right now, and this file is the
// one place that decides what counts as one:
//
// - a TRUSTED (`isTrusted`) click or key press — a synthetic `dispatchEvent`
//   is not one;
// - that is still being dispatched: the token is asked for in the same
//   synchronous step as the action it allows, so no timer, toast callback,
//   stream `done` or late continuation of a controller can mint one;
// - in a visible document, through one of our own closed roots that is
//   itself connected and visible (clickjacking, §14) — or, for a key press
//   only, outside them: AI hotkeys work in the native composer (§9.1; the
//   hotkey dispatcher decides whose key it is and hands the event in);
// - for a surface that is mounted and visible;
// - a preview send is a click, through the surface it is sent from: there is
//   no hotkey for it (§9.1);
// - one token of a kind per event.
//
// The UI never passes an event anywhere: it dispatches a UiAction (§10.2). The
// gate therefore watches the events itself (`window`, capture: an event from
// inside a closed root shows its host there) and `issue` reads the one in
// flight. Whoever stops an event before `window`'s listeners of this chunk run
// (the early hotkey dispatcher) hands it in with `note`.

import type { Surface } from '@cg/contracts/features';
import type { MountManager } from '@cg/host-chatspace/isolated';

export type ActionKind = 'generate' | 'insert' | 'navigate' | 'send';

export type GestureRefusal =
  /** No click or key press is being handled. */
  | 'no-gesture'
  /** A synthetic event (`dispatchEvent`, `click()`). */
  | 'untrusted'
  /** The event's dispatch is over: the token was asked for too late. */
  | 'over'
  /** Neither a click nor a key press. */
  | 'not-a-gesture'
  | 'document-hidden'
  /** A click outside our roots; a send that is not a click through its own surface. */
  | 'outside'
  /** The root the action came through is not visible. */
  | 'surface-hidden'
  /** The surface the token is for is not on screen. */
  | 'not-mounted'
  /** This event already gave a token of this kind. */
  | 'spent';

export interface GateEnv {
  readonly doc: Document;
  readonly mounts: Pick<MountManager, 'dock' | 'registry' | 'points'>;
  /** Connected and really visible; the default asks the element (tests replace it: no layout there). */
  readonly visible?: (host: Element) => boolean;
}

const GESTURES: readonly string[] = ['click', 'keydown'];
/** `Event.NONE`: the dispatch is over (or never began). */
const PHASE_NONE = 0;

/** The same test the mount manager uses for a composer: connected, not hidden by CSS or opacity, with a box. */
export function onScreen(host: Element): boolean {
  if (!host.isConnected || !host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = host.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Why `event` does not allow an action of `kind` on `surface`, or null when it does. */
export function gestureRefusal(event: Event | null, kind: ActionKind, surface: Surface, env: GateEnv): GestureRefusal | null {
  const visible = env.visible ?? onScreen;
  if (event === null) return 'no-gesture';
  if (!event.isTrusted) return 'untrusted';
  if (event.eventPhase === PHASE_NONE) return 'over';
  if (!GESTURES.includes(event.type)) return 'not-a-gesture';
  if (env.doc.visibilityState !== 'visible') return 'document-hidden';

  const dockHost: Element = env.mounts.dock.host;
  /** Hosts the surface may live in: the dock's own, or any overlay host for the windows, the preview and the toasts. */
  const ofSurface = (host: Element): boolean => (surface === 'dock' ? host === dockHost : host !== dockHost);

  const via = env.mounts.registry.hostOf(event);
  if (via === null) {
    // Outside our UI only a key press counts, and never for a send.
    if (event.type !== 'keydown' || kind === 'send') return 'outside';
  } else {
    if (!visible(via)) return 'surface-hidden';
    if (kind === 'send' && (event.type !== 'click' || !ofSurface(via))) return 'outside';
  }

  const hosts = env.mounts.registry.hosts().filter(ofSurface);
  const mounted = hosts.some(visible) && (surface !== 'dock' || env.mounts.points().dock.kind !== 'none');
  return mounted ? null : 'not-mounted';
}

export interface GestureGate {
  /** Why no token may be asked for right now, or null; a null marks the event as having given its token of `kind`. */
  take(kind: ActionKind, surface: Surface): GestureRefusal | null;
  /** Hands in an event this gate could not see itself (stopped before `window`'s listeners of this chunk). */
  note(event: Event): void;
  dispose(): void;
}

export function createGestureGate(win: Window, env: GateEnv): GestureGate {
  let current: Event | null = null;
  const given = new WeakMap<Event, Set<ActionKind>>();
  // A synthetic event never replaces the human one in flight (a page script may dispatch its own inside it).
  const note = (event: Event): void => {
    if (event.isTrusted) current = event;
  };
  for (const type of GESTURES) win.addEventListener(type, note, true);
  return {
    take(kind, surface) {
      const event = current;
      const refusal = gestureRefusal(event, kind, surface, env);
      if (refusal !== null || event === null) return refusal ?? 'no-gesture';
      const kinds = given.get(event) ?? new Set<ActionKind>();
      if (kinds.has(kind)) return 'spent';
      kinds.add(kind);
      given.set(event, kinds);
      return null;
    },
    note,
    dispose() {
      for (const type of GESTURES) win.removeEventListener(type, note, true);
      current = null;
    },
  };
}

/** Action tokens of this tab (§14): one per human action of one surface, spent once by the background. */
export interface TabActionTokens {
  /**
   * The token of the human action being handled right now. Ask for it FIRST, in the same synchronous step as the
   * action: once the click or the key press is over there is no token for it.
   * null — no such action (see GestureRefusal), or the background refused or did not answer: nothing may be written.
   */
  issue(kind: ActionKind, surface: Surface): Promise<string | null>;
  /** The hotkey dispatcher hands in a key press it stopped before this chunk's listeners could see it (§9.1). */
  noteGesture(event: Event): void;
}

export interface ActionTokensDeps {
  readonly gate: GestureGate;
  /** `token.issue`; null — refused or no answer. */
  readonly request: (kind: ActionKind, surface: Surface) => Promise<string | null>;
  /** `token.redeem` for the surface the token was issued for. */
  readonly spend: (request: { readonly kind: 'insert' | 'navigate'; readonly surface: Surface; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;
  /** Facts only: what was asked and why not. */
  readonly onRefused?: (facts: { readonly kind: ActionKind; readonly surface: Surface; readonly refusal: GestureRefusal }) => void;
}

/** Tokens this tab asked for and has not spent yet; more is a stuck controller, the oldest go. */
const TOKENS_KEPT = 64;

export function createActionTokens(deps: ActionTokensDeps): {
  readonly tokens: TabActionTokens;
  /** HostPort's redeemer: the token of a click is spent before a write reaches MAIN (§14). */
  readonly redeem: (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;
} {
  const surfaceOfToken = new Map<string, Surface>();
  return {
    tokens: {
      async issue(kind, surface) {
        // Synchronously, before the first await: the event must still be in flight.
        const refusal = deps.gate.take(kind, surface);
        if (refusal !== null) {
          deps.onRefused?.({ kind, surface, refusal });
          return null;
        }
        const actionToken = await deps.request(kind, surface);
        if (actionToken === null) return null;
        surfaceOfToken.set(actionToken, surface);
        if (surfaceOfToken.size > TOKENS_KEPT) surfaceOfToken.delete(surfaceOfToken.keys().next().value ?? '');
        return actionToken;
      },
      noteGesture: (event) => deps.gate.note(event),
    },
    async redeem(request) {
      const surface = surfaceOfToken.get(request.actionToken);
      surfaceOfToken.delete(request.actionToken);
      // A token this tab did not issue is not spent on the background's behalf.
      if (surface === undefined) return false;
      return deps.spend({ kind: request.kind, surface, actionToken: request.actionToken, intentId: request.intentId });
    },
  };
}
