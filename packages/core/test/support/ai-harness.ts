// The AI controllers under test: the workspace and the four controllers over
// the fake background (real scheduler, real tokens), a host the test moves,
// the real I18n port, a fake clipboard, toast sink, overlay switch and
// journal. `dispatch` is the router: it checks the action against the UI
// contract and asks the controllers in order. Test files hand in what only
// they may import (@cg/testing's host fake, catalog, bootstrap, resolver).

import {
  UiActionSchema,
  type ActionCatalog,
  type ActionReceipt,
  type Bootstrap,
  type ChatRef,
  type ChatWindow,
  type CoachVM,
  type DockVM,
  type DraftSnapshot,
  type HostFan,
  type HostPort,
  type HubFrame,
  type LiveTextTail,
  type LogRecord,
  type OverlaySurface,
  type RecapPickerVM,
  type RecapViewVM,
  type ResolveHubError,
  type ReviewVM,
  type SessionIdentity,
  type SettingsV1,
  type ToastRequest,
  type UiAction,
  type ViewSelector,
} from '@cg/contracts';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { HostKind } from '@cg/contracts/hosts';
import { createAiSurfaces, type AiSurfaces } from '@cg/core/application/ai';
import { createI18n } from '@cg/core/domain/i18n';

import { FakeBackground, TAB } from './ai-background';
import { MutableHost } from './ai-host';
import { FakeClock, sequentialIds, settle } from './clock';
import { type ScriptResponse, type ScriptStep } from './fake-hub';
import { CHATSPACE } from './features';
import { NOW_MS } from './world';

export interface HarnessParts {
  /** @cg/testing's FakeHostPort over the host world's script. */
  readonly baseHost: HostPort;
  readonly memory: { readonly drafts: readonly DraftSnapshot[]; readonly chatWindows: readonly ChatWindow[]; readonly tails: readonly { readonly chat: ChatRef; readonly tail: LiveTextTail }[]; readonly fans: readonly HostFan[] };
  readonly catalog: ActionCatalog;
  readonly bootstrap: Bootstrap;
  readonly resolve: ResolveHubError;
  /** A `meta` frame of the fake hub for a hub feature. */
  readonly meta: (feature: string) => HubFrame;
}

export interface HarnessOptions {
  readonly session?: SessionIdentity | null;
  readonly settings?: SettingsV1;
  readonly bootstrap?: Bootstrap;
  readonly language?: 'ru' | 'en';
  /** Start the surfaces only when the test says so. */
  readonly background?: (background: FakeBackground) => void;
  /** Another tab of the same extension: the background and the clock of an existing harness, its own tab session. */
  readonly shared?: { readonly bg: FakeBackground; readonly clock: FakeClock; readonly tab: string };
  /** The manifest's version of the build under test; absent — the tab does not know it (only the hub's own word is read). */
  readonly extensionVersion?: string;
  /** The site's slice of the feature manifest; absent — ChatSpace's. */
  readonly features?: FeatureSlice;
  /** The sites the background serves; absent — ChatSpace alone. */
  readonly served?: (host: HostKind) => FeatureSlice | null;
}

export class FakeClipboard {
  readonly texts: string[] = [];
  fail = false;

  writeText(text: string): Promise<{ ok: true } | { ok: false; code: 'CG-CLIPBOARD' }> {
    if (this.fail) return Promise.resolve({ ok: false, code: 'CG-CLIPBOARD' });
    this.texts.push(text);
    return Promise.resolve({ ok: true });
  }
}

export interface Harness {
  readonly clock: FakeClock;
  readonly bg: FakeBackground;
  readonly host: MutableHost;
  readonly ai: AiSurfaces;
  readonly clipboard: FakeClipboard;
  readonly toasts: ToastRequest[];
  readonly overlays: { readonly opened: OverlaySurface[]; readonly closed: OverlaySurface[] };
  readonly journal: Omit<LogRecord, 'ts' | 'seq'>[];
  dock(): DockVM;
  recapPicker(): RecapPickerVM;
  recapView(): RecapViewVM;
  review(): ReviewVM;
  coach(): CoachVM;
  /** The router: the action is checked against the UI contract, then offered to the controllers in order. */
  dispatch(action: UiAction): Promise<ActionReceipt>;
  /** `Generate` for the open chat. */
  generate(feature: Extract<UiAction, { type: 'Generate' }>['feature'], options?: Extract<UiAction, { type: 'Generate' }>['options']): Promise<ActionReceipt>;
  /** Lets promises settle. */
  settle(): Promise<void>;
  /** A mounted view: subscribed, so it is read again on every change (which drives its lazy reads). */
  mount(selector: ViewSelector): () => void;
  /** Scripts the next hub stream. */
  script(...responses: ScriptResponse[]): void;
  /** A stream that answers `chunks` 20 ms apart and ends with `done`. */
  streamOf(hubFeature: string, chunks: readonly string[], extra?: readonly HubFrame[]): ScriptResponse;
  /** Plays the scripted stream to its end. */
  finish(): Promise<void>;
}

