// The feature manifest, ChatSpace (R20, docs/project-unite/architecture.md
// §1.4): what each feature needs on ChatSpace — the owner's switches of the
// page, the capabilities of ChatSpace's contract report, where it is shown and
// where its data come from — and the features only ChatSpace has: sending from
// a preview through ChatSpace's own queue (X8), our navigation between chats,
// the palette.
//
// A site module: imported by its subpath only (`@cg/contracts/features/chatspace`),
// by ChatSpace's own composition roots and by the roots that serve every site
// (the background's core, the extension pages). A Fansly bundle never carries it.
//
// The hub has already weighed the platform and what it serves into the page's
// own `features[flag]`: nothing here repeats that. `clientNeeds` is only what
// this client's own transport needs on top (routes.ts, CLIENT_FLAG_REQUIREMENTS).

import { CLIENT_FLAG_REQUIREMENTS } from '../hub/routes';
import type { ClientFeatureFlag } from '../hub/wire';
import type { SiteFeatures } from './common';
import type { Requirement } from './types';

/** Explicit admission: a new shared or site-only flag must be opted into ChatSpace. */
export const CHATSPACE_FEATURE_FLAGS = [
  'insertion', 'freshText', 'newcomers', 'spenders', 'stats', 'preview', 'previewSend',
  'previewSendMarkAiGenerated', 'fanPanel', 'navigation', 'wsTap', 'sound', 'coach',
  'recap', 'review', 'splitAll', 'voice',
] as const satisfies readonly ClientFeatureFlag[];
export type ChatSpaceFeatureFlag = (typeof CHATSPACE_FEATURE_FLAGS)[number];

type Req = Requirement<ChatSpaceFeatureFlag>;

const NOTHING: Req = { flags: [], hostCapabilities: [] };
/** Putting a result into ChatSpace's composer: the owner's `insertion` and the bridge that writes there. */
const INSERT: Req = { flags: ['insertion'], hostCapabilities: ['insert'] };
/** X8: the owner's `previewSend`, ChatSpace's send queue and a receipt profile of the build. */
const PREVIEW_SEND: Req = { flags: ['previewSend'], hostCapabilities: ['previewSend', 'receipt'] };

const FEATURES = {
  // Drafts for the fan. No switch of their own on OnlyFans: the hub's master switch and the build's version decide.
  // `splitAll`: the hub splits the whole answer into parts (Reply's Split, ops/request.ts).
  reply: { base: NOTHING, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'preview'], source: 'hub', switches: ['splitAll'] },
  fix: { base: NOTHING, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'preview'], source: 'hub' },
  hi: { base: NOTHING, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'preview', 'newcomers'], source: 'hub' },
  ping: { base: NOTHING, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'preview'], source: 'hub' },
  'fresh-text': { base: { flags: ['freshText'], hostCapabilities: [], clientNeeds: CLIENT_FLAG_REQUIREMENTS.freshText }, actions: {}, surfaces: ['dock'], source: 'page' },
  review: { base: { flags: ['review'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  recap: { base: { flags: ['recap'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['dock', 'result-expanded', 'fan-panel'], source: 'hub' },
  // 1.46.0: the page's `voice` (the hub weighs its lane: the switch, the provider, the allowlist and a voice profile);
  // the MP3 goes into ChatSpace's composer by a drop on it, its own upload (HostPort.attachFile).
  voice: { base: { flags: ['voice'], hostCapabilities: [] }, actions: { generate: NOTHING, insert: { flags: [], hostCapabilities: ['fileAttach'] } }, surfaces: ['dock'], source: 'hub' },
  // `preview`: the hub's archive feed of the chat, which Coach reads for its history.
  coach: { base: { flags: ['coach'], hostCapabilities: [] }, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['coach'], source: 'hub', switches: ['preview'] },
  // `stats`: the statistics and the «waiting» queue of the board; `preview`: the archive feed of a fan's preview.
  spenders: { base: { flags: ['spenders'], hostCapabilities: [] }, actions: {}, surfaces: ['spenders', 'preview'], source: 'hub', switches: ['stats', 'preview'] },
  // «Новые» come from the hub (`audience-new`); a greeting leaves from the card through X8.
  newcomers: { base: { flags: ['newcomers'], hostCapabilities: [] }, actions: { send: PREVIEW_SEND }, surfaces: ['newcomers', 'preview'], source: 'hub', switches: ['preview'] },
  'fan-panel': { base: { flags: ['fanPanel'], hostCapabilities: [] }, actions: {}, surfaces: ['fan-panel'], source: 'hub', switches: ['preview'] },
  // `wsTap`: ChatSpace's WebSocket tap, which hears the messages of the accounts that are not open.
  sound: { base: { flags: ['sound'], hostCapabilities: [] }, actions: {}, surfaces: [], switches: ['wsTap'] },
  // ChatSpace's socket tells a send by hand (its receipt and echo): the socket of a page may be listened to only where
  // the page's own `wsTap` is usable — the tab's tap is one for all its accounts, on while any page has it.
  'human-send': { base: { flags: ['wsTap'], hostCapabilities: ['sendObserve'] }, actions: {}, surfaces: [], source: 'page' },

  // ── only ChatSpace ──
  // 1.21.0 (decision X48): who sent each message, told to the hub. The send is seen as `human-send` sees it (the page's
  // own `wsTap`), and the hub must record it (`send-attribution-v1`). No switch of its own: the owner asked for it.
  'send-attribution': {
    kind: 'service',
    base: { flags: ['wsTap'], hostCapabilities: ['sendObserve'], clientNeeds: ['send-attribution-v1'] },
    actions: {},
    surfaces: [],
    source: 'page',
  },
  // `wsTap`: the passive freshness of the chat a part is sent to (CG-SEND-FRESHNESS without it); the AI mark of the send.
  'preview-send': {
    kind: 'host-action',
    base: PREVIEW_SEND,
    actions: { send: NOTHING },
    surfaces: ['preview', 'newcomers'],
    source: 'page',
    switches: ['wsTap', 'previewSendMarkAiGenerated'],
  },
  navigation: { kind: 'host-action', base: { flags: ['navigation'], hostCapabilities: ['navigate'] }, actions: {}, surfaces: ['quick-jump'], source: 'page' },
  // The window itself needs no switch; the chats it lists are opened by `navigation`.
  palette: { kind: 'panel', base: NOTHING, actions: {}, surfaces: ['palette'], source: 'page' },
} as const;

export const CHATSPACE_FEATURES: SiteFeatures<typeof FEATURES, ChatSpaceFeatureFlag> = FEATURES;

export type ChatSpaceFeatureKey = keyof typeof CHATSPACE_FEATURES;
