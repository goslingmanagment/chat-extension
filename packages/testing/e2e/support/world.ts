// The e2e's one world: the fake hub's page bound to the stand's account, and
// the stand's own fans at the top of the hub's Spenders board — so a chat a
// preview names exists on the stand and can be opened, inserted into and
// sent to. Synthetic names and ids only (src/stand/dataset.ts).

import { ADAPTER_VERSION, receiptModules } from '@cg/host-chatspace/isolated';
import { readdirSync } from 'node:fs';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { SpenderSeed } from '../../src/fake-hub/types';
import { PAGE } from '../../src/scenarios/hub';
import { FIXTURE_BUILD_DIR } from '../../src/stand/paths';
import { STAND_IDS, standOrigin } from './stand';

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;
const NAMES = ['Alder', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Grove', 'Heath', 'Iris', 'Juniper', 'Kestrel', 'Linden'] as const;
/** Lifetime and period dollars, and when each side wrote last, for the twelve fans of the stand's account a. */
const MONEY: ReadonlyArray<readonly [lifetime: number, period: number | null, fanAgo: number | null, weAgo: number | null, awaiting?: boolean]> = [
  [12_480, 320, 7 * MIN, 10 * HOUR, true],
  [8_930, null, 19 * DAY, 2 * DAY],
  [6_215, 940, 22 * MIN, 50 * MIN, true],
  [3_480, 125, 9 * HOUR, 4 * HOUR],
  [1_945, 410, 2 * HOUR, 35 * MIN],
  [585, 45, 3 * HOUR, 2 * DAY],
  [540, null, 24 * DAY, 11 * DAY],
  [495, 120, 7 * HOUR, 5 * HOUR],
  [340, 80, 50 * MIN, 6 * HOUR, true],
  [130, null, null, 14 * DAY],
  [42, 12, 3 * DAY, 3 * DAY],
  [18, null, 40 * DAY, 41 * DAY],
];

/** The stand's fans of account a (`7400100N`), named as the stand names them. */
export const STAND_SPENDERS: readonly SpenderSeed[] = NAMES.map((name, index) => {
  const [lifetimeUsd, windowUsd, fanWroteAgoSec, weWroteAgoSec, awaiting] = MONEY[index] ?? [0, null, null, null];
  return {
    fanRef: `74001${String(index + 1).padStart(3, '0')}`,
    username: `stand_fan_1_${index + 1}`,
    displayName: `Fan ${name}`,
    lifetimeUsd,
    windowUsd,
    fanWroteAgoSec,
    weWroteAgoSec,
    ...(awaiting === true ? { awaiting } : {}),
  };
});

/** The receipt profile of this stand build as the hub's owner would approve it (§6.2, `limits.previewSendReceiptProfiles`). */
export const standReceiptProfile = (): { readonly id: string; readonly adapterVersion: string; readonly modules: Record<string, string> } => ({
  id: 'stand-build',
  adapterVersion: ADAPTER_VERSION,
  modules: receiptModules(
    readdirSync(`${FIXTURE_BUILD_DIR}assets`).map((name) => `/assets/${name}`),
    standOrigin(),
  ),
});

export interface WorldOptions {
  /** The board is the stand's twelve fans and nobody else (default), or they stand above the hub's synthetic rows. */
  readonly spendersTotal?: number;
  /** X8: the owner's `previewSend` flag and the stand's receipt profile (off by default, as on a pilot hub). */
  readonly previewSend?: boolean;
}

/** Binds the hub's first page to the stand's account a and puts the stand's fans on its board. */
export async function standWorld(hub: FakeHubControlClient, options: WorldOptions = {}): Promise<void> {
  await hub.command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
  await hub.command({ op: 'spenderFans', fans: STAND_SPENDERS });
  await hub.command({
    op: 'config',
    patch: {
      spendersTotal: options.spendersTotal ?? STAND_SPENDERS.length,
      ...(options.previewSend === true ? { flags: { previewSend: true, previewSendMarkAiGenerated: true }, limits: { previewSendReceiptProfiles: [standReceiptProfile()] } } : {}),
    },
  });
}
