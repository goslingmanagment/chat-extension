// What a change of the background's stores means (architecture.md §7
// «Отмена», §9.4; BG-005, AI-126). A settings change is broadcast to every
// tab and page (`settings.changed`); a new hub address cancels every
// operation of the old hub and drops what belongs to it (the Spenders board,
// the persona catalog and the persona choices, whose pageIds are numbers of
// one hub); a page's persona choice that changed cancels that page's
// operations. Sign-in changes reach the scheduler as `session` changes from
// the hub layer. Pure: the background applies the plan.

import { type SettingsV1 } from '@cg/contracts/settings';

import { canonicalJson, type EnvironmentChange, type PersonaChoice } from '../domain/ops';

export type ResetTarget = 'board' | 'catalog' | 'personas';

export interface ChangePlan {
  /** Send `settings.changed` to every tab and page. */
  readonly broadcastSettings: boolean;
  /** For OpScheduler.environmentChanged, in order. */
  readonly environment: readonly EnvironmentChange[];
  readonly reset: readonly ResetTarget[];
}

export const NO_CHANGE: ChangePlan = { broadcastSettings: false, environment: [], reset: [] };

const sameChoice = (a: PersonaChoice | undefined, b: PersonaChoice | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.key === b.key && a.definitionId === b.definitionId;

export function settingsChangePlan(prev: SettingsV1 | null, next: SettingsV1): ChangePlan {
  if (prev !== null && canonicalJson(prev) === canonicalJson(next)) return NO_CHANGE;
  const environment: EnvironmentChange[] = [];
  const reset: ResetTarget[] = [];
  if (prev !== null && prev.hub.baseUrl !== next.hub.baseUrl) {
    environment.push({ kind: 'hub', origin: next.hub.baseUrl });
    reset.push('board', 'catalog', 'personas');
  } else if (prev !== null) {
    const pages = new Set([...Object.keys(prev.personas.byPageId), ...Object.keys(next.personas.byPageId)]);
    for (const page of [...pages].sort((a, b) => Number(a) - Number(b))) {
      const before = prev.personas.byPageId[page];
      const after = next.personas.byPageId[page];
      if (!sameChoice(before, after)) environment.push({ kind: 'persona', pageId: Number(page), next: after ?? null });
    }
  }
  return { broadcastSettings: true, environment, reset };
}
