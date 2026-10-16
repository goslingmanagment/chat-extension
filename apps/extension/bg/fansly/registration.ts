import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import { FanslyApiError, type FanslyClient } from '@cg/fansly-api';
import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';

/** The API's group envelope is already unwrapped. Never take createdBy,
 * recipients, or the group id for the partner's ACCOUNT id. */
export function registrationFanId(value: unknown, groupId: string, accountId: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const group = value as Record<string, unknown>;
  if (group['id'] !== groupId || group['type'] !== 1 || !Array.isArray(group['users']) || group['users'].length !== 2) return null;
  const ids = group['users'].map((user: unknown) => typeof user === 'object' && user !== null ? (user as Record<string, unknown>)['userId'] : null);
  if (!ids.includes(accountId) || ids[0] === ids[1]) return null;
  const fan = ids.find((id) => id !== accountId);
  return typeof fan === 'string' && /^[1-9]\d{0,23}$/.test(fan) ? fan : null;
}

export async function readRegistration(kit: BackgroundKit, client: FanslyClient | null, request: FanslyTabRequestPayload<'fansly.registration.read'>, sender: HostSiteSender): Promise<FanslyTabResponsePayload<'fansly.registration.read'>> {
  const fail = (error: CgAnyErrorWire): FanslyTabResponsePayload<'fansly.registration.read'> => ({ ok: false, error });
  if (sender.kind !== 'tab') return fail({ code: 'CG-CONTEXT-CHANGED' });
  const owner = kit.hub.session();
  const grant = await kit.hub.page(request.pageId, sender);
  if (!grant.ok) return fail({ code: grant.code });
  const allowed = (): boolean => {
    const session = kit.hub.session();
    const page = kit.hub.bootstrap()?.pages.find((p) => p.pageId === request.pageId);
    return owner !== null && session?.hubOrigin === owner.hubOrigin && session.userId === owner.userId &&
      page?.platform === 'fansly' && page.platformAccountId === request.hostAccountId && pageFlagState(page, 'registration').usable && kit.router.tabs().includes(sender.tabSessionId);
  };
  if (!allowed()) return fail({ code: 'CG-FEATURE-DISABLED' });
  if (client === null) return fail({ code: 'CG-FAN-SESSION' });
  try {
    const prepared = await client.prepare({ account: request.hostAccountId, purpose: 'registration', route: 'group.detail', path: { group: request.groupId } });
    if (!allowed()) { prepared.cancel(); return fail({ code: 'CG-CONTEXT-CHANGED' }); }
    const answer = await prepared.start();
    if (!allowed()) return fail({ code: 'CG-CONTEXT-CHANGED' });
    const fanId = registrationFanId(answer.response, request.groupId, request.hostAccountId);
    return fanId === null ? fail({ code: 'CG-FAN-GROUP' }) : { ok: true, fanId };
  } catch (error) {
    return fail(error instanceof FanslyApiError ? error.toWire() : { code: 'CG-FAN-REQUEST' });
  }
}
