// The fictitious entry of a second site's lazy build that carries that site's AI policy, as Fansly's application half
// will (docs/project-unite/architecture.md §1.6, §9.1; R20 F10): its rules — Ping blocked for an active fan, Hi refused
// only on a proven dialogue (FS-AI-1, FS-AI-2), the fingerprint kept with the operation, the verdict — handed to the
// shared AI workspace, which calls them. The real policy is P8b1–P8c's, in Fansly's own build. Fixture of
// test/feature-slices.test.ts.

import type { AiHostPolicy } from '@cg/contracts/ops';
import { AiWorkspace, type AiPorts } from '@cg/core/application/ai';

/** What the second site proves of a conversation before a start. */
interface SiteProof {
  readonly sitefixPersonal: number;
}

export const SITE_AI: AiHostPolicy<SiteProof, string> = {
  preflight: (feature, _window, proof) => (feature === 'ping' ? 'ping-gate' : feature === 'hi' && proof !== null && proof.sitefixPersonal > 10 ? 'hi-gate' : null),
  proof: () => Promise.resolve({ sitefixPersonal: 0 }),
  fields: () => ({}),
  fingerprint: (proof) => (proof === null ? null : `sitefix-proof:${String(proof.sitefixPersonal)}`),
  verdict: (_view, fingerprint) => (fingerprint === null ? null : { reason: 'archive-moved', at: null }),
};

/** The site's AI workspace, as its tab starts it: the shared controller with the site's policy. */
export const startSiteAi = (ports: Omit<AiPorts, 'policy'>): AiWorkspace => new AiWorkspace({ ...ports, policy: SITE_AI });
