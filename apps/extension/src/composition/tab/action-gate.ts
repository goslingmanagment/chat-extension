// The tab's side of «Запись — только по доверенному действию» (architecture.md
// §14; BG-001, AI-120). The background issues an action token to any
// registered tab session that asks: it cannot see the event. So the tab asks
// only for a human action, and this file is the one place that decides what
// counts as one:
//
// - a TRUSTED (`isTrusted`) click or key press — a synthetic `dispatchEvent`
//   is not one;
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
// inside a closed root shows its host there). Whoever stops an event before
// `window`'s listeners of this chunk run (the early hotkey dispatcher) hands
// it in with `note`.
//
// When the token may be asked for. A controller reads the page before it
// asks (the draft, the visible tail, the list ChatSpace holds), so the token
// comes after the click's own step. Two ways, and no third:
// - while the event is still being dispatched — `take`, for whoever asks
//   first thing;
// - through a GRANT: the action the person's click or key dispatched gets, in
//   that same synchronous step, the right to the token kinds its TYPE may
//   need (GRANTED_KINDS: an InsertPart may insert, a SendPart may send, a
//   Generate may generate — never the other way round), once each, for
//   GRANT_TTL_MS. A grant is opened only by `open`, called by the tab's
//   AppClient as it takes the action; what the event was — its type, the
//   root it came through — is read then, while it can be.
// So a timer, a toast callback, the end of a stream or a late continuation of
// some OTHER action still cannot mint a token: nothing opens a grant for
// them, and a grant never covers a kind its own action does not need.
//
// A key the early dispatcher kept until the lazy part was ready (HK-024,
// HK-025) runs after its keydown is over; `resume` lets exactly that keydown
// open a grant, within the dispatcher's own freshness bound.
//
// One click buys more than one token: «Сгенерировать для N» of a list's batch (contracts 1.32.0, vm/batch). The
// person names the fans and asks for all of them at once, and the queue starts them a few at a time over minutes.
// Its grant is a BATCH grant: generate tokens only, at most BATCH_LIMITS.grantTokens of them, for
// BATCH_LIMITS.grantTtlMs, kept apart from the grants of single actions (which are asked first), and replaced by
// the next batch click. It can never insert, send or navigate.
//
// One click writes a little ahead, too: «Онлайн» (2026-10-26). A click or a key that moves its pass to a fan — the
// window opened, a fan of its list, its «Отправить →», «Пропустить» or «Не предлагать» (the client says which,
// `movesOnlinePass`) — has the AI write that fan's text and the next one's, so the next card is ready when the person gets
// there. Its grant is an ONLINE grant: generate tokens only, at most ONLINE_GRANT_TOKENS of them, for
// ONLINE_GRANT_TTL_MS, claimable only for a preview's generation while the tab is on screen, replaced by the next such
// action and dropped when the window closes (`dropOnline`). It can never insert, send or navigate; the send of
// «Отправить →» is its own ordinary grant of that click.
//
// One click writes later, by design: Fix (decision X68, the owner: «как в старом» — the old Fansly extension's Fix
// put its result into the field by itself). The person's Fix click or key, in the dock or the composer, opens with
// its `generate` grant a DEFERRED insert grant: one `insert` token, for the dock, claimable only by a request that
// says it is that deferred write (`token.issue` with `deferred`, asked by the Fix's own end), within
// DEFERRED_INSERT_TTL_MS — the longest a Fix may run. A newer Fix click replaces it; a click of anything else never
// opens one, and a deferred request never takes an ordinary grant or the event in flight.
//
// One click goes on later, by design, too: «Hi» of a greeting reminder's toast (2026-10-25, the owner: «по hi нажимая
// начиналась генерация сообщения сразу и в чате уже оказалось оно»; 2026-10-26: straight into the chat, no window).
// The click opens the fan's chat, the dock's Hi writes one greeting there, and it goes into the site's field — for the
// person's own send. Its click keeps a DEFERRED GREET grant: one `navigate`, one `generate` and one `insert`, within
// DEFERRED_GREET_TTL_MS, handed out only by `afterGreet` — the toast's own chain naming the next action of it (the
// chat's `Navigate`, the dock's `Generate`, then its `InsertPart`), as an ordinary grant of that one action. A newer
// toast Hi replaces it; it can never send.
//
// One human action happens outside this document: a click on our own popup
// or options page that acts in ChatSpace (`tab.command`, §9.9). The
// background brings this tab to the front and hands the command over its
// port — a channel the page cannot write to. `vouch` opens a grant for it:
// a navigation only, once, like a key pressed on the page. It can never
// insert, send or generate.
//
// One more comes from another tab (2026-10-25): «Hi» of a greeting reminder's
// toast pressed in a tab of another model. That tab spent its click's own
// `navigate` token with the background, which brought this tab forward and
// handed the click over (`greet.start`): `vouch(true)` opens for it what the
// toast's own click would — GreetNewcomer's grant and its deferred greet grant.

