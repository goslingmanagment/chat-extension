// What an operation needs from its environment and when the environment
// takes it away (architecture.md §7 «Отмена», «Ограда»; §8.2–§8.3; AI-121,
// AI-126). Before a start: a sign-in, a binding of this sign-in, the page in
// the current bootstrap at the same binding revision, a persona assigned to
// the page, the owner's switches of that page (flags.ts): its master switch
// and what the feature needs on the chat's site — the admission of its
// generation by the feature manifest (features/admission.ts). While running:
// an operation is canceled by itself
// only when its page's persona, the sign-in or the hub address changes —
// never by a chat switch or a closed tab (AI-124, BG-006).

import { type CgCode } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { type HostKind } from '@cg/contracts/hosts';
import { type Bootstrap } from '@cg/contracts/hub';
import { type SessionIdentity } from '@cg/contracts/ids';
import { type StartOp } from '@cg/contracts/ops';

import { admittedOn, featureKeyOf } from '../features/admission';
import { flagRefusalCode, pageSwitchedOff } from './flags';

export interface PersonaChoice {
  readonly key: string;
  readonly definitionId: string;
}

/** A read of the background's state at one moment. */
export interface OpsEnvironment {
  readonly session: SessionIdentity | null;
  /** The cached bootstrap, null while there is none (or it is unusable). */
  readonly bootstrap: Bootstrap | null;
  persona(pageId: number): PersonaChoice | null;
  readonly debug: boolean;
  /** The settings store loaded (RB-013: a failed load refuses with CG-STORAGE-READ; the tab keeps the person's input). */
  readonly settingsLoaded: boolean;
  /** A site's slice of the feature manifest (the composition root's table); null — this background has none for the site. */
  features(host: HostKind): FeatureSlice | null;
}

/** AI-121: the reason a start cannot run, or null. Checked before admission; nothing is spent on a refusal. */
export function startPrecondition(env: OpsEnvironment, start: Pick<StartOp, 'target'> & { readonly feature: string }, feature: string = featureKeyOf(start.feature)): CgCode | null {
  if (!env.settingsLoaded) return 'CG-STORAGE-READ';
  const session = env.session;
  if (session === null) return 'CG-AUTH-REQUIRED';
  const binding = start.target.binding;
  if (binding.hubOrigin !== session.hubOrigin || binding.principalId !== session.userId || binding.loginEpoch !== session.epoch) {
    return 'CG-CONTEXT-CHANGED';
  }
  const bootstrap = env.bootstrap;
  if (bootstrap === null) return 'CG-HUB-UNAVAILABLE';
  const page = bootstrap.pages.find((p) => p.pageId === binding.pageId);
  if (page === undefined) return 'CG-BINDING-NOT-GRANTED';
  if (page.bindingRevision !== binding.bindingRevision || page.pageLabel !== binding.pageLabel) return 'CG-CONTEXT-CHANGED';
  if (env.persona(binding.pageId) === null) return 'CG-PERSONA-UNASSIGNED';
  // The owner's master switch is off for the page: the hub refuses every AI call of this client there (409).
  if (pageSwitchedOff(page)) return 'CG-FEATURE-DISABLED';
  // What the feature needs on the chat's site to be generated (the hub checks the same, §4.12); the site's own
  // capabilities are the tab's to check.
  const admitted = admittedOn(env.features(binding.host), feature, 'generate', bootstrap, page);
  return admitted.usable ? null : flagRefusalCode(admitted.reason);
}

/** AI-122: «Чат ещё грузится» — the open chat's history is not in the host cache yet. */
export function chatLoadingGate(window: { readonly state: 'loading' | 'ready' } | null): CgCode | null {
  return window === null || window.state === 'loading' ? 'CG-GATE-CHAT-LOADING' : null;
}

/** What an operation is bound to; any change of these cancels it (§7 «Отмена», AI-126). */
export interface OpEnvTag {
  readonly hubOrigin: string;
  readonly userId: number;
  readonly signInEpoch: number;
  readonly pageId: number;
  readonly personaKey: string;
  readonly personaDefinitionId: string;
}

export type EnvironmentChange =
  /** A sign-in, a sign-out, a revoked or expired token: the epoch moves (§8.2). */
  | { readonly kind: 'session'; readonly next: SessionIdentity | null }
  | { readonly kind: 'hub'; readonly origin: string }
  | { readonly kind: 'persona'; readonly pageId: number; readonly next: PersonaChoice | null };

export function canceledByChange(tag: OpEnvTag, change: EnvironmentChange): boolean {
  switch (change.kind) {
    case 'session':
      return change.next === null || change.next.hubOrigin !== tag.hubOrigin || change.next.userId !== tag.userId || change.next.epoch !== tag.signInEpoch;
    case 'hub':
      return change.origin !== tag.hubOrigin;
    case 'persona':
      return change.pageId === tag.pageId && (change.next === null || change.next.definitionId !== tag.personaDefinitionId || change.next.key !== tag.personaKey);
  }
}
