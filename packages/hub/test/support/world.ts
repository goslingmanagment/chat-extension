// Picks the answers of a scenario by route, so tests build their world from
// the fake hub's scenarios (passed in by the test) without importing the
// harness package here.

import { type HubRouteKey } from '@cg/contracts';

import { type ExchangeLike } from './fake-hub';
import { type SignInWorld } from './harness';

export interface ScenarioLike {
  readonly name: string;
  readonly exchanges: readonly ExchangeLike[];
}

export function scenarioNamed<S extends { readonly name: string }>(scenarios: readonly S[], name: string): S {
  const found = scenarios.find((scenario) => scenario.name === name);
  if (found === undefined) throw new Error(`no scenario ${name}`);
  return found;
}

/** The first successful answer of `route` in the scenario. */
export function okBody(scenario: ScenarioLike, route: HubRouteKey): unknown {
  const found = scenario.exchanges.find((exchange) => exchange.route === route && exchange.response.status < 300);
  if (found === undefined) throw new Error(`${scenario.name}: no successful ${route}`);
  return found.response.body;
}

export function signInWorld(scenario: ScenarioLike, bootstrap: unknown, login: string): SignInWorld {
  return {
    login,
    password: 'synthetic-password',
    issued: okBody(scenario, 'authIssueDeviceTokenWithPassword') as Record<string, unknown>,
    me: okBody(scenario, 'me'),
    bootstrap,
    catalog: okBody(scenario, 'aiPersonaCatalog'),
  };
}