export const delta = (text: string, afterMs = 20): ScriptStep => ({ kind: 'frame', frame: { type: 'content_delta', text }, afterMs });
export const doneStep: ScriptStep = { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } };

export function aiHarness(parts: HarnessParts, options: HarnessOptions = {}): Harness {
  const clock = options.shared?.clock ?? new FakeClock(NOW_MS);
  const bg =
    options.shared?.bg ??
    new FakeBackground({
      bootstrap: options.bootstrap ?? parts.bootstrap,
      resolve: parts.resolve,
      clock,
      ...(options.session === undefined ? {} : { session: options.session }),
      ...(options.settings === undefined ? {} : { settings: options.settings }),
      ...(options.served === undefined ? {} : { features: options.served }),
    });
  options.background?.(bg);
  const tab = options.shared?.tab ?? TAB;
  const host = new MutableHost(parts.baseHost, parts.memory);
  const clipboard = new FakeClipboard();
  const toasts: ToastRequest[] = [];
  const overlays = { opened: [] as OverlaySurface[], closed: [] as OverlaySurface[] };
  const journal: Omit<LogRecord, 'ts' | 'seq'>[] = [];
  const ai = createAiSurfaces({
    rpc: bg.rpc(tab),
    host,
    i18n: createI18n({ language: options.language ?? 'ru', now: () => clock.now(), timeZone: 'UTC' }),
    clock,
    ids: sequentialIds(tab === TAB ? 0x5000 : 0x6000),
    catalog: parts.catalog,
    features: options.features ?? CHATSPACE,
    clipboard,
    toasts: { show: (toast) => toasts.push(toast) },
    journal: { write: (entry) => journal.push(entry) },
    overlays: { open: (surface) => overlays.opened.push(surface), close: (surface) => overlays.closed.push(surface) },
    ...(options.extensionVersion === undefined ? {} : { extensionVersion: options.extensionVersion }),
  });

  const dispatch = async (action: UiAction): Promise<ActionReceipt> => {
    const parsed = UiActionSchema.safeParse(action);
    if (!parsed.success) throw new Error(`UiAction rejected: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    for (const controller of ai.controllers) {
      const receipt = controller.dispatch(action);
      if (receipt !== null) {
        const answer = await receipt;
        await settle();
        return answer;
      }
    }
    throw new Error(`no controller took ${action.type}`);
  };

  const harness: Harness = {
    clock,
    bg,
    host,
    ai,
    clipboard,
    toasts,
    overlays,
    journal,
    dock: () => ai.dock.getSnapshot({ of: 'dock' }) as DockVM,
    recapPicker: () => ai.recap.getSnapshot({ of: 'recap.picker' }) as RecapPickerVM,
    recapView: () => ai.recap.getSnapshot({ of: 'recap.view' }) as RecapViewVM,
    review: () => ai.review.getSnapshot({ of: 'review' }) as ReviewVM,
    coach: () => ai.coach.getSnapshot({ of: 'coach' }) as CoachVM,
    dispatch,
    generate: (feature, generateOptions = {}) => {
      const handle = harness.dock().targetHandle;
      if (handle === null) throw new Error('the dock has no target');
      return dispatch({ type: 'Generate', targetHandle: handle, feature, options: generateOptions });
    },
    settle: () => settle(5),
    mount: (selector) => {
      const owner = ai.controllers.find((controller) => controller.kinds.includes(selector.of));
      if (owner === undefined) throw new Error(`no controller serves ${selector.of}`);
      return owner.subscribe(selector, () => undefined);
    },
    script: (...responses) => {
      bg.hub.streamScript.push(...responses);
    },
    streamOf: (hubFeature, chunks, extra = []) => ({
      kind: 'stream',
      steps: [{ kind: 'frame', frame: parts.meta(hubFeature) }, ...extra.map((frame): ScriptStep => ({ kind: 'frame', frame })), ...chunks.map((chunk) => delta(chunk)), doneStep],
    }),
    finish: () => clock.advance(5_000),
  };
  return harness;
}

/** A harness whose first reads have settled: signed in, bound, persona assigned, the chat open and loaded. */
export async function readyHarness(parts: HarnessParts, options: HarnessOptions = {}): Promise<Harness> {
  const harness = aiHarness(parts, options);
  // The dock is mounted, as on the page: its view is read again on every change, and reading it
  // starts the lazy reads (the binding of the open account, the quota). Let each wave answer.
  harness.mount({ of: 'dock' });
  await settle(5);
  return harness;
}
