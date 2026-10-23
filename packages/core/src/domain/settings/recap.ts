// «Учитывать Recap» of a feature (1.52.0): where its «с Recap» starts in every chat.

import { type RecapReader } from '@cg/contracts/features';
import { type SettingsV1 } from '@cg/contracts/settings';

/** The feature's own choice, else the shared one of 1.50.0, else on. */
export function recapByDefault(settings: Pick<SettingsV1, 'generation'> | null | undefined, feature: RecapReader): boolean {
  const generation = settings?.generation;
  return (generation?.recapBy?.[feature] ?? generation?.recap) !== false;
}
