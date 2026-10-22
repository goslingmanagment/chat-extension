// The default loaders of the dock's lazy parts (lazy-part.tsx): dynamic imports
// the bundler splits into chunks of their own. A composition root may hand
// the dock other loaders — an explicit lazy entry of the extension with its
// own budget line (`@cg/ui/dock/analysis`, `@cg/ui/dock/debug`, `@cg/ui/dock/voice`).

import { type DockParts } from './lazy-part';

export const DEFAULT_PARTS: DockParts = {
  analysis: () => import('./analysis/index').then((module) => module.analysisPart),
  debug: () => import('./debug/index').then((module) => module.debugPart),
  voice: () => import('./voice/index').then((module) => module.voicePart),
};
