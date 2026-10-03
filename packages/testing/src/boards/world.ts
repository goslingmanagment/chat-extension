// The world a board surface runs in on the stand and in tests (architecture.md
// §10.2 п. 7): a FakeAppClient over a gallery state (or any AppClient
// scenario) and its MountDeps with the REAL I18n port of core, on the Moscow
// clock of the mockup («данные на 09:18»). No DOM here: the gallery page and
// the unit tests both use it.

import { createI18n, type LiveI18n } from '@cg/core/domain/i18n';
import { type Locale } from '@cg/contracts';

import { FakeAppClient, createFakeMountDeps, ctxOf, fallbackView, scenarioById, type AppClientScenario, type FakeMountDeps, type ScenarioCtx } from '../scenarios/app-client';
import { BOARD_STATES, boardScenario } from './states';

export type BoardDeps = Omit<FakeMountDeps, 'i18n'> & { readonly i18n: LiveI18n };

export interface BoardWorld {
  readonly scenario: AppClientScenario;
  readonly ctx: ScenarioCtx;
  readonly client: FakeAppClient;
  readonly deps: BoardDeps;
}

/** The mockup's clock: 2026-10-03 09:20 in Moscow. */
export const STAND_TIME_ZONE = 'Europe/Moscow';

/** A gallery state («11a») or an AppClient scenario id («stats-error»), in `language`. */
export function resolveScenario(id: string, language: Locale): AppClientScenario {
  return BOARD_STATES.some((state) => state.id === id) ? boardScenario(id, language) : scenarioById(id);
}

export function boardWorld(scenario: string | AppClientScenario, language: Locale = 'ru'): BoardWorld {
  const chosen = typeof scenario === 'string' ? resolveScenario(scenario, language) : scenario;
  const ctx = ctxOf({ lang: language, platform: chosen.platform, debug: chosen.debug });
  const client = new FakeAppClient(chosen, (selector) => fallbackView(ctx, selector));
  const fake = createFakeMountDeps(client, ctx);
  const deps: BoardDeps = { ...fake, i18n: createI18n({ language, now: () => client.now(), timeZone: STAND_TIME_ZONE }) };
  return { scenario: chosen, ctx, client, deps };
}
