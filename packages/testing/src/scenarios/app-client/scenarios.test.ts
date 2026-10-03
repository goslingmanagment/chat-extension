// Scenario integrity: the fake AppClient covers every topic of §10.2 п. 7,
// every view in every state it produces, every X8 state, every dock status
// and lease state, and every action a view model carries is a valid UiAction.

import {
  CLAIM_STATES,
  CgErrorViewSchema,
  LOCALES,
  cgEntry,
  DOCK_STATUSES,
  GREETING_STATUSES,
  PREVIEW_SEND_STATES,
  REVIEW_SECTION_KINDS,
  UI_ACTION_TYPES,
  UiActionSchema,
  VIEW_NAMES,
  VM_STATE_SUPPORT,
  ViewSelectorSchema,
  type DockVM,
  type PreviewVM,
  type ReviewVM,
  type UiActionType,
  type ViewName,
  type ViewSelector,
} from '@cg/contracts';
import { createTranslator } from '@cg/core/domain/i18n';
import { describe, expect, it } from 'vitest';

import { ctxOf } from './base';
import { ContractViolation, FakeAppClient, REQUIRED_TOPICS, type AppClientScenario, type ScenarioViewEntry } from './fake-app-client';
import { fallbackView } from './gallery';
import { createFakeMountDeps, formatMoneyMills } from './ports';
import { APP_CLIENT_SCENARIOS, scenarioById } from './scenarios';

/** Every view snapshot a scenario can show: its initial views and every step. */
function snapshots(scenario: AppClientScenario): ScenarioViewEntry[] {
  return [...scenario.views, ...(scenario.steps ?? []).flatMap((step) => step.views)];
}
const ALL = APP_CLIENT_SCENARIOS.flatMap(snapshots);
const of = <N extends ViewName>(name: N) => ALL.filter((e) => e.selector.of === name);

