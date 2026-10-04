// What an operation needs from its environment and when the environment
// takes it away (architecture.md §7 «Отмена», «Ограда»; §8.2–§8.3; AI-121,
// AI-126). Before a start: a sign-in, a binding of this sign-in, the page in
// the current bootstrap at the same binding revision, a persona assigned to
// the page, the feature's owner switch. While running: an operation is
// canceled by itself only when its page's persona, the sign-in or the hub
// address changes — never by a chat switch or a closed tab (AI-124, BG-006).

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { CLIENT_FLAG_REQUIREMENTS, isFlagOn, type Bootstrap, type ClientFeatureFlag } from '@cg/contracts/hub';
import { type SessionIdentity } from '@cg/contracts/ids';
import { type StartOp } from '@cg/contracts/ops';

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
}

/** The owner switch a feature depends on (the hub checks the same, §4.12); null — none. */
export const FEATURE_FLAGS: Readonly<Record<FeatureId, ClientFeatureFlag | null>> = {
  reply: null,
  fix: null,
  hi: null,
  ping: null,
  review: 'review',
  recap: 'recap',
  'recap-short': 'recap',
  coach: 'coach',
};

/**
 * A flag is usable on a page only when it is on, the page's feature is
 * `available`, and every capability it needs is declared (§4.12).
 */
export function flagUsable(bootstrap: Bootstrap | null, pageId: number, flag: ClientFeatureFlag): boolean {
  if (bootstrap === null) return false;
  if (!isFlagOn(bootstrap.flags, flag)) return false;
  const page = bootstrap.pages.find((p) => p.pageId === pageId);
  if (page === undefined || page.features[flag]?.available !== true) return false;
  return CLIENT_FLAG_REQUIREMENTS[flag].capabilities.every((capability) => bootstrap.capabilities.includes(capability));
}

/** AI-121: the reason a start cannot run, or null. Checked before admission; nothing is spent on a refusal. */
export function startPrecondition(env: OpsEnvironment, start: StartOp): CgCode | null {
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
  const flag = FEATURE_FLAGS[start.feature];
  if (flag !== null && !flagUsable(bootstrap, binding.pageId, flag)) return 'CG-FEATURE-DISABLED';
  return null;
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
