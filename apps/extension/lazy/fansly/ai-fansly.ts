// Fansly's AI policy (docs/project-unite/architecture.md §1.6, §3.1, §9.1; R20 P8b1, P8b2, P8c): the proof of a start
// from MAIN's generation snapshot (`freshness`), the start's shared `proof`, the verdict on its result (spec §3.5),
// the person's deep window from Fansly's `settings.ext` and the open chat's PPV state. One chunk of Fansly's own
// build, loaded by Fansly's application half with the dock (composition/tab/hosts/fansly/app.ts); a ChatSpace tab
// never loads it — its policy rides in its `tab-app`.

import type { CgErrorWire } from '@cg/contracts/errors';
import { LivePpvStateSchema, type AiHostPolicy, type LivePpvState } from '@cg/contracts/ops';
import { SettingsExtSchema, type SettingsExt } from '@cg/contracts/settings-ext';
import { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';
import type { TabRpcClient } from '@cg/platform';

export { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';

/** How long a deep start waits for the person's depth before it goes with the v1 window. */
const WINDOWS_TIMEOUT_MS = 2000;
/**
 * How long a start waits for the open chat's PPV state: the background answers with what it knows after 1.3 s
 * (core services/hosts/fansly/ppv.ts `PPV_READ.answerMs`); this bounds a first page that has not come back by then.
 */
const PPV_TIMEOUT_MS = 2000;

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
 * The open chat's PPV state (X54 on Fansly): each paid attachment of its newest messages with the fan's purchase, read
 * by the background from Fansly (`fansly.ppv.read`) and checked here by the start's own schema. A refusal, a timeout,
 * a wrong shape or nothing known — null: the hub marks the attachments from its own stores.
 */
export async function readFanslyPpv(rpc: Pick<TabRpcClient, 'request'>, chat: { readonly creatorId: string; readonly fanId: string; readonly groupId: string }): Promise<LivePpvState | null> {
  const payload = { hostAccountId: chat.creatorId, fanRef: chat.fanId, groupId: chat.groupId };
  const answer = await (rpc.request as unknown as AnyRequest)('fansly.ppv.read', payload, { timeoutMs: PPV_TIMEOUT_MS }).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const read = answer.payload as { readonly ok?: unknown; readonly capturedAt?: unknown; readonly items?: unknown };
  if (read.ok !== true || !Array.isArray(read.items) || read.items.length === 0) return null;
  const checked = LivePpvStateSchema.safeParse({ capturedAt: read.capturedAt, items: read.items });
  return checked.success ? checked.data : null;
}

/** Fansly's policy of this tab: the page's clock, the deep window and the open chat's PPV state asked of the background. */
export function startFanslyAi(rpc: Pick<TabRpcClient, 'request'>): AiHostPolicy {
  return createFanslyAi({ now: () => Date.now(), windows: () => readFanslyWindows(rpc), ppv: (chat) => readFanslyPpv(rpc, chat) });
}
