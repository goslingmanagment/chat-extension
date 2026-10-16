// The «Новые» window of a Fansly tab (R20 P10a; docs/project-unite/architecture.md §3.1, §8.17; ui-design §3.12): the
// surface the overlay of the window layer mounts for `newcomers` (composition/tab/surfaces.ts), with Fansly's own
// words laid over the tab's I18n — they come with this chunk, never in the catalog every Fansly page loads. A ChatSpace
// tab never loads it: its `newcomers` is the hub's list (lazy/entries/newcomers.ts).

import { withFanslyNewcomersTexts } from '@cg/core/domain/hosts/fansly/i18n/newcomers';
import { fanslyNewcomersSurface } from '@cg/ui/hosts/fansly/newcomers';

export const surface = fanslyNewcomersSurface(withFanslyNewcomersTexts);
