// ChatSpace's entry in the host registry (docs/project-unite/architecture.md
// §1.2): its addresses come from its runtime row (./runtime/chatspace.ts); the
// rest is build data — its scripts, permissions, budgets, contract check,
// archive markers and test config — read by build/manifest.ts, wxt.config.ts
// and tools/{gates,size-budget,archive-check,host-contract-check}. Nothing
// that ships imports this file.

import { LOOPBACK_MATCHES, RUNTIME_HOSTS } from './runtime/index.ts';
import type { HostDescriptor } from './types.ts';

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
  permissions: { origins: RUNTIME_HOSTS.chatspace.matches, optional: false },
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
      { entry: 'chatspace', label: 'isolated early bootstrap (chatspace)', gzipBytes: 30 * KIB },
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
  // The ChatSpace-like stand and the fake hub are on loopback (packages/testing).
  test: { pageMatches: LOOPBACK_MATCHES },
};
