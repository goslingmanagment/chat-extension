// ChatSpace's entry in the host registry (docs/project-unite/architecture.md
// §1.2): its addresses come from its runtime row (./runtime/chatspace.ts); the
// rest is build data — its scripts, lazy build, permissions, budgets, contract
// check, archive markers and test config — read by build/manifest.ts,
// wxt.config.ts, lazy/vite.config.ts and
// tools/{gates,size-budget,archive-check,host-contract-check}. Nothing that
// ships imports this file.

import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS } from '../../lazy/entries/names.ts';
import { CHATSPACE_LAZY_ROOT } from './runtime/chatspace.ts';
import { CHATSPACE_STAND_MATCHES, RUNTIME_HOSTS } from './runtime/index.ts';
import type { HostDescriptor } from './types.ts';

const CONTRACTS = './packages/contracts/src';

const KIB = 1024;

export const CHATSPACE: HostDescriptor = {
  kind: 'chatspace',
  platform: 'onlyfans',
  ...RUNTIME_HOSTS.chatspace,
  scripts: {
    // The bridge: boot and runtime in one document_start bundle (decision X11).
    main: { entry: 'chatspace-main', file: 'content-scripts/chatspace-main.js', world: 'MAIN', registration: 'manifest' },
    isolated: { entry: 'chatspace', file: 'content-scripts/chatspace.js', world: 'ISOLATED', registration: 'manifest' },
    // The WS tap (§6.8): the background registers it only while the bootstrap flag `wsTap` is on.
    extra: [{ entry: 'chatspace-ws', file: 'chatspace-ws.js', world: 'MAIN', registration: 'dynamic' }],
  },
  // Its own build of the lazy chunks (architecture.md §11; R20 F2b): today's entries and plan of layers, written to
  // lazy/chatspace/ and exposed to ChatSpace's pages only.
  lazy: { root: CHATSPACE_LAZY_ROOT, entries: LAZY_ENTRIES, layers: LAZY_LAYERS, beforeTheDock: BEFORE_THE_DOCK },
  permissions: { origins: RUNTIME_HOSTS.chatspace.matches, optional: false },
  // Its services in the background (R20 F1): the X8 custody with its journal and fuse, the greeting leases of «Новые».
  // The core loads the chunk with the first ChatSpace tab, or at its start while that work is unfinished
  // (composition/background.ts HOST_MODULE_SPECS names the same file). The ceiling: the measured file with room for
  // X8's own changes; past it, the chunk is looked at before the number moves.
  background: { source: 'bg/chatspace.ts', file: 'bg/chatspace.js', rawBytes: 96 * KIB },
  // The bridge, its runtime and the tap script (§4, D-06).
  mainWorldSources: ['packages/host-chatspace/src/main/'],
  // Size budgets of architecture.md §11 (starting targets, re-approved after the baseline), gzip -9.
  budgets: {
    scripts: [
      // Boot + runtime, one bundle: ≤ 10 KiB (decision X11; §11 started at 5 KiB for the boot alone). Its work at
      // document_start stays ≤ 1 ms (e2e).
      { entry: 'chatspace-main', label: 'MAIN bridge: boot + runtime (chatspace-main)', gzipBytes: 10 * KIB },
      // The tap script with the send port and the receipt observer (live.ts), registered only while `wsTap` is on.
      // 5 KiB was met with 0.03 KiB to spare; the X8 fuse's checks live with the receipt observer and add about
      // 0.9 KiB (decision X25). Nothing of them runs at document_start: the tap's own work there is the constructor
      // wrap.
      { entry: 'chatspace-ws', label: 'MAIN WS tap (chatspace-ws)', gzipBytes: 6 * KIB },
      { entry: 'chatspace', label: 'isolated early bootstrap (chatspace)', gzipBytes: 32 * KIB }, // X44: the dock focus and its key guard left no room; 30 → 32 KiB, as #152 and #159 raised theirs.
    ],
    // What ChatSpace's bundles pay for its slices of the contracts (docs/protocols/README.md, the light/heavy split):
    // the early isolated start loads only the light modules, and the two big registries stay in their lazy chunks.
    contracts: [
      {
        label: 'contracts: early isolated (bridge guard, envelopes, tab.register)',
        entry: [
          `export { checkBridgeFrame, BridgeEventEnvelopeSchema, BridgeResponseSchema } from '${CONTRACTS}/bridge.ts';`,
          `export { TabEnvelopeSchema, TabRegisterRequestSchema, TabRegisterResponseSchema } from '${CONTRACTS}/tab-protocol.ts';`,
        ].join('\n'),
        gzipBytes: 12 * KIB,
      },
      { label: 'contracts: UiAction schema', entry: `export { UiActionSchema } from '${CONTRACTS}/vm/actions.ts';`, gzipBytes: 16 * KIB },
      { label: 'contracts: tab request registry (parseTabPayload)', entry: `export { parseTabPayload } from '${CONTRACTS}/tab-messages.ts';`, gzipBytes: 30 * KIB }, // R20 P4b3: room for Fansly's operations in the shared registry.
    ],
  },
  // Local only, never in CI: the bundles are OnlyMonster's code and stay outside the repository
  // (docs/architecture.md §6.2 says where the copies live).
  contractCheck: { module: 'packages/host-chatspace/src/isolated/host-contract.ts', bundlesRootEnv: 'CG_CHATSPACE_BUNDLES' },
  archiveMarkers: {
    code: [
      // ChatSpace bundle chunk names from the research copy (0.172.0) and that copy's folder.
      /\b(?:messages-DlBZ5e81|composables-BUNn3xEu|notificationEntry-DgqI6Vgc|accounts-BWN_jVY3|ChatView-DOQWEL72|inbox-SRJHz93Z|onlyfans-CaxZc4_R|MainLayout-DBvnSRX2|index-DEVowLko)\b/,
      /chatspace-bundles/,
      // Vue scoped-style attributes: the fingerprint of a saved prod page or CSS.
      /\bdata-v-[0-9a-f]{8}\b/,
    ],
    // Library code only their app carries: we ship Preact, never Vue/PrimeVue/TipTap. The ChatSpace-like stand
    // (packages/testing/fixture-chatspace) is our own small Vue + TipTap app.
    libraries: [/__VUE_PROD_DEVTOOLS__|__VUE_OPTIONS_API__|__VUE_PROD_HYDRATION_MISMATCH_DETAILS__/, /@tiptap\/|prosemirror-(?:model|view|state)/i],
  },
  // The ChatSpace-like stand is on loopback, `127.0.0.1` (packages/testing): never the Fansly stand's `localhost`.
  test: { pageMatches: CHATSPACE_STAND_MATCHES },
};
