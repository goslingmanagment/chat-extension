// A reopened result is checked against its own hub answer and the current MAIN window. Snapshots contain no texts.
// Keep only checks for the current observation; any host signal about its history invalidates in-flight answers too.
import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import type { HostPort } from '@cg/contracts/host';
import { chatKeyOf } from '@cg/contracts/ids';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import type { OpView } from '@cg/contracts/ops';

import { startProofOf } from './proof';
import { fingerprintOf, type ProofFingerprint } from './verdict';

export function resultChecks(now: () => number): {
  watch(host: HostPort, changed: () => void): () => void;
  current(view: OpView, fallback: ProofFingerprint | null): ProofFingerprint | null;
} {
  let host: HostPort | null = null;
  let changed = (): void => undefined;
  const checks = new Map<string, { fingerprint: ProofFingerprint | null }>();
  return {
    watch(port, notify) {
      host = port;
      changed = notify;
      const off = port.subscribe((event) => {
        if (['route', 'accounts', 'incoming', 'coverage', 'chatCache', 'reloadNeeded'].includes(event.type)) {
          checks.clear();
          changed();
        }
      });
      return () => { off(); checks.clear(); host = null; changed = () => undefined; };
    },
    current(view, fallback) {
      if (host === null || view.state !== 'done' || view.freshnessProof === undefined || view.servedContext?.coverageCheck === undefined) return fallback;
      const route = host.current().route;
      if (route.chat === null || chatKeyOf(route.chat) !== chatKeyOf(view.target.chat) || route.conversationRef !== view.target.conversationRef) return null;
      const freshness = (host as Partial<FanslyHostPort>).freshness;
      if (freshness === undefined || route.conversationRef === undefined) return null;
      const cached = checks.get(view.opId);
      if (cached !== undefined) return cached.fingerprint;
      const check = { fingerprint: null as ProofFingerprint | null };
      checks.set(view.opId, check);
      while (checks.size > STORAGE_LIMITS.resultsPerTab) checks.delete(checks.keys().next().value ?? '');
      const request = { conversationRef: route.conversationRef, feature: view.feature, window: view.freshnessProof.windowSize, withText: false };
      const chat = route.chat;
      void Promise.resolve().then(() => freshness.snapshot(chat, request)).then((snapshot) => {
        if (checks.get(view.opId) !== check) return;
        if (snapshot !== null && snapshot.identity.groupId === request.conversationRef && snapshot.identity.fanId === view.target.fanRef && snapshot.identity.creatorId === view.target.chat.hostAccountId) {
          check.fingerprint = fingerprintOf(startProofOf(snapshot, null, new Date(now()).toISOString()));
        }
        changed();
      }, () => { if (checks.get(view.opId) === check) changed(); });
      return null;
    },
  };
}
