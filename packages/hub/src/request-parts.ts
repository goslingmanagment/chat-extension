// A facade-level request → what goes on the wire, for the routes whose
// contract request is one flat object (hub-pr-plan §4): the `:param`s of the
// route's path (the vendored SDK's manifest path) are taken out of it, and the
// rest is the query (GET) or the body (a claim carries its body under
// `body`).
//
// The request is checked against its strict contract schema first: a request
// that fails it is our bug and is never sent (HB-006).

import { HUB_ROUTE_SCHEMAS, type HubRouteKey } from '@cg/contracts';

export interface RequestParts {
  /** Path parameters by name, as the request gave them. */
  readonly params: Readonly<Record<string, string | number>>;
  /** What is left of the request once the path parameters are taken. */
  readonly rest: Readonly<Record<string, unknown>>;
}

/** `:name` segments of a path template (`/pages/:pageLabel/fans/:fanRef/claim` → pageLabel, fanRef). */
export function pathParamNames(template: string): string[] {
  return [...template.matchAll(/\/:([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');
}

/** Throws a TypeError when the request fails its contract schema or lacks a path parameter. */
export function requestParts(route: HubRouteKey, template: string, request: unknown): RequestParts {
  const schema = HUB_ROUTE_SCHEMAS[route].request;
  let fields: Record<string, unknown> = {};
  if (schema !== null) {
    const parsed = schema.safeParse(request);
    if (!parsed.success) throw new TypeError(`${route}: request fails its contract schema`);
    fields = { ...(parsed.data as Record<string, unknown>) };
  }
  const params: Record<string, string | number> = {};
  for (const name of pathParamNames(template)) {
    const value = fields[name];
    if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${route}: missing path param ${name}`);
    params[name] = value;
    delete fields[name];
  }
  return { params, rest: fields };
}

/** The body of a POST: the request's own `body` field when it has one, else everything that is not a path parameter. */
export function bodyOf(rest: Readonly<Record<string, unknown>>): unknown {
  return Object.prototype.hasOwnProperty.call(rest, 'body') ? rest['body'] : rest;
}
