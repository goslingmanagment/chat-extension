// FakeAppClient — the executable UI contract (architecture.md §10.2 п. 7). A
// scenario is a set of view snapshots, an optional timeline of steps (stream
// chunks, a late result, a timeout) and reactions to dispatched actions. The
// fake validates every dispatched action against UiActionSchema, so a UI
// that sends a raw persona, an extra key or a send without a part fails here
// before it reaches a controller.

import {
  UiActionSchema,
  selectorKey,
  type ActionReceipt,
  type AppClient,
  type ColorScheme,
  type HotkeyPlatform,
  type UiAction,
  type UiActionType,
  type Locale,
  type UiTheme,
  type ViewOf,
  type ViewSelector,
} from '@cg/contracts';

/** The topics of §10.2 п. 7 every scenario set must cover, plus the drawn states of ui-design §0.2. */
export const REQUIRED_TOPICS = [
  'no-sign-in',
  'no-rights',
  'no-persona',
  'no-binding',
  'host-contract-partial',
  'blocked-fan',
  'archive-empty',
  'archive-partial',
  'stats-error',
  'three-running-fourth-refused',
  'late-result',
  'human-draft-conflict',
  'streaming',
  'timeout',
  'colleague-sending',
  'claim-uncertain',
  'recap-short',
  'recap-full',
  'variants-and-parts',
  'x8-states',
  'debug-on',
  'debug-off',
  'ru',
  'en',
  'theme-light',
  'theme-dark',
] as const;

export const EXTRA_TOPICS = [
  'hub-down',
  'chat-loading',
  'reload-needed',
  'quota-low',
  'quota-zero',
  'provider-rate-limit',
  'fix',
  'keys-footer',
  'result-style-sheet',
  'inserted-collapsed',
  'one-part',
  'unparsed',
  'interrupted',
  'toasts',
  'palette-search',
  'popup-problems',
  'options',
  'coach',
  'review',
  'state-gallery',
] as const;

export type ScenarioTopic = (typeof REQUIRED_TOPICS)[number] | (typeof EXTRA_TOPICS)[number];

/** One view model under its selector; `entry()` keeps the pair type-correct. */
export interface ScenarioViewEntry {
  readonly selector: ViewSelector;
  readonly vm: unknown;
}

export function entry<S extends ViewSelector>(selector: S, vm: ViewOf<S>): ScenarioViewEntry {
  return { selector, vm };
}

export interface ScenarioStep {
  readonly label: string;
  /** Offset from the scenario start, ms; the fake clock moves there. */
  readonly at: number;
  /** Views replaced at this step; the others stay. */
  readonly views: readonly ScenarioViewEntry[];
}

export interface ScenarioReaction {
  readonly on: UiActionType;
  readonly receipt: ActionReceipt;
  /** Jump to this step after answering (a click that starts a stream). */
  readonly thenStep?: number;
}

export interface AppClientScenario {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly ScenarioTopic[];
  readonly language: Locale;
  readonly platform: HotkeyPlatform;
  /** The resolved scheme our surfaces render in. */
  readonly scheme: ColorScheme;
  /** The `ui.theme` setting behind it. */
  readonly theme: UiTheme;
  readonly debug: boolean;
  readonly now: number;
  readonly views: readonly ScenarioViewEntry[];
  readonly steps?: readonly ScenarioStep[];
  readonly reactions?: readonly ScenarioReaction[];
}

/** Rejected dispatch: the UI broke the contract (not a refusal the person should see). */
export class ContractViolation extends Error {
  constructor(
    message: string,
    readonly action: unknown,
  ) {
    super(message);
    this.name = 'ContractViolation';
  }
}

type Listener = (view: unknown) => void;

export class FakeAppClient implements AppClient {
  private readonly current = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private step = -1;
  private clock: number;
  /** Every accepted action, in order: assertions read it. */
  readonly dispatched: UiAction[] = [];

  constructor(
    readonly scenario: AppClientScenario,
    private readonly fallback: (selector: ViewSelector) => unknown,
  ) {
    this.clock = scenario.now;
    for (const view of scenario.views) this.current.set(selectorKey(view.selector), view.vm);
  }

  /** The scenario's fake clock, epoch ms. */
  now(): number {
    return this.clock;
  }

  /** Index of the last applied step, -1 before the first. */
  get stepIndex(): number {
    return this.step;
  }

  getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
    const key = selectorKey(selector);
    const vm = this.current.has(key) ? this.current.get(key) : this.fallback(selector);
    return vm as ViewOf<S>;
  }

  subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
    const key = selectorKey(selector);
    const set = this.listeners.get(key) ?? new Set<Listener>();
    const wrapped: Listener = (view) => listener(view as ViewOf<S>);
    set.add(wrapped);
    this.listeners.set(key, set);
    return () => set.delete(wrapped);
  }

  dispatch(action: UiAction): Promise<ActionReceipt> {
    const parsed = UiActionSchema.safeParse(action);
    if (!parsed.success) {
      return Promise.reject(new ContractViolation(`UiAction rejected: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`, action));
    }
    this.dispatched.push(action);
    const reaction = this.scenario.reactions?.find((r) => r.on === action.type);
    if (reaction?.thenStep !== undefined) this.goTo(reaction.thenStep);
    return Promise.resolve(reaction?.receipt ?? { ok: true, type: action.type, outcome: 'done' });
  }

  /** Applies the next step; false when the timeline is over. */
  advance(): boolean {
    const steps = this.scenario.steps ?? [];
    if (this.step + 1 >= steps.length) return false;
    this.goTo(this.step + 1);
    return true;
  }

  /** Applies steps up to and including `index`. */
  goTo(index: number): void {
    const steps = this.scenario.steps ?? [];
    while (this.step < index && this.step + 1 < steps.length) {
      this.step += 1;
      const step = steps[this.step];
      if (step === undefined) break;
      this.clock = this.scenario.now + step.at;
      for (const view of step.views) {
        const key = selectorKey(view.selector);
        this.current.set(key, view.vm);
        for (const listener of this.listeners.get(key) ?? []) listener(view.vm);
      }
    }
  }
}
