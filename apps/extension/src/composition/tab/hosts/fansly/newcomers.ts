// «Новые» on a Fansly tab, wired (R20 P10a; docs/project-unite/architecture.md §8.7, §8.15; FS-NEW-1; NF-001…NF-011,
// NF-025…NF-027, FX-017). The shared boards of the tab make «Новые» with `createNewcomersController`; Fansly's build of
// the boards chunk (lazy/fansly/boards.ts) answers that call with this one: the pass controller of core
// (application/newcomers/pass.ts) over Fansly's source (application/hosts/fansly/newcomers.ts), which asks Fansly's
// background module through the tab's port — `fansly.followers.*`, each answer and each `fansly.followers.changed`
// checked by Fansly's registry here, in the chunk that asks (NF-027; requests.ts) —, and opens a fan's chat on the
// page's own origin. The dock's chip and the popup open it as on ChatSpace (`Navigate` to `newcomers`); its window is
// Fansly's own surface (lazy/fansly/newcomers.ts). The hub's list of ChatSpace is not in this build.

import { createFanslyNewcomersSource, type FanslyFollowersPort } from '@cg/core/application/hosts/fansly/newcomers';
import type { NewcomersController, NewcomersControllerDeps } from '@cg/core/application/newcomers';
import { createPassNewcomersController } from '@cg/core/application/newcomers/pass';

import { fanslyEvent, fanslyRequest } from './requests';

/** A read of the pass waits for the background's module like the vault's (it may wake the event page first). */
export const NEWCOMERS_REQUEST_TIMEOUT_MS = 15_000;

/** The boards' port to the background (the shared `TabRpc`), as the window of «Новые» asks Fansly's module. */
export function fanslyFollowersPort(rpc: NewcomersControllerDeps['rpc'], timeoutMs = NEWCOMERS_REQUEST_TIMEOUT_MS): FanslyFollowersPort {
  return {
    request: (type, payload) => fanslyRequest(rpc, type, payload, timeoutMs),
    onChanged: (listener) => fanslyEvent(rpc, 'fansly.followers.changed', listener),
    onReconnect(listener) {
      if (rpc.onState === undefined) return () => undefined;
      // `ready` again after the port was down: the changes meanwhile are lost.
      let down = (rpc.state?.() ?? 'ready') !== 'ready';
      return rpc.onState((state) => {
        if (state === 'ready') {
          if (down) listener();
          down = false;
        } else down = true;
      });
    },
  };
}

/** The boards' «Новые» on a Fansly tab: the shared factory's signature, the pass over Fansly's own module. */
export function createFanslyNewcomersController(deps: NewcomersControllerDeps, origin: string = globalThis.location.origin): NewcomersController {
  const source = createFanslyNewcomersSource(fanslyFollowersPort(deps.rpc), origin);
  return createPassNewcomersController({ source, i18n: deps.i18n, clock: deps.clock, context: deps.context, surfaces: deps.surfaces });
}
