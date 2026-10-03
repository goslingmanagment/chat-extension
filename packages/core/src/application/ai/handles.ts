// Opaque handles (architecture.md §10.2 «UI получает непрозрачный
// targetHandle»): the names the UI passes back unchanged. They are stateless
// on purpose — a target handle spells the chat it names — so any controller
// can read one, and every controller still checks it against the live state
// before it acts: a handle is a name, never a permission.

import { HOST_KINDS, type ChatRef, type HostKind } from '@cg/contracts/ids';
import { NATIVE_ID_PATTERN, UUID_PATTERN } from '@cg/contracts/primitives';
import { type ArtifactHandle, type TargetHandle } from '@cg/contracts/vm';

/** The surfaces a fan can be a target on. */
export type TargetSurface = 'dock' | 'spenders' | 'newcomers' | 'palette';
const TARGET_SURFACES: readonly TargetSurface[] = ['dock', 'spenders', 'newcomers', 'palette'];

export function targetHandle(surface: TargetSurface, chat: ChatRef): TargetHandle {
  return `${surface}:${chat.host}:${chat.hostAccountId}:${chat.platformFanId}`;
}

export function readTargetHandle(handle: string): { readonly surface: TargetSurface; readonly chat: ChatRef } | null {
  const [surface, host, account, fan, extra] = handle.split(':');
  if (extra !== undefined || surface === undefined || host === undefined || account === undefined || fan === undefined) return null;
  if (!(TARGET_SURFACES as readonly string[]).includes(surface) || !(HOST_KINDS as readonly string[]).includes(host)) return null;
  if (!NATIVE_ID_PATTERN.test(account) || !NATIVE_ID_PATTERN.test(fan)) return null;
  return { surface: surface as TargetSurface, chat: { host: host as HostKind, hostAccountId: account, platformFanId: fan } };
}

export type Artifact =
  /** One part of a result: a Split part, a part of a Hi variant, a part of a Coach draft. */
  | { readonly kind: 'part'; readonly opId: string; readonly variant: number | null; readonly index: number }
  | { readonly kind: 'review'; readonly opId: string }
  /** A Recap by the local id of its copy. */
  | { readonly kind: 'recap'; readonly localId: string };

export function artifactHandle(artifact: Artifact): ArtifactHandle {
  switch (artifact.kind) {
    case 'part':
      return `part:${artifact.opId}:${artifact.variant ?? '-'}:${artifact.index}`;
    case 'review':
      return `review:${artifact.opId}`;
    case 'recap':
      return `recap:${artifact.localId}`;
  }
}

const small = (text: string | undefined, max: number): number | null => {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return value <= max ? value : null;
};

export function readArtifactHandle(handle: string): Artifact | null {
  const [kind, id, variant, index, extra] = handle.split(':');
  if (id === undefined || !UUID_PATTERN.test(id) || extra !== undefined) return null;
  if (kind === 'review' && variant === undefined) return { kind: 'review', opId: id };
  if (kind === 'recap' && variant === undefined) return { kind: 'recap', localId: id };
  if (kind !== 'part') return null;
  const part = small(index, 99);
  const v = variant === '-' ? null : small(variant, 9);
  if (part === null || (variant !== '-' && v === null)) return null;
  return { kind: 'part', opId: id, variant: v, index: part };
}
