// The world a kit surface runs in on the stand and in tests (architecture.md
// §10.2 п. 7): a FakeAppClient scenario and its MountDeps with the REAL I18n
// port of core, so texts, plurals and the money notation are the shipped
// ones. No DOM and no test utilities here: the gallery page uses it too.

import { CHATSPACE_PHRASES } from '@cg/core/domain/hosts/chatspace/i18n';
import { createI18n, type LiveI18n, type SitePhrases } from '@cg/core/domain/i18n';
import { type Locale } from '@cg/contracts';

import {
  FakeAppClient,
  createFakeMountDeps,
  ctxOf,
  fallbackView,
  scenarioById,
  type AppClientScenario,
  type FakeMountDeps,
  type ScenarioCtx,
} from '../scenarios/app-client';

export type KitDeps = Omit<FakeMountDeps, 'i18n'> & { readonly i18n: LiveI18n };

export interface KitWorld {
  readonly scenario: AppClientScenario;
  readonly ctx: ScenarioCtx;
  readonly client: FakeAppClient;
  readonly deps: KitDeps;
}

/**
 * A scenario (by id or as given), its client and MountDeps with the real I18n in the scenario's language (UTC).
 * `phrases` — the site the texts speak of (R20 F9b): ChatSpace's, as its tab has them, unless a gallery draws another.
 */
export function kitWorld(scenario: string | AppClientScenario = 'gallery-ready', language?: Locale, phrases: SitePhrases = CHATSPACE_PHRASES): KitWorld {
  const chosen = typeof scenario === 'string' ? scenarioById(scenario) : scenario;
  const lang = language ?? chosen.language;
  // What a gallery writes out itself (an error's texts) names the site it draws too.
  const ctx = ctxOf({ lang, platform: chosen.platform, debug: chosen.debug, ...(phrases === CHATSPACE_PHRASES ? {} : { phrases }) });
  const client = new FakeAppClient(chosen, (selector) => fallbackView(ctx, selector));
  const fake = createFakeMountDeps(client, ctx);
  const deps: KitDeps = { ...fake, i18n: createI18n({ language: lang, now: () => client.now(), timeZone: 'UTC', phrases }) };
  return { scenario: chosen, ctx, client, deps };
}

