// Fansly's freshness port (docs/project-unite/architecture.md §5.8, §7.7;
// FS-TAIL-6, FS-TAIL-7, FS-IDN-6): the generation snapshot MAIN takes in one
// synchronous step on the person's Generate click — the check window, the
// fan's known messages, the deletions the tab saw, for a draft function the
// texts, for Hi the start proof — asked through the bridge
// (`fx.generationSnapshot`). The site's AI policy turns it into the start's
// proof (P8b1).
//
// - The group is the TARGET's conversation (`request.conversationRef`), never
//   the open route's: a start for a chat the person is not looking at asks
//   for its own group (FS-IDN-6).
// - Page text only for Reply, Fix, Hi and Ping (D-14): `withText` is dropped
//   for any other function before MAIN is asked.
// - The answer must be of this very chat and this document: MAIN's creator,
//   group and fan equal to the target's, its document epoch the one the
//   bridge knows, the function the one asked (FS-RTE-4, RB-014). Anything
//   else — or no MAIN, a MAIN that cannot take one yet (`not-ready`), a
//   timeout — is null: «свежесть не проверена» (FS-TAIL-7), never a guess.

import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { FeatureId } from '@cg/contracts/features';
import type { FreshnessPort, FreshnessRequest } from '@cg/contracts/host';
import type { ChatRef } from '@cg/contracts/ids';

import type { FanslyMainBridgeClient } from './bridge-client';

/** contracts FRESH_TEXT_FEATURES (D-14), repeated: that module builds schemas at load (freshness.test.ts pins the two). */
export const FRESH_TEXT_FEATURES: readonly FeatureId[] = ['reply', 'fix', 'hi', 'ping'];

export interface FreshnessDeps {
  readonly bridge: FanslyMainBridgeClient | null;
  /** Before MAIN is asked: our UI acted, the address is looked at once more (route.ts). */
  readonly beforeAsk?: () => void;
  readonly onDiagnostic?: (diagnostic: { readonly event: string; readonly detail?: Readonly<Record<string, string | number | boolean | null>> }) => void;
}

export function createFreshnessPort(deps: FreshnessDeps): FreshnessPort<FanslySnapshot> {
  const { bridge } = deps;
  return {
    async snapshot(chat: ChatRef, request: FreshnessRequest): Promise<FanslySnapshot | null> {
      deps.beforeAsk?.();
      if (bridge === null || chat.host !== 'fansly-web' || !Number.isSafeInteger(request.window) || request.window < 1) return null;
      const groupId = request.conversationRef;
      let snapshot: FanslySnapshot | null;
      try {
        snapshot = await bridge.request('fx.generationSnapshot', { groupId, feature: request.feature, window: request.window, withText: request.withText && FRESH_TEXT_FEATURES.includes(request.feature) });
      } catch {
        return null;
      }
      if (snapshot === null) return null;
      const { identity } = snapshot;
      const fits =
        snapshot.feature === request.feature &&
        identity.groupId === groupId &&
        identity.creatorId === chat.hostAccountId &&
        identity.fanId === chat.platformFanId &&
        snapshot.epochs.document === bridge.documentEpoch;
      if (fits) return snapshot;
      deps.onDiagnostic?.({ event: 'snapshot-foreign', detail: { feature: request.feature } });
      return null;
    },
  };
}
