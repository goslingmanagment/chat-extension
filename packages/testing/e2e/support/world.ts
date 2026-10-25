// The e2e's one world: the fake hub's page bound to the stand's account, and
// the stand's own fans at the top of the hub's Spenders board — so a chat a
// preview names exists on the stand and can be opened, inserted into and
// sent to. Synthetic names and ids only (src/stand/dataset.ts). In the
// showcase world (src/showcase.ts) the board is the showcase's fans, with
// their money and ages, and the hub's archive holds their chats as the stand
// shows them.

import { ADAPTER_VERSION, receiptModules } from '@cg/host-chatspace/isolated';
import { readdirSync } from 'node:fs';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { SpenderSeed } from '../../src/fake-hub/types';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { SHOWCASE, SHOWCASE_AT } from '../../src/showcase';
import { createShowcaseDataset, plainText } from '../../src/stand/dataset';
import { FIXTURE_BUILD_DIR } from '../../src/stand/paths';
import { SHOWCASE_ACCOUNTS, type ShowcaseLine } from '../../src/stand/showcase';
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

/**
 * A showcase fan's row of Spenders (src/showcase.ts): what the fan spent, the last 30 days (what the chat shows bought
 * lately, else a share of a fan who still writes), and when each side wrote last — the chat's own last lines.
 */
export function showcaseSpender(fan: { readonly fanRef: string; readonly username: string; readonly displayName: string; readonly spentUsd: number; readonly chat: readonly ShowcaseLine[]; readonly conversationRef?: string }): SpenderSeed {
  const last = (from: 'fan' | 'model'): number | null => {
    const line = fan.chat.findLast(([side]) => side === from);
    return line === undefined ? null : line[2] * MIN;
  };
  const fanAgo = last('fan');
  const lastPaid = fan.chat.findLast(([, , , ppv]) => ppv?.bought === true);
  return {
    fanRef: fan.fanRef,
    ...(fan.conversationRef === undefined ? {} : { conversationRef: fan.conversationRef }),
    username: fan.username,
    displayName: fan.displayName,
    lifetimeUsd: fan.spentUsd,
    windowUsd: lastPaid !== undefined && lastPaid[2] * MIN < 30 * DAY ? (lastPaid[3]?.usd ?? 0) + Math.round(fan.spentUsd * 0.04) : fanAgo !== null && fanAgo < 7 * DAY ? Math.round(fan.spentUsd * 0.06) : null,
    fanWroteAgoSec: fanAgo,
    weWroteAgoSec: last('model'),
    ...(fan.chat.at(-1)?.[0] === 'fan' ? { awaiting: true } : {}),
    ...(fan.chat.at(-1) === undefined ? {} : { preview: fan.chat.at(-1)?.[1] ?? '' }),
  };
}

/** The showcase's fans of account a on the board. */
const showcaseSpenders = (): readonly SpenderSeed[] =>
  (SHOWCASE_ACCOUNTS[0]?.fans ?? []).map((fan, index) => showcaseSpender({ fanRef: `74001${String(index + 1).padStart(3, '0')}`, username: fan.username, displayName: fan.name, spentUsd: fan.spentUsd, chat: fan.chat }));

/** The stand's fans of account a (`7400100N`), named as the stand names them. */
export const STAND_SPENDERS: readonly SpenderSeed[] = SHOWCASE ? showcaseSpenders() : NAMES.map((name, index) => {
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

/**
 * The showcase world: the hub's archive of each chat of account a is what the stand shows (the same ids, texts and
 * times — the stand's dataset made again from the run's one «now»), so a fan's preview, a Recap's coverage and the
 * window check read the chat a person sees.
 */
async function mirrorShowcaseChats(hub: FakeHubControlClient): Promise<void> {
  const dataset = createShowcaseDataset(SHOWCASE_AT);
  for (const chat of dataset.chats.values()) {
    if (chat.accountId !== STAND_IDS.accounts.a) continue;
    const messages = chat.messages.map((message) => ({
      id: message.id,
      sender: message.isFromFan ? ('fan' as const) : ('model' as const),
      text: plainText(message.content),
      at: message.sentAt,
      ...(message.price === undefined ? {} : { priceMills: message.price * 1000 }),
    }));
    await hub.command({ op: 'archiveConversation', pageLabel: PAGE, conversationRef: chat.fan.id, messages });
  }
}

/** Binds the hub's first page to the stand's account a and puts the stand's fans on its board. */
export async function standWorld(hub: FakeHubControlClient, options: WorldOptions = {}): Promise<void> {
  await hub.command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
  await hub.command({ op: 'spenderFans', fans: STAND_SPENDERS });
  if (SHOWCASE) {
    // The showcase's second account is Mia Rose's VIP page: bound as the first is, so every account is in work.
    await hub.command({ op: 'pageAccount', pageLabel: WORLD.pages.vip.pageLabel, platformAccountId: STAND_IDS.platformAccounts.b });
    await mirrorShowcaseChats(hub);
  }
  await hub.command({
    op: 'config',
    patch: {
      spendersTotal: options.spendersTotal ?? STAND_SPENDERS.length,
      ...(options.previewSend === true ? { flags: { previewSend: true, previewSendMarkAiGenerated: true }, limits: { previewSendReceiptProfiles: [standReceiptProfile()] } } : {}),
    },
  });
}