import type { CgErrorWire } from '@cg/contracts/errors';
import type { Surface } from '@cg/contracts/features';
import { OP_TIMEOUTS } from '@cg/contracts/limits';
import { BATCH_LIMITS, type UiAction } from '@cg/contracts/vm';

import type { HostMounts } from './adapter';

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
  | 'spent'
  /** The action that was dispatched has no right to a token of this kind. */
  | 'not-granted'
  /** The grant of the action is too old. */
  | 'expired';

export interface GateEnv {
  readonly doc: Document;
  readonly mounts: Pick<HostMounts, 'dock' | 'registry' | 'points'>;
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

/** What the gate keeps of a human action once it has looked at its event (the event itself says nothing after its dispatch). */
export interface Gesture {
  readonly event: Event;
  readonly click: boolean;
  /** Our host the event came through; null — outside our UI (a key press), or a kept key. */
  readonly via: Element | null;
}

/** The human action `event` is, or why it is none. `kept` — a key the early dispatcher held back: its dispatch is over by design. */
export function gestureOf(event: Event | null, env: GateEnv, kept = false): Gesture | GestureRefusal {
  const visible = env.visible ?? onScreen;
  if (event === null) return 'no-gesture';
  if (!event.isTrusted) return 'untrusted';
  if (!kept && event.eventPhase === PHASE_NONE) return 'over';
  if (!GESTURES.includes(event.type)) return 'not-a-gesture';
  if (env.doc.visibilityState !== 'visible') return 'document-hidden';
  // After its dispatch an event has no path: a kept key is a key of the page, never of a root of ours.
  const via = kept ? null : env.mounts.registry.hostOf(event);
  if (via === null) {
    // Outside our UI only a key press counts.
    if (event.type !== 'keydown') return 'outside';
  } else if (!visible(via)) return 'surface-hidden';
  return { event, click: event.type === 'click', via };
}

/** Why `gesture` does not allow an action of `kind` on `surface`, or null when it does. */
export function kindRefusal(gesture: Gesture, kind: ActionKind, surface: Surface, env: GateEnv): GestureRefusal | null {
  const visible = env.visible ?? onScreen;
  const dockHost: Element = env.mounts.dock.host;
  /** Hosts the surface may live in: the dock's own, or any overlay host for the windows, the preview and the toasts. */
  const ofSurface = (host: Element): boolean => (surface === 'dock' ? host === dockHost : host !== dockHost);
  // A send is a click through the surface it is sent from, never a key and never from outside.
  if (kind === 'send' && (gesture.via === null || !gesture.click || !ofSurface(gesture.via))) return 'outside';
  const hosts = env.mounts.registry.hosts().filter(ofSurface);
  const mounted = hosts.some(visible) && (surface !== 'dock' || env.mounts.points().dock.kind !== 'none');
  return mounted ? null : 'not-mounted';
}

/** Why `event` does not allow an action of `kind` on `surface`, or null when it does. */
export function gestureRefusal(event: Event | null, kind: ActionKind, surface: Surface, env: GateEnv): GestureRefusal | null {
  const gesture = gestureOf(event, env);
  return typeof gesture === 'string' ? gesture : kindRefusal(gesture, kind, surface, env);
}

/**
 * The token kinds an action may need, by its type (§10.2: the UI sends an
 * action, the controller decides the rest). Everything else needs none: a
 * view switch, a filter, a copy, a cancel.
 */
export const GRANTED_KINDS: Readonly<Partial<Record<UiAction['type'], readonly ActionKind[]>>> = {
  Generate: ['generate'],
  Regenerate: ['generate'],
  // 1.48.0: the head's «с Recap» asks its answer again with the new tick (`again`), under the same click.
  SetRecap: ['generate'],
  RefreshRecap: ['generate'],
  InsertPart: ['insert'],
  ReplaceMyDraft: ['insert'],
  RestoreMyDraft: ['insert'],
  // «Заменить» / «Добавить в конец» of the Б2 question is the insert itself.
  AnswerConfirm: ['insert'],
  // The deferred insert rides the navigation's own token (§6.5).
  OpenAndInsertPart: ['navigate'],
  OpenChatToVerify: ['navigate'],
  Navigate: ['navigate'],
  SendPart: ['send'],
  // The person's own text from a preview's draft field (audit 2026-10-20, row 1): a send by this click.
  SendDraft: ['send'],
  // R20 P10c: a «Новые» card asks after writing and reading its draft — «Отправить» a send, «Открыть и вставить» a navigation.
  SendNewcomerGreeting: ['send'],
  InsertNewcomerGreeting: ['navigate'],
  // «Рассылка»: a fan's «Отправить» is a send by this click; «Ещё раз» / «Написать для …» writes that one fan's version
  // (the versions of many are `GenerateBatch`, the batch's own grant).
  SendOutreach: ['send'],
  RewriteOutreach: ['generate'],
  // «Онлайн»: «Отправить →» is a send by this click; «Ещё раз» / «Написать …» writes that one fan's text. The texts of the
  // fan the pass moves to, and the next one, are the online grant's (ONLINE_ACTIONS).
  SendOnline: ['send'],
  RewriteOnline: ['generate'],
  // 2026-10-24: «Hi» of a greeting reminder's toast; 2026-10-26 — opens the fan's chat, starts the dock's Hi there and
  // puts its greeting into the field, or hands the click to the fan's model's tab (its deferred greet grant, `afterGreet`).
  GreetNewcomer: ['generate'],
  // 1.47.0: Voice. The chip writes the script when the studio opens over a draft; a preset, «Переписать» and «Новый
  // войс» write one; «Озвучить» and «Проверить» are the paid create (the same request again for «Проверить»); only
  // «Прикрепить» hands the MP3 to the site's field, and «Убрать текст» / «Вернуть текст» write the field's draft.
  ShowVoice: ['generate'],
  WriteVoiceScript: ['generate'],
  NewVoice: ['generate'],
  MakeVoiceTake: ['generate'],
  CheckVoiceTake: ['generate'],
  AttachVoiceTake: ['insert'],
  ClearVoiceDraft: ['insert'],
  RestoreVoiceDraft: ['insert'],
};

/** How long the action of a click or a key may ask for its tokens: it reads the page and the background first. */
export const GRANT_TTL_MS = 10_000;
/** X68: how long the Fix a click started may still write its result — the longest a Fix runs, and some room. */
export const DEFERRED_INSERT_TTL_MS = OP_TIMEOUTS.fix.maxMs + 15_000;
/**
 * 2026-10-26: how long «Hi» of a greeting reminder's toast may go on: the fan's chat found or made and opened, and its
 * dock ready (45 s at most), the Hi itself (OP_TIMEOUTS.hi), and room for the reads around them.
 */
export const DEFERRED_GREET_TTL_MS = 45_000 + OP_TIMEOUTS.hi.maxMs + 15_000;
/** The token kinds the toast's Hi goes on with, and the actions of its chain that may take them. */
const GREET_KINDS: readonly ActionKind[] = ['navigate', 'generate', 'insert'];
// `Navigate`: the fan's chat, or the click handed to the fan's model's tab; `Generate`: the dock's Hi; `InsertPart`: its greeting into the field.
const GREET_CHAIN: readonly UiAction['type'][] = ['Navigate', 'Generate', 'InsertPart'];
/** A kept key is handed over within the dispatcher's own bound (KEPT_KEY_TTL_MS, 5 s); a little room for the hand-over itself. */
export const KEPT_KEY_MAX_AGE_MS = 6_000;
/** Open grants kept; more is a stuck controller, the oldest go. */
const GRANTS_KEPT = 8;

export interface GestureGate {
  /** Why no token may be asked for right now, or null; a null marks the event as having given its token of `kind`. */
  take(kind: ActionKind, surface: Surface): GestureRefusal | null;
  /**
   * The person's action in flight dispatched `action`: it may ask for the
   * token kinds of its type until the grant is spent or too old. Called in the
   * synchronous step of the click or the key; null — a grant is open (or the
   * action needs no token), else why not.
   */
  open(action: UiAction['type'], deferInsert?: boolean, online?: boolean): GestureRefusal | null;
  /** «Онлайн» closed: what its last action left of the online grant goes. */
  dropOnline(): void;
  /** A token for the action that was granted it: the newest open grant that has this kind left. */
  claim(kind: ActionKind, surface: Surface): GestureRefusal | null;
  /** X68: the one insert token of the last Fix click, for the dock, asked for when that Fix is done. */
  claimDeferred(kind: ActionKind, surface: Surface): GestureRefusal | null;
  /**
   * 2026-10-25: the toast's Hi goes on with `action` (the fan's chat, the dock's Generate, then its InsertPart): a grant
   * of that action's kinds from the Hi's own click, if it has them left; null — opened, else why not.
   */
  afterGreet(action: UiAction['type']): GestureRefusal | null;
  /** Hands in an event this gate could not see itself (stopped before `window`'s listeners of this chunk). */
  note(event: Event): void;
  /**
   * A key the early dispatcher kept runs in this very step: `event` is its
   * trusted keydown, pressed at `at` (epoch ms). Until `done` is called the
   * key counts as the action in flight.
   */
  resume(event: Event, at: number): () => void;
  /**
   * A click made on one of our extension pages was brought to this tab by the
   * background (`tab.command`): the navigation it asks for may get its token
   * — once, within the grant's time. No other kind; `greet` — a reminder's Hi
   * handed over by another tab (`greet.start`): what the toast's own click opens.
   */
  vouch(greet?: boolean): void;
  /** `click` or `key`: what the action in flight is (HumanCause); `click` when there is none. */
  cause(): 'click' | 'key';
  /**
   * The chatter's log (2026-10-21): what the action in flight is — a click, a key, or none seen (a timer, a stage
   * that loaded) — and where it came through: the dock, one of our overlays, or the site's own page (a key).
   */
  describe(): { readonly input: 'click' | 'key' | 'none'; readonly via: 'dock' | 'overlay' | 'page' };
  dispose(): void;
}

interface Grant {
  readonly gesture: Gesture;
  readonly kinds: Set<ActionKind>;
  readonly at: number;
}

/** The grant of a batch click: generate tokens, counted, for longer. */
interface BatchGrant {
  readonly gesture: Gesture;
  left: number;
  readonly at: number;
}

/** The action whose one click is a batch of generations. */
export const BATCH_ACTION: UiAction['type'] = 'GenerateBatch';
/** «Онлайн»: the actions that move its pass to a fan whose text — and the next one's — the AI writes. */
export const ONLINE_ACTIONS: readonly UiAction['type'][] = ['SetOnline', 'SelectOnline', 'SendOnline', 'SkipOnline', 'DismissOnline'];
/** The fan the pass moved to and the next one. */
export const ONLINE_GRANT_TOKENS = 2;
/** Long enough for a send to go and the next card to open (and the background's «limit of the tab» to pass). */
export const ONLINE_GRANT_TTL_MS = 60_000;

export function createGestureGate(win: Window, env: GateEnv, now: () => number = () => Date.now()): GestureGate {
  let current: Event | null = null;
  /** The kept key being handed over right now. */
  let resumed: Event | null = null;
  const given = new WeakMap<Event, Set<ActionKind>>();
  let grants: Grant[] = [];
  let batch: BatchGrant | null = null;
  /** «Онлайн»'s grant of its last click or key (see the head of this file). */
  let online: BatchGrant | null = null;
  /** X68: the deferred insert of the last Fix click (see the head of this file). */
  let deferred: { readonly gesture: Gesture; readonly at: number } | null = null;
  /** The toast's Hi of the last such click and the kinds it has left (see the head of this file). */
  let greet: { readonly gesture: Gesture; readonly at: number; readonly kinds: Set<ActionKind> } | null = null;
  // A synthetic event never replaces the human one in flight (a page script may dispatch its own inside it).
  const note = (event: Event): void => {
    if (event.isTrusted) current = event;
  };
  for (const type of GESTURES) win.addEventListener(type, note, true);

  const inFlight = (): Gesture | GestureRefusal => (resumed !== null ? gestureOf(resumed, env, true) : gestureOf(current, env));
  /** One token of a kind per event, whichever way it is asked for. */
  const spend = (event: Event, kind: ActionKind): boolean => {
    const kinds = given.get(event) ?? new Set<ActionKind>();
    if (kinds.has(kind)) return false;
    kinds.add(kind);
    given.set(event, kinds);
    return true;
  };

  return {
    take(kind, surface) {
      const gesture = inFlight();
      if (typeof gesture === 'string') return gesture;
      const refusal = kindRefusal(gesture, kind, surface, env);
      if (refusal !== null) return refusal;
      return spend(gesture.event, kind) ? null : 'spent';
    },
    open(action, deferInsert = false, onlinePass = false) {
      if (onlinePass && ONLINE_ACTIONS.includes(action)) {
        const gesture = inFlight();
        if (typeof gesture !== 'string') online = { gesture, left: ONLINE_GRANT_TOKENS, at: now() };
      }
      if (action === BATCH_ACTION) {
        const gesture = inFlight();
        if (typeof gesture === 'string') return gesture;
        batch = { gesture, left: BATCH_LIMITS.grantTokens, at: now() };
        return null;
      }
      const kinds = GRANTED_KINDS[action];
      if (kinds === undefined) return null;
      const gesture = inFlight();
      if (typeof gesture === 'string') return gesture;
      grants = [...grants.filter((grant) => now() - grant.at <= GRANT_TTL_MS), { gesture, kinds: new Set(kinds), at: now() }].slice(-GRANTS_KEPT);
      // A Fix of the open chat's composer: the click on the dock, or a key (⌘I in the field) — never another surface's.
      if (deferInsert && action === 'Generate' && (gesture.via === null || gesture.via === env.mounts.dock.host)) deferred = { gesture, at: now() };
      if (action === 'GreetNewcomer') greet = { gesture, at: now(), kinds: new Set(GREET_KINDS) };
      return null;
    },
    dropOnline() {
      online = null;
    },
    afterGreet(action) {
      const grant = greet;
      const kinds = GRANTED_KINDS[action] ?? [];
      if (grant === null || !GREET_CHAIN.includes(action) || kinds.length === 0 || !kinds.every((kind) => grant.kinds.has(kind))) return 'not-granted';
      if (now() - grant.at > DEFERRED_GREET_TTL_MS) {
        greet = null;
        return 'expired';
      }
      for (const kind of kinds) grant.kinds.delete(kind);
      if (grant.kinds.size === 0) greet = null;
      grants = [...grants.filter((open) => now() - open.at <= GRANT_TTL_MS), { gesture: grant.gesture, kinds: new Set(kinds), at: now() }].slice(-GRANTS_KEPT);
      return null;
    },
    claimDeferred(kind, surface) {
      const grant = deferred;
      if (kind !== 'insert' || surface !== 'dock' || grant === null) return 'not-granted';
      // Spent or not, a deferred grant serves one request.
      deferred = null;
      if (now() - grant.at > DEFERRED_INSERT_TTL_MS) return 'expired';
      const refused = kindRefusal(grant.gesture, kind, surface, env);
      if (refused !== null) return refused;
      return spend(grant.gesture.event, kind) ? null : 'spent';
    },
    claim(kind, surface) {
      let refusal: GestureRefusal = 'not-granted';
      for (let index = grants.length - 1; index >= 0; index -= 1) {
        const grant = grants[index];
        if (grant === undefined || !grant.kinds.has(kind)) continue;
        if (now() - grant.at > GRANT_TTL_MS) {
          refusal = 'expired';
          continue;
        }
        const refused = kindRefusal(grant.gesture, kind, surface, env);
        if (refused !== null) {
          refusal = refused;
          continue;
        }
        grant.kinds.delete(kind);
        if (grant.kinds.size === 0) grants.splice(index, 1);
        return spend(grant.gesture.event, kind) ? null : 'spent';
      }
      // «Онлайн»'s texts: counted, not «one per event» — the click named the fan and the next one. A preview's generation
      // only (the window's cards), and only while the tab is on screen.
      if (kind === 'generate' && online !== null && surface === 'preview' && env.doc.visibilityState === 'visible') {
        if (now() - online.at > ONLINE_GRANT_TTL_MS || online.left <= 0) online = null;
        else {
          const refused = kindRefusal(online.gesture, kind, surface, env);
          if (refused === null) {
            online.left -= 1;
            return null;
          }
          refusal = refused;
        }
      }
      // A batch's next start: counted, not «one per event» — the one click named every fan of it.
      if (kind === 'generate' && batch !== null) {
        if (now() - batch.at > BATCH_LIMITS.grantTtlMs || batch.left <= 0) {
          batch = null;
          return 'expired';
        }
        const refused = kindRefusal(batch.gesture, kind, surface, env);
        if (refused !== null) return refused;
        batch.left -= 1;
        return null;
      }
      return refusal;
    },
    note,
    resume(event, at) {
      if (!event.isTrusted || event.type !== 'keydown' || now() - at > KEPT_KEY_MAX_AGE_MS) return () => undefined;
      resumed = event;
      return () => {
        if (resumed === event) resumed = null;
      };
    },
    vouch(greeting = false) {
      // No DOM event of this document stands behind it: the marker only keeps «one token per action» true.
      const gesture: Gesture = { event: new Event('cg-command'), click: true, via: null };
      const kinds: readonly ActionKind[] = greeting ? (GRANTED_KINDS.GreetNewcomer ?? []) : ['navigate'];
      grants = [...grants.filter((grant) => now() - grant.at <= GRANT_TTL_MS), { gesture, kinds: new Set<ActionKind>(kinds), at: now() }].slice(-GRANTS_KEPT);
      if (greeting) greet = { gesture, at: now(), kinds: new Set(GREET_KINDS) };
    },
    cause() {
      const gesture = inFlight();
      return typeof gesture !== 'string' && !gesture.click ? 'key' : 'click';
    },
    describe() {
      const gesture = inFlight();
      if (typeof gesture === 'string') return { input: 'none', via: 'page' };
      return { input: gesture.click ? 'click' : 'key', via: gesture.via === null ? 'page' : gesture.via === env.mounts.dock.host ? 'dock' : 'overlay' };
    },
    dispose() {
      for (const type of GESTURES) win.removeEventListener(type, note, true);
      current = null;
      resumed = null;
      grants = [];
      batch = null;
      online = null;
      deferred = null;
      greet = null;
    },
  };
}

/**
 * What became of a request for a token. `error` null — no human action stands behind it (see GestureRefusal) or the
 * background did not answer; otherwise the background's own reason (the sign-in is gone, the owner's switch is off,
 * the bootstrap expired and the hub is silent, §8.3). Either way nothing may be written.
 */
export type TokenAnswer = { readonly ok: true; readonly actionToken: string } | { readonly ok: false; readonly error: CgErrorWire | null };

/** Action tokens of this tab (§14): one per human action of one surface, spent once by the background. */
export interface TabActionTokens {
  /**
   * The token of the human action: of the action the person's click or key dispatched (its grant), or of the event
   * still in flight. null — no such action (see GestureRefusal), or the background refused or did not answer:
   * nothing may be written.
   */
  issue(kind: ActionKind, surface: Surface): Promise<string | null>;
  /** The same, with the background's reason when it is the one that refused; `deferred` — the Fix's own write (X68). */
  ask(kind: ActionKind, surface: Surface, deferred?: boolean): Promise<TokenAnswer>;
  /**
   * The AppClient took `action` from the UI or the hotkey runner, in the step of the click or the key; `deferInsert` — a
   * Fix (X68); `onlinePass` — it moves «Онлайн»'s pass to a fan (the online grant).
   */
  granted(action: UiAction['type'], deferInsert?: boolean, onlinePass?: boolean): void;
  /** The hotkey dispatcher hands in a key press it stopped before this chunk's listeners could see it (§9.1). */
  noteGesture(event: Event): void;
  /** A click on an extension page, brought here by the background (`tab.command`): its navigation may get a token. */
  vouched(greet?: boolean): void;
}

export interface ActionTokensDeps {
  readonly gate: GestureGate;
  /** `token.issue`: the token; null — no answer; an error — the background's refusal with its code. */
  readonly request: (kind: ActionKind, surface: Surface) => Promise<string | null | { readonly error: CgErrorWire }>;
  /** `token.redeem` for the surface the token was issued for. */
  readonly spend: (request: { readonly kind: 'insert' | 'navigate'; readonly surface: Surface; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;
  /** Facts only: what was asked and why not. */
  readonly onRefused?: (facts: { readonly kind: ActionKind; readonly surface: Surface; readonly refusal: GestureRefusal }) => void;
  /** An action that may need a token came without a human action in flight. */
  readonly onUngranted?: (facts: { readonly action: UiAction['type']; readonly refusal: GestureRefusal }) => void;
}

/** Tokens this tab asked for and has not spent yet; more is a stuck controller, the oldest go. */
const TOKENS_KEPT = 64;

export function createActionTokens(deps: ActionTokensDeps): {
  readonly tokens: TabActionTokens;
  /** HostPort's redeemer: the token of a click is spent before a write reaches MAIN (§14). */
  readonly redeem: (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;
} {
  const surfaceOfToken = new Map<string, Surface>();
  const ask = async (kind: ActionKind, surface: Surface, deferred = false): Promise<TokenAnswer> => {
    // Synchronously, before the first await. The action that was granted this kind when it was dispatched
    // gets it; without a grant the event must still be in flight. The Fix's deferred write has its own grant only.
    const granted = deferred ? deps.gate.claimDeferred(kind, surface) : deps.gate.claim(kind, surface);
    const refusal = granted === 'not-granted' && !deferred ? deps.gate.take(kind, surface) : granted;
    if (refusal !== null) {
      deps.onRefused?.({ kind, surface, refusal });
      return { ok: false, error: null };
    }
    const answer = await deps.request(kind, surface);
    if (answer === null) return { ok: false, error: null };
    if (typeof answer !== 'string') return { ok: false, error: answer.error };
    surfaceOfToken.set(answer, surface);
    if (surfaceOfToken.size > TOKENS_KEPT) surfaceOfToken.delete(surfaceOfToken.keys().next().value ?? '');
    return { ok: true, actionToken: answer };
  };
  return {
    tokens: {
      issue: (kind, surface) => ask(kind, surface).then((answer) => (answer.ok ? answer.actionToken : null)),
      ask,
      granted(action, deferInsert, onlinePass) {
        const refusal = deps.gate.open(action, deferInsert, onlinePass);
        // An action without a person behind it gets no grant; whether it needed one shows when it asks.
        if (refusal !== null) deps.onUngranted?.({ action, refusal });
      },
      noteGesture: (event) => deps.gate.note(event),
      vouched: (greet) => deps.gate.vouch(greet),
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
