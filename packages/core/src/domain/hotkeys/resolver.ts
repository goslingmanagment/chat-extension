// One key resolver per tab (architecture.md §9.1 «Движок»; HK-018…HK-023):
// the vendored engine for the shared scheme, then the rows outside it. The
// engine runs as the client the site's adapter names (`hotkeyClient`, Project
// Unite architecture §1.3, §1.5): ChatSpace — `extension`, Fansly — `fansly`,
// which also has the Notes row. EVERY trusted keydown goes through `keydown` — modifiers
// included — because the engine's fresh-press guard has to see ⌘/Ctrl go
// down; every keyup through `keyup`; `reset` on window blur and when the tab
// is hidden. There is no second engine in the panels (HK-023): they get
// commands, never raw keys of the scheme.

import { createHotkeyEngine, type HotkeyClient, type HotkeyEngine } from '@chatgoose/hotkeys';

import { DISPATCHER_COMMAND_IDS, isModifierKey, isPrimaryModifierKey, matchExtraKey, type DispatcherCommandId, type HotkeyKeyEvent, type HotkeyPlatform } from './keymap';

const isDispatcherCommand = (action: string): action is DispatcherCommandId =>
  (DISPATCHER_COMMAND_IDS as readonly string[]).includes(action);

export type KeyVerdict =
  | {
      readonly kind: 'command';
      readonly command: DispatcherCommandId;
      /** 1–9 with `quick-jump`. */
      readonly slot: number | null;
      /** Auto-repeat of a held key: the key is still ours, the action does not run again (HK-019). */
      readonly repeat: boolean;
      /** From the vendored scheme (true) or a row outside it (false). */
      readonly scheme: boolean;
      /** No ⌘/Ctrl/Alt in it (J, K, `]`, `?`, Esc): off while a person types. */
      readonly plain: boolean;
      /** The fallback combination (Alt+U, Alt+1–9). */
      readonly fallback: boolean;
    }
  /** A combination of ours that must do nothing now: a retired habit, a roll-over, a letter reserved in this client. */
  | { readonly kind: 'swallow'; readonly reason: 'legacy' | 'rollover' | 'reserved' };

/** keyCode 229 is «a key of an input method»: Firefox reports it for some IME keys before `isComposing` is set. */
export function isImeKey(event: { readonly isComposing?: boolean; readonly keyCode?: number; readonly key?: string }): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process';
}

export interface KeyResolver {
  readonly platform: HotkeyPlatform;
  /** Feed every trusted keydown, in capture order. */
  keydown(event: HotkeyKeyEvent & { readonly keyCode?: number }): KeyVerdict | null;
  keyup(event: HotkeyKeyEvent): void;
  /** Window blur, a hidden tab: a modifier held across them is an unknown state. */
  reset(): void;
  /** ⌘/Ctrl is down with nothing else pressed since: the quick jump opens after 400 ms of this. */
  primaryHeldAlone(): boolean;
}

/** `client` — the site's client of the vendored scheme (`HostAdapter.hotkeyClient`): the rows it serves run, a row of another client is a reserved letter. */
export function createKeyResolver(platform: HotkeyPlatform, client: HotkeyClient, engine: HotkeyEngine = createHotkeyEngine({ platform, client })): KeyResolver {
  let primaryDown = false;
  let alone = false;

  const track = (event: HotkeyKeyEvent): void => {
    const flag = platform === 'mac' ? event.metaKey : event.ctrlKey;
    if (isPrimaryModifierKey(event, platform)) {
      if (!primaryDown) {
        primaryDown = true;
        alone = !event.shiftKey && !event.altKey;
      }
      return;
    }
    if (!flag) {
      primaryDown = false;
      alone = false;
      return;
    }
    // Any other key under the held modifier — a digit included — ends «alone».
    alone = false;
  };

  return {
    platform,
    keydown(event) {
      const decision = engine.keydown(event);
      track(event);
      if (isImeKey(event) || isModifierKey(event)) return null;
      if (decision !== null) {
        if (decision.kind === 'swallow') return decision;
        // The engine hands this client only the rows it serves; a row of
        // another client (Notes, where the client is `extension`) arrives as
        // `reserved`. A row the client serves that the dispatcher has no
        // command for yet (Notes on Fansly) is a reserved letter here too.
        if (!isDispatcherCommand(decision.action)) return { kind: 'swallow', reason: 'reserved' };
        return { kind: 'command', command: decision.action, slot: null, repeat: decision.repeat, scheme: true, plain: false, fallback: false };
      }
      const extra = matchExtraKey(event, platform);
      if (extra === null) return null;
      return {
        kind: 'command',
        command: extra.def.command,
        slot: extra.slot,
        repeat: event.repeat === true,
        scheme: false,
        plain: extra.def.mods === 'none' || extra.def.mods === 'shift',
        fallback: extra.def.fallback,
      };
    },
    keyup(event) {
      engine.keyup(event);
      if (isPrimaryModifierKey(event, platform)) {
        primaryDown = false;
        alone = false;
      }
    },
    reset() {
      engine.reset();
      primaryDown = false;
      alone = false;
    },
    primaryHeldAlone: () => primaryDown && alone,
  };
}
