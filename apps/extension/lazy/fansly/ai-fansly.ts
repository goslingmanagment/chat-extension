// Fansly's AI policy (docs/project-unite/architecture.md §1.6, §3.1, §9.1; R20 P8b1, P8b2, P8c): the proof of a start
// from MAIN's generation snapshot (`freshness`), the start's shared `proof`, the verdict on its result (spec §3.5),
// the person's deep window from Fansly's `settings.ext` and, with P8c, Hi's start proof. One chunk of Fansly's own
// build, loaded by Fansly's application half with the dock (composition/tab/hosts/fansly/app.ts); a ChatSpace tab
// never loads it — its policy rides in its `tab-app`.

import type { CgErrorWire } from '@cg/contracts/errors';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { AiHostPolicy } from '@cg/contracts/ops';
import { SettingsExtSchema, type SettingsExt } from '@cg/contracts/settings-ext';
import { createFanslyAi, type HiStartAnswer } from '@cg/core/application/hosts/fansly/ai';
import type { TabRpcClient } from '@cg/platform';

export { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';

/** How long a deep start waits for the person's depth before it goes with the v1 window. */
const WINDOWS_TIMEOUT_MS = 2000;
/** How long Hi waits for the background's read of the start: the click's grant lasts 10 s (GRANT_TTL_MS). */
const HI_START_TIMEOUT_MS = 6000;

/** The tab's client as it takes a request of Fansly's registry: the shared one is typed by its own types only. */
type AnyRequest = (type: string, payload: unknown, options?: { readonly timeoutMs?: number }) => Promise<{ readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly error: CgErrorWire }>;

/**
 * The person's Recap depth above 3000 (R20 §12, FS-AI-1): `windows` of Fansly's `settings.ext`, read by the background
 * (`fansly.settings.windows`) and checked here by its own schema — the port lets a `fansly.*` answer through as it came.
 * A refusal, a timeout or a wrong shape — null: the start takes the v1 window.
 */
export async function readFanslyWindows(rpc: Pick<TabRpcClient, 'request'>): Promise<SettingsExt['windows'] | null> {
  const answer = await (rpc.request as unknown as AnyRequest)('fansly.settings.windows', {}, { timeoutMs: WINDOWS_TIMEOUT_MS }).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const checked = SettingsExtSchema.shape.windows.safeParse(answer.payload);
  return checked.success ? checked.data : null;
}

/**
 * Hi's start read by the background (`fansly.hi.start`) when the tab saw none: its proof, or a dialog. A refusal, a
 * timeout or a wrong shape — null: Hi goes without a proof, and the hub refuses it in its own words.
 */
export async function readFanslyHiStart(rpc: Pick<TabRpcClient, 'request'>, chat: FanslySnapshot['identity']): Promise<HiStartAnswer | null> {
  const payload = { hostAccountId: chat.creatorId, fanRef: chat.fanId, groupId: chat.groupId };
  const answer = await (rpc.request as unknown as AnyRequest)('fansly.hi.start', payload, { timeoutMs: HI_START_TIMEOUT_MS }).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const read = answer.payload as { readonly ok: boolean; readonly proof?: HiStartAnswer['proof']; readonly dialog?: boolean };
  return read.ok === true ? { proof: read.proof ?? null, dialog: read.dialog === true } : null;
}

/** Fansly's policy of this tab: the page's clock, the deep window and Hi's start asked of the background. */
export function startFanslyAi(rpc: Pick<TabRpcClient, 'request'>): AiHostPolicy {
  return createFanslyAi({ now: () => Date.now(), windows: () => readFanslyWindows(rpc), hiStart: (chat) => readFanslyHiStart(rpc, chat) });
}
