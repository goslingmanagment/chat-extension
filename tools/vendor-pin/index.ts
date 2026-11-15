// `pnpm vendor:pin`: writes tests/vendor-pins.json from the vendored manifests (vendor/kernel-sdk, vendor/chatgoose-hotkeys)
// after a re-vendor with the hub's scripts. `pnpm gates` fails while the pins and the manifests differ.

import { readFileSync, writeFileSync } from 'node:fs';

import { REPO_ROOT } from '../lib/paths.ts';
import { pinsOf } from './pins.ts';

const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(`${REPO_ROOT}${path}`, 'utf8')) as Record<string, unknown>;
const pins = pinsOf(json('vendor/kernel-sdk/kernel-sdk.vendor.json'), json('vendor/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json'));
writeFileSync(`${REPO_ROOT}tests/vendor-pins.json`, `${JSON.stringify(pins, null, 2)}\n`);
console.log(`vendor:pin: SDK ${String(pins.kernelSdk.contractHash).slice(0, 12)}… from hub ${String(pins.kernelSdk.sourceCommit).slice(0, 12)}, hotkeys ${String(pins.chatgooseHotkeys.sha256).slice(0, 12)}…`);
