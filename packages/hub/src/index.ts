// @cg/hub — the hub facade over the vendored @kernel/sdk (architecture.md §8).
// Used ONLY by the background (§4): the token, the network and the SDK never
// reach a content script. R08 builds HubFacade, sign-in custody, bootstrap,
// the AI stream and the read models on top of this.

import { KERNEL_CONTRACT_HASH, KERNEL_SDK_VERSION } from '@kernel/sdk';

/** Contract hash of the vendored SDK — the release gate compares it with prod (§13, H-1). */
export const VENDORED_CONTRACT_HASH: string = KERNEL_CONTRACT_HASH;
export const VENDORED_SDK_VERSION: string = KERNEL_SDK_VERSION;

/** Production hub origin (D-13); a custom address needs an optional host permission (§3). */
export const DEFAULT_HUB_ORIGIN = 'https://gosling-agency.ru';
