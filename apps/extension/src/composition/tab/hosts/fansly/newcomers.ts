// «Новые» on a Fansly tab, wired (R20 P10a; docs/project-unite/architecture.md §8.7, §8.17; FS-NEW-1; NF-001…NF-011,
// NF-025…NF-027, FX-017). The shared boards of the tab make «Новые» with `createNewcomersController`; Fansly's build of
// the boards chunk (lazy/fansly/boards.ts) answers that call with this one: the pass controller of core
// (application/newcomers/pass.ts) over Fansly's source (application/hosts/fansly/newcomers.ts), which asks Fansly's
// background module through the tab's port — `fansly.followers.*`, each answer and each `fansly.followers.changed`
// checked by Fansly's registry here, in the chunk that asks (NF-027; requests.ts) —, and opens a fan's chat on the
// page's own origin. The dock's chip and the popup open it as on ChatSpace (`Navigate` to `newcomers`); its window is
// Fansly's own surface (lazy/fansly/newcomers.ts). The hub's list of ChatSpace is not in this build.
// R20 P10c: the card's greeting (core application/newcomers/greeting.ts) — the tab's port for its Hi and its human
// action tokens, the host for «Открыть и вставить» and the person's own send, and Fansly's verdict over a generation
// (spec §3.5): an unchanged AI text goes only on its own fresh verdict (FS-TAIL-8).

import { createFanslyNewcomersSource, type FanslyFollowersPort } from '@cg/core/application/hosts/fansly/newcomers';
import type { NewcomersController, NewcomersControllerDeps } from '@cg/core/application/newcomers';
import { createPassNewcomersController } from '@cg/core/application/newcomers/pass';
import { verdictMark } from '@cg/core/domain/hosts/fansly/verdict';
import type { FanslyPort } from '@cg/host-fansly/isolated';

import { fanBadgesRead, fanslyEvent, fanslyRequest } from './requests';

/** A read of the pass waits for the background's module like the vault's (it may wake the event page first). */
export const NEWCOMERS_REQUEST_TIMEOUT_MS = 15_000;
/** The fan's group found or made for a reminder's «Hi»: above the background's own budget (RESOLVE_BUDGET_MS, 15 s), as Spenders. */
export const GREET_CHAT_TIMEOUT_MS = 17_000;
/** The check window of the open chat's snapshot a reminder's «Hi» reads the start of (the pass's own window, P1a). */
const GREET_CHECK_WINDOW = 30;

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
  return createPassNewcomersController({
    source,
    // 2026-10-28: the new followers' badges (FBuddy's gem, Fansly's blue card).
    badges: fanBadgesRead(deps.rpc),
    i18n: deps.i18n,
    clock: deps.clock,
    context: deps.context,
    surfaces: deps.surfaces,
    greeting: {
      rpc: deps.rpc,
      host: deps.host,
      ids: { uuid: () => globalThis.crypto.randomUUID() },
      // The generation's own evidence is its current one too: the card has no newer window of the pass to add.
      verdict: (view) => verdictMark(view, view.freshnessProof?.fingerprint ?? null)?.reason ?? null,
    },
    // 2026-10-26: «Hi» of a greeting reminder opens the fan's chat straight away. Its group: the one the page already
    // received (MAIN's memory, no request), else Spenders' own way under the click — the inbox is not searched without a
    // name, `POST /group` gets or makes the fan's direct group by identity (FS-NET-1 `spenders`, one attempt).
    greet: {
      async conversationOf(creatorId, fanRef) {
        const host = deps.host as Partial<FanslyPort>;
        const known = (await host.groupForFan?.(creatorId, fanRef).catch(() => null)) ?? null;
        if (known !== null) return known;
        const answer = await fanslyRequest(deps.rpc, 'fansly.spenders.resolve', { hostAccountId: creatorId, fanRef, displayName: null, username: null }, GREET_CHAT_TIMEOUT_MS);
        return answer.ok && answer.payload.ok ? answer.payload.groupId : null;
      },
      // The creator's personal messages in the open chat as MAIN holds it — only once it proved the conversation's
      // start (Hi's own count: welcome texts and automations left out); null — not proven, or no snapshot.
      async personalIn(chat, conversationRef) {
        const freshness = (deps.host as Partial<FanslyPort>).freshness;
        const snapshot = (await freshness?.snapshot(chat, { conversationRef, feature: 'hi', window: GREET_CHECK_WINDOW, withText: false }).catch(() => null)) ?? null;
        return snapshot?.startProof?.personalCount ?? null;
      },
    },
  });
}