/** Depth-first walk over plain data. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value !== null && typeof value === 'object') {
    visit(value as Record<string, unknown>);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

const isActionType = (value: unknown): value is UiActionType => typeof value === 'string' && (UI_ACTION_TYPES as readonly string[]).includes(value);

describe('AppClient scenarios', () => {
  it('have unique ids and increasing step times', () => {
    const ids = APP_CLIENT_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of APP_CLIENT_SCENARIOS) {
      const times = (scenario.steps ?? []).map((step) => step.at);
      expect(times, scenario.id).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('cover every topic of §10.2 п. 7', () => {
    const covered = new Set(APP_CLIENT_SCENARIOS.flatMap((s) => s.covers));
    expect(REQUIRED_TOPICS.filter((topic) => !covered.has(topic))).toEqual([]);
  });

  it('reach every view in every state its controller produces', () => {
    const seen = new Set(ALL.map((e) => `${e.selector.of}:${(e.vm as { view: { s: string } }).view.s}`));
    const missing = VIEW_NAMES.flatMap((name) => VM_STATE_SUPPORT[name].map((state) => `${name}:${state}`)).filter((key) => !seen.has(key));
    expect(missing).toEqual([]);
  });

  it('use valid selectors only', () => {
    for (const e of ALL) expect(ViewSelectorSchema.safeParse(e.selector).success, JSON.stringify(e.selector)).toBe(true);
  });

  it('carry only valid UiActions', () => {
    const bad: string[] = [];
    for (const e of ALL)
      walk(e.vm, (node) => {
        if (isActionType(node['type']) && !UiActionSchema.safeParse(node).success) bad.push(`${e.selector.of}: ${JSON.stringify(node)}`);
      });
    for (const scenario of APP_CLIENT_SCENARIOS) for (const r of scenario.reactions ?? []) expect(UI_ACTION_TYPES).toContain(r.on);
    expect(bad).toEqual([]);
  });

  it('render every error with registry texts', () => {
    const bad: string[] = [];
    for (const e of ALL)
      walk(e.vm, (node) => {
        if (typeof node['code'] === 'string' && typeof node['title'] === 'string' && typeof node['body'] === 'string') {
          const view = CgErrorViewSchema.safeParse(node);
          const entry = view.success ? cgEntry(view.data.code) : null;
          const fromCatalog =
            entry !== null &&
            LOCALES.some((locale) => {
              const t = createTranslator(locale);
              return node['title'] === t.text(entry.title) && node['body'] === t.text(entry.body);
            });
          if (!fromCatalog) bad.push(`${e.selector.of}: ${String(node['code'])}`);
        }
      });
    expect(bad).toEqual([]);
  });

  it('use synthetic ids only', () => {
    const long: string[] = [];
    for (const scenario of APP_CLIENT_SCENARIOS)
      walk(scenario, (node) => {
        for (const value of Object.values(node)) if (typeof value === 'string' && /^\d{5,}$/.test(value)) long.push(value);
      });
    expect(long).toEqual([]);
  });

  it('come in both languages and both schemes', () => {
    expect(new Set(APP_CLIENT_SCENARIOS.map((s) => s.language))).toEqual(new Set(['ru', 'en']));
    expect(new Set(APP_CLIENT_SCENARIOS.map((s) => s.scheme))).toEqual(new Set(['light', 'dark']));
    expect(new Set(APP_CLIENT_SCENARIOS.map((s) => s.platform))).toEqual(new Set(['mac', 'win']));
  });
});

describe('dock', () => {
  const docks = of('dock').map((e) => e.vm as DockVM);

  it('reaches every status, and both host-degraded codes', () => {
    expect(new Set(docks.map((d) => d.status))).toEqual(new Set(DOCK_STATUSES));
    const degraded = new Set(docks.filter((d) => d.status === 'host-degraded').map((d) => d.statusError?.code));
    expect(degraded).toEqual(new Set(['CG-HOST-CONTRACT', 'CG-HOST-COMPOSER-MISSING']));
    for (const d of docks.filter((x) => x.status === 'host-degraded' || x.status === 'blocked-fan')) expect(d.mode).toBe('copy-only');
  });

  it('gives every disabled action a reason and no key label', () => {
    for (const d of docks)
      for (const action of Object.values(d.actions)) {
        if (!action.enabled) {
          expect(action.reason).not.toBeNull();
          expect(action.hotkey).toBeNull();
        }
      }
  });

  it('turns everything off where the status says so, and at quota 0', () => {
    const allOff = new Set(['loading-chat', 'not-signed-in', 'no-binding', 'no-persona', 'hub-down', 'reload-needed']);
    for (const d of docks) {
      if (allOff.has(d.status) || d.quota?.remaining === 0) expect(Object.values(d.actions).every((a) => !a.enabled), d.status).toBe(true);
    }
  });

  it('while one runs, the other six say the chat is busy', () => {
    const running = docks.filter((d) => Object.values(d.actions).some((a) => a.busy));
    expect(running.length).toBeGreaterThan(0);
    for (const d of running) for (const a of Object.values(d.actions)) if (!a.busy) expect(a.reason?.id).toBe('chat-busy');
  });

  it('has the persona page name and an ISO quota reset', () => {
    expect(docks.some((d) => d.persona?.pageName === 'LoraVie VIP')).toBe(true);
    const quotas = docks.flatMap((d) => (d.quota === null ? [] : [d.quota]));
    expect(quotas.some((q) => q.remaining === 0)).toBe(true);
    for (const q of quotas) if (q.resetsAt !== null) expect(q.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('distinguishes one message from «получилась одна часть»', () => {
    const results = docks.flatMap((d) => (d.result === null ? [] : [d.result]));
    const singles = results.filter((r) => r.parts?.length === 1 && !r.unparsed);
    expect(new Set(singles.map((r) => r.splitRequested))).toEqual(new Set([true, false]));
    expect(results.some((r) => r.fix !== null && r.fix.sourceDraft.length > 0)).toBe(true);
    expect(results.some((r) => r.confirm?.formatLoss === true)).toBe(true);
    expect(results.every((r) => r.startedAt > 0)).toBe(true);
  });
});

describe('preview sends (X8)', () => {
  const previews = of('preview').map((e) => e.vm as PreviewVM);
  const results = previews.flatMap((p) => (p.result === null ? [] : [p.result]));
  const allParts = results.flatMap((r) => [...(r.parts ?? []), ...(r.variants ?? []).flatMap((v) => v.parts)]);

  it('show all nine send states', () => {
    expect(new Set(allParts.flatMap((p) => (p.send === undefined ? [] : [p.send.s])))).toEqual(new Set(PREVIEW_SEND_STATES));
  });

  it('allow a retry only where the registry does, never after an unknown outcome', () => {
    const rejected = allParts.flatMap((p) => (p.send?.s === 'rejected' ? [p.send] : []));
    expect(new Set(rejected.map((r) => r.canRetry))).toEqual(new Set([true, false]));
    for (const r of rejected) expect(r.canRetry).toBe(r.code === 'CG-SEND-QUEUE');
    for (const p of allParts) if (p.send?.s === 'uncertain') expect(p.openInsert).toEqual({ s: 'hidden' });
  });

  it('hold «Ещё раз» while a part is in work or uncertain, and drop «не отправлено» once sending started', () => {
    for (const r of results) {
      const states = (r.parts ?? []).flatMap((p) => (p.send === undefined ? [] : [p.send.s]));
      const blocking = states.some((s) => s === 'queued' || s === 'sending' || s === 'accepted' || s === 'uncertain');
      expect(r.canRegenerate, r.opId).toBe(!blocking);
      const started = states.some((s) => s !== 'available' && s !== 'unavailable' && s !== 'held-stale');
      expect(r.draftNotSent).toBe(!started);
    }
  });

  it('reach every greeting and lease state; a colleague\'s lease has no countdown', () => {
    const greetings = new Set<string>();
    const claims = new Set<string>();
    for (const e of [...of('newcomers'), ...of('preview')])
      walk(e.vm, (node) => {
        if (node['s'] === 'claim-other' || (node['s'] === 'other' && 'by' in node)) expect('until' in node).toBe(false);
      });
    for (const p of previews) {
      if (p.greeting !== null) greetings.add(p.greeting.s);
      if (p.claim !== null) claims.add(p.claim.s);
    }
    for (const e of of('newcomers')) for (const row of (e.vm as { rows: { greeting: { s: string } }[] }).rows) greetings.add(row.greeting.s);
    expect(GREETING_STATUSES.filter((s) => !greetings.has(s))).toEqual([]);
    const required = CLAIM_STATES.filter((s) => s !== 'row-changed');
    expect(required.filter((s) => !claims.has(s))).toEqual([]);
  });
});

describe('Review', () => {
  it('uses the parity blocks and carries its window', () => {
    const ready = of('review').map((e) => e.vm as ReviewVM).filter((r) => r.view.s === 'ready');
    expect(ready.length).toBeGreaterThan(0);
    for (const r of ready) {
      expect(r.window?.messages).toBeGreaterThan(0);
      const kinds = r.sections.map((s) => s.kind);
      for (const kind of ['verdict', 'money', 'persona', 'mistakes'] as const) expect(kinds).toContain(kind);
      for (const kind of kinds) expect([...REVIEW_SECTION_KINDS, 'recommendations']).toContain(kind);
    }
  });
});

describe('FakeAppClient', () => {
  const ctx = ctxOf();

  it('rejects an action outside the contract and records valid ones', async () => {
    const client = new FakeAppClient(scenarioById('streaming'), (s) => fallbackView(ctx, s));
    const raw = { type: 'Generate', targetHandle: 'dock:f2002', feature: 'reply', options: { persona: 'lora' } } as unknown as Parameters<typeof client.dispatch>[0];
    await expect(client.dispatch(raw)).rejects.toBeInstanceOf(ContractViolation);
    const receipt = await client.dispatch({ type: 'CancelGeneration', operationId: '00000000-0000-4000-8000-000000000065' });
    expect(receipt).toEqual({ ok: true, type: 'CancelGeneration', outcome: 'done' });
    expect(client.dispatched).toHaveLength(1);
  });

  it('plays the timeline, notifies subscribers and moves the clock', async () => {
    const scenario = scenarioById('streaming');
    const client = new FakeAppClient(scenario, (s) => fallbackView(ctx, s));
    const seen: string[] = [];
    const unsubscribe = client.subscribe({ of: 'dock' }, (dock) => seen.push(dock.result?.state ?? 'none'));
    expect(client.getSnapshot({ of: 'dock' }).result?.state).toBe('admitted');
    const receipt = await client.dispatch({ type: 'Generate', targetHandle: 'dock:f2002', feature: 'reply', options: {} });
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    while (client.advance()) {
      /* play to the end */
    }
    expect(seen).toEqual(['requesting', 'streaming', 'streaming', 'done']);
    expect(client.now()).toBe(scenario.now + 3_800);
    expect(client.advance()).toBe(false);
    unsubscribe();
  });

  it('answers an unset view with its loading state and toasts with empty', () => {
    const client = new FakeAppClient(scenarioById('no-binding'), (s) => fallbackView(ctx, s));
    const selector: ViewSelector = { of: 'spenders.board' };
    expect(client.getSnapshot(selector).view.s).toBe('loading');
    expect(client.getSnapshot({ of: 'toasts' }).view.s).toBe('empty');
  });

  it('refuses a fourth generation with the running list', async () => {
    const client = new FakeAppClient(scenarioById('three-running-fourth-refused'), (s) => fallbackView(ctx, s));
    const receipt = await client.dispatch({ type: 'Generate', targetHandle: 'dock:f2002', feature: 'reply', options: {} });
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) {
      expect(receipt.code).toBe('CG-OP-TAB-LIMIT');
      expect(receipt.running).toHaveLength(3);
    }
  });

  it('builds mount deps with one money notation', () => {
    const client = new FakeAppClient(scenarioById('en-dark'), (s) => fallbackView(ctx, s));
    const deps = createFakeMountDeps(client, ctxOf({ lang: 'en' }));
    expect(deps.scheme.value).toBe('dark');
    expect(deps.i18n.language).toBe('en');
    expect(formatMoneyMills(12_480_000)).toBe('$12,480');
    expect(formatMoneyMills(320_000, { sign: 'plus' })).toBe('+$320');
    expect(formatMoneyMills(-45_000)).toBe('−$45');
    expect(formatMoneyMills(0)).toBe('');
    expect(formatMoneyMills(null)).toBe('—');
    expect(deps.i18n.t('result.meta.parts', { n: 3 })).toBe('en:result.meta.parts(n=3)');
  });
});
