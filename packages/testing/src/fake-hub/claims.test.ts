// The claim/custody automaton of the fake hub over its HTTP route (hub H-7b,
// architecture.md §6.7.7, §8.5), with the acceptance cases of H-7: two
// clients and two installs on one fan, lease expiry, a race, a failure after
// `dispatch`, a three-part greeting, no second greeting, «X8 off → Open and
// insert → manual Send → exact confirmation», an uncertain send that never
// frees itself, and `dispatch` refused when the owner's flag is off.

import { ClaimStateSchema, type ClaimBody, type ClaimState } from '@cg/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { WORLD, uuid } from '../scenarios/hub';
import { pilotPageFlags } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall } from './kit';

const PAGE = WORLD.pages.one.pageLabel;
const FAN = WORLD.newFan;
const GEN = uuid(0x200);
const OTHER_GEN = uuid(0x201);
const INSTANCE = WORLD.instanceId;
const OTHER_INSTANCE = WORLD.otherInstanceId;
const B_INSTANCE = uuid(0x902);
const LEASE = uuid(0x300);
const LEASE_2 = uuid(0x301);
const B_LEASE = uuid(0x302);

let hub: FakeHub;
let a: string;
let a2: string;
let b: string;
let attemptSeq = 0;
const attempt = (): string => uuid(0x4000 + ++attemptSeq);

interface Answer {
  readonly status: number;
  readonly state: ClaimState;
  readonly error: string | null;
  readonly reason: string | null;
  readonly retryAfter: string | null;
}

async function post(token: string, body: ClaimBody, fanRef: string = FAN): Promise<Answer> {
  const response = await hubCall(hub.fetch, hub.origin, 'clientFanClaim', { pageLabel: PAGE, fanRef, body }, { token });
  const json = (await response.json()) as ClaimState & { error?: string; reason?: string };
  if (response.status === 200) expect(ClaimStateSchema.safeParse(json).success).toBe(true);
  return { status: response.status, state: json, error: json.error ?? null, reason: json.reason ?? null, retryAfter: response.headers.get('retry-after') };
}

async function status(token: string, fanRef: string = FAN): Promise<ClaimState> {
  const response = await hubCall(hub.fetch, hub.origin, 'clientFanClaimStatus', { pageLabel: PAGE, fanRef }, { token });
  expect(response.status).toBe(200);
  return (await response.json()) as ClaimState;
}

const lease = (action: 'claim' | 'renew' | 'release', leaseToken = LEASE, instanceId = INSTANCE): ClaimBody => ({ action, leaseToken, instanceId });
const dispatch = (
  attemptId: string,
  partIndex: number,
  over: { purpose?: 'greeting' | 'preview-reply'; generationRef?: string; partCount?: number; leaseToken?: string | null; instanceId?: string } = {},
): ClaimBody => {
  const purpose = over.purpose ?? 'greeting';
  const leaseToken = over.leaseToken === undefined ? (purpose === 'greeting' ? LEASE : null) : over.leaseToken;
  return {
    action: 'dispatch',
    attemptId,
    instanceId: over.instanceId ?? INSTANCE,
    purpose,
    group: { generationRef: over.generationRef ?? GEN, variant: 0, partCount: over.partCount ?? 3 },
    partIndex,
    textRevision: 1,
    ...(leaseToken === null ? {} : { leaseToken }),
    flagRevision: WORLD.configRevision,
  };
};
const sent = (attemptId: string, platformMessageId: string, instanceId = INSTANCE): ClaimBody => ({ action: 'sent', attemptId, instanceId, platformMessageId, evidence: 'receipt+echo' });
const native = (attemptId: string, partIndex: number, platformMessageId: string, instanceId = INSTANCE): ClaimBody => ({
  action: 'registerNativeSend',
  attemptId,
  instanceId,
  purpose: 'greeting',
  group: { generationRef: GEN, variant: 0, partCount: 3 },
  partIndex,
  platformMessageId,
});
const advance = (ms: number): void => {
  hub.control({ op: 'clock', advanceMs: ms });
};
const refused = (answer: Answer): Pick<Answer, 'status' | 'error' | 'reason'> => ({ status: answer.status, error: answer.error, reason: answer.reason });

beforeEach(() => {
  hub = createFakeHub({ config: { flags: { previewSend: true } } });
  a = hub.issueToken();
  a2 = hub.issueToken();
  b = hub.issueToken({ username: WORLD.otherUser.username });
});

describe('fake hub claims: lease and greeting', () => {
  it('a three-part greeting: one-time tickets, the first proven part confirms the greeting, the rest stay the owner’s to send', async () => {
    expect((await status(a)).lease.state).toBe('none');
    const claimed = await post(a, lease('claim'));
    expect(claimed.state.lease).toMatchObject({ state: 'owned', leaseToken: LEASE, expiresAt: '2026-10-03T10:02:00.000Z' });

    const ids = [attempt(), attempt(), attempt()];
    for (const [part, id] of ids.entries()) {
      const out = await post(a, dispatch(id, part));
      expect(out.state.custody).toMatchObject({ attemptId: id, state: 'dispatching', ticketExpiresAt: '2026-10-03T10:00:10.000Z' });
      expect(out.state.custody?.ticket).toMatch(/^tkt-/);
      // The ticket is answered once: a repeat only reads, and the status never shows one (its deadline it does: hub `toWire`).
      expect((await post(a, dispatch(id, part))).state.custody).toMatchObject({ attemptId: id, state: 'dispatching', ticket: null, ticketExpiresAt: '2026-10-03T10:00:10.000Z' });
      expect((await status(a)).custody).toMatchObject({ attemptId: id, ticket: null });
      const done = await post(a, sent(id, String(4100 + part)));
      expect(done.state.custody?.state).toBe('sent');
      expect(done.state.greeting).toEqual({ state: 'confirmed', at: '2026-10-03T10:00:00.000Z', messageRef: '4100', source: 'preview-send' });
      expect(done.state.group).toEqual({ generationRef: GEN, variant: 0, partCount: 3, sentParts: ids.slice(0, part + 1).map((_, i) => i), heldParts: [] });
    }
    const released = await post(a, lease('release'));
    expect(released.state.lease).toEqual({ state: 'released', leaseToken: null, expiresAt: null, heldBy: null });
    expect(released.state.group?.sentParts).toEqual([0, 1, 2]);
  });

  it('no second greeting: another generation, a sent part again, another chatter', async () => {
    await post(a, lease('claim'));
    const first = attempt();
    await post(a, dispatch(first, 0));
    await post(a, sent(first, '4100'));
    expect(refused(await post(a, dispatch(attempt(), 0, { generationRef: OTHER_GEN })))).toEqual({ status: 409, error: 'generation_mismatch', reason: null });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'part_already_sent', reason: null });
    expect(refused(await post(b, lease('claim', B_LEASE, B_INSTANCE)))).toEqual({ status: 409, error: 'greeting_done', reason: null });
    expect(refused(await post(b, dispatch(attempt(), 1, { leaseToken: B_LEASE, instanceId: B_INSTANCE })))).toEqual({ status: 409, error: 'greeting_done', reason: null });
    // A confirmed greeting needs no lease from its owner for the rest of the group.
    await post(a, lease('release'));
    expect((await post(a, dispatch(attempt(), 1, { leaseToken: null }))).status).toBe(200);
  });

  it('two clients: the lease is busy for the other chatter, never named', async () => {
    await post(a, lease('claim'));
    expect(refused(await post(b, lease('claim', B_LEASE, B_INSTANCE)))).toEqual({ status: 409, error: 'claim_busy', reason: null });
    expect(refused(await post(b, lease('renew', B_LEASE, B_INSTANCE)))).toEqual({ status: 409, error: 'claim_busy', reason: null });
    expect(refused(await post(b, dispatch(attempt(), 0, { leaseToken: B_LEASE, instanceId: B_INSTANCE })))).toEqual({ status: 409, error: 'claim_busy', reason: null });
    expect((await status(b)).lease).toEqual({ state: 'held', leaseToken: null, expiresAt: '2026-10-03T10:02:00.000Z', heldBy: 'someone-else' });
    // A release by someone else releases nothing: the holder's claim with its token still answers `owned`.
    expect((await post(b, lease('release', B_LEASE, B_INSTANCE))).state.lease.state).toBe('held');
    expect((await post(a, lease('claim'))).state.lease.state).toBe('owned');
  });

  it('two installs of one chatter: the second sees «you elsewhere» and cannot take the lease', async () => {
    await post(a, lease('claim'));
    expect(refused(await post(a2, lease('claim', LEASE_2, OTHER_INSTANCE)))).toEqual({ status: 409, error: 'claim_busy', reason: null });
    expect(refused(await post(a2, lease('renew', LEASE_2, OTHER_INSTANCE)))).toEqual({ status: 409, error: 'claim_busy', reason: null });
    expect((await post(a2, lease('release', LEASE_2, OTHER_INSTANCE))).state.lease).toMatchObject({ state: 'held', heldBy: 'you-elsewhere', leaseToken: null });
    // The same install under a new token (re-sign-in) still owns it.
    expect((await post(a2, lease('renew'))).state.lease.state).toBe('owned');
  });

  it('the status GET and «Новые» name no install, as on the hub (H-7b): the caller\'s own live lease is `held` by `you-elsewhere` on every install, never `owned`, never its token; a claim with the token answers `owned`', async () => {
    await post(a, lease('claim'));
    const held = { state: 'held', leaseToken: null, expiresAt: '2026-10-03T10:02:00.000Z', heldBy: 'you-elsewhere' };
    expect((await status(a)).lease).toEqual(held);
    expect((await status(a2)).lease).toEqual(held);
    expect((await status(b)).lease).toEqual({ ...held, heldBy: 'someone-else' });
    const summary = async (token: string) => {
      const response = await hubCall(hub.fetch, hub.origin, 'clientAudienceNew', { pageLabel: PAGE, windowHours: 48 }, { token });
      return ((await response.json()) as { items: Array<{ fanRef: string; claim: unknown }> }).items.find((item) => item.fanRef === FAN)?.claim;
    };
    expect(await summary(a)).toEqual({ greeting: 'none', lease: 'held', heldBy: 'you-elsewhere', custody: null });
    expect(await summary(b)).toEqual({ greeting: 'none', lease: 'held', heldBy: 'someone-else', custody: null });
    // Only a POST that names the install and the lease token is the owner's: an idempotent claim, from either token of that install.
    expect((await post(a2, lease('claim'))).state.lease).toMatchObject({ state: 'owned', leaseToken: LEASE });
    expect((await post(a, lease('renew'))).state.lease).toMatchObject({ state: 'owned', leaseToken: LEASE });
    const dump = JSON.stringify([await status(a), await status(b), await summary(a), await summary(b)]);
    expect(dump).not.toContain(LEASE);
  });

  it('the status GET shows anyone\'s unresolved send, else only the caller\'s own last preview send; a desktop greeting that may have gone holds the fan', async () => {
    await post(a, lease('claim'));
    const mine = attempt();
    await post(a, dispatch(mine, 0));
    // Unresolved: everyone sees it.
    expect((await status(b)).custody).toMatchObject({ attemptId: mine, state: 'dispatching', ticket: null });
    await post(a, sent(mine, '4100'));
    // Finished: only its sender sees it.
    expect((await status(a)).custody).toMatchObject({ attemptId: mine, state: 'sent' });
    expect((await status(b)).custody).toBeNull();
    // No send of ours to this fan: a desktop command that may have greeted holds it, under the command's id.
    hub.control({ op: 'desktopHold', pageLabel: PAGE, fanRef: WORLD.fan, held: true });
    const desktop = (await status(b, WORLD.fan)).custody;
    expect({ ...desktop, attemptId: undefined }).toEqual({ attemptId: undefined, state: 'uncertain-held', ticket: null, ticketExpiresAt: null });
    expect(desktop?.attemptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('the lease expires lazily after claimLeaseSec unless renewed; then anyone may claim', async () => {
    await post(a, lease('claim'));
    advance(100_000);
    expect((await post(a, lease('renew'))).state.lease.expiresAt).toBe('2026-10-03T10:03:40.000Z');
    advance(121_000);
    expect((await status(a)).lease).toEqual({ state: 'expired', leaseToken: null, expiresAt: '2026-10-03T10:03:40.000Z', heldBy: null });
    expect(refused(await post(a, lease('renew')))).toEqual({ status: 409, error: 'claim_expired', reason: null });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'claim_expired', reason: null });
    expect((await post(b, lease('claim', B_LEASE, B_INSTANCE))).state.lease.state).toBe('owned');
  });

  it('a claim again by the owner extends the lease; a renew of another lease token of the same install is expired', async () => {
    await post(a, lease('claim'));
    advance(30_000);
    expect((await post(a, lease('claim'))).state.lease.expiresAt).toBe('2026-10-03T10:02:30.000Z');
    expect(refused(await post(a, lease('renew', LEASE_2)))).toEqual({ status: 409, error: 'claim_expired', reason: null });
  });

  it('«Новые» rows carry the caller’s claim summary', async () => {
    await post(a, lease('claim'));
    const read = async (token: string) => {
      const response = await hubCall(hub.fetch, hub.origin, 'clientAudienceNew', { pageLabel: PAGE, windowHours: 48 }, { token });
      return ((await response.json()) as { items: Array<{ fanRef: string; claim: unknown }> }).items.find((item) => item.fanRef === FAN)?.claim;
    };
    expect(await read(a)).toEqual({ greeting: 'none', lease: 'held', heldBy: 'you-elsewhere', custody: null });
    expect(await read(b)).toEqual({ greeting: 'none', lease: 'held', heldBy: 'someone-else', custody: null });
  });
});

describe('fake hub claims: custody', () => {
  it('a failure after dispatch: past the ticket the send is uncertain-held, blocks everything, outlives the lease and never frees itself', async () => {
    await post(a, lease('claim'));
    const id = attempt();
    await post(a, dispatch(id, 0));
    advance(10_000);
    const held = await status(a);
    expect(held.custody).toMatchObject({ attemptId: id, state: 'uncertain-held' });
    expect(held.group).toMatchObject({ sentParts: [], heldParts: [0] });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'custody_held', reason: null });
    expect(refused(await post(b, dispatch(attempt(), 0, { purpose: 'preview-reply', instanceId: B_INSTANCE })))).toEqual({ status: 409, error: 'custody_held', reason: null });
    // No `failed` without proof that it never left in time.
    expect(refused(await post(a, { action: 'failed', attemptId: id, instanceId: INSTANCE, reason: 'not_enqueued' }))).toEqual({ status: 409, error: 'custody_held', reason: null });
    advance(86_400_000);
    const later = await status(a);
    expect({ lease: later.lease.state, custody: later.custody?.state }).toEqual({ lease: 'expired', custody: 'uncertain-held' });
    // The late proof ends it.
    expect((await post(a, sent(id, '4100'))).state).toMatchObject({ custody: { state: 'sent' }, greeting: { state: 'confirmed' }, group: { sentParts: [0], heldParts: [] } });
  });

  it('an owner resolve in the hub cabinet ends an uncertain send either way', async () => {
    await post(a, lease('claim'));
    const id = attempt();
    await post(a, dispatch(id, 0));
    advance(60_000);
    hub.control({ op: 'resolveCustody', pageLabel: PAGE, fanRef: FAN, attemptId: id, outcome: 'not_sent' });
    expect((await status(a)).custody).toMatchObject({ attemptId: id, state: 'resolved-not-sent' });
    expect((await status(a)).greeting.state).toBe('none');
    await post(a, lease('claim'));
    const next = attempt();
    await post(a, dispatch(next, 0));
    hub.control({ op: 'resolveCustody', pageLabel: PAGE, fanRef: FAN, attemptId: next, outcome: 'sent', platformMessageId: '4100' });
    expect(await status(a)).toMatchObject({ custody: { state: 'resolved-sent' }, greeting: { state: 'confirmed', source: 'resolve', messageRef: '4100' }, group: { sentParts: [0] } });
    expect(() => hub.control({ op: 'resolveCustody', pageLabel: PAGE, fanRef: FAN, attemptId: next, outcome: 'sent' })).toThrow(/nothing to resolve/);
    expect(() => hub.control({ op: 'resolveCustody', pageLabel: PAGE, fanRef: FAN, attemptId: uuid(1), outcome: 'sent' })).toThrow(/no attempt/);
  });

  it('a race: two chatters dispatch a preview reply to one fan at once — one wins, the other is held', async () => {
    const [first, second] = await Promise.all([
      post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' })),
      post(b, dispatch(attempt(), 0, { purpose: 'preview-reply', instanceId: B_INSTANCE })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first.error, second.error]).toContain('custody_held');
  });

  it('a native refusal with proof is `failed` and frees the fan; the report repeats idempotently', async () => {
    const id = attempt();
    await post(a, dispatch(id, 0, { purpose: 'preview-reply' }));
    const failed: ClaimBody = { action: 'failed', attemptId: id, instanceId: INSTANCE, reason: 'native_rejected', httpStatus: 422 };
    expect((await post(a, failed)).state.custody?.state).toBe('failed');
    expect((await post(a, failed)).state.custody?.state).toBe('failed');
    expect(refused(await post(a, sent(id, '4100')))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
    const next = attempt();
    await post(a, dispatch(next, 0, { purpose: 'preview-reply' }));
    expect((await post(a, sent(next, '4100'))).state.custody?.state).toBe('sent');
    // A sent part is not `failed` afterwards; a preview reply confirms no greeting.
    expect(refused(await post(a, { action: 'failed', attemptId: next, instanceId: INSTANCE, reason: 'not_enqueued' }))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
    expect((await status(a)).greeting.state).toBe('none');
  });

  it('reports are checked: another body under the same id, a foreign attempt, a message id already used', async () => {
    const id = attempt();
    await post(a, dispatch(id, 0, { purpose: 'preview-reply' }));
    expect(refused(await post(a, dispatch(id, 1, { purpose: 'preview-reply' })))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
    expect(refused(await post(b, sent(id, '4100', B_INSTANCE)))).toEqual({ status: 409, error: 'custody_not_owned', reason: null });
    expect(refused(await post(a2, sent(id, '4100', OTHER_INSTANCE)))).toEqual({ status: 409, error: 'custody_not_owned', reason: null });
    expect(refused(await post(a, sent(uuid(7), '4100')))).toEqual({ status: 409, error: 'custody_not_owned', reason: null });
    await post(a, sent(id, '4100'));
    expect((await post(a, sent(id, '4100'))).status).toBe(200);
    expect(refused(await post(a, sent(id, '4199')))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
    const other = attempt();
    await post(a, dispatch(other, 0, { purpose: 'preview-reply', generationRef: OTHER_GEN }), WORLD.fan);
    expect(refused(await post(a, sent(other, '4100'), WORLD.fan))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
  });

  it('the owner’s flag is read atomically with dispatch: previewSend off refuses every dispatch; newcomers off refuses greetings and leases', async () => {
    await post(a, lease('claim'));
    hub.control({ op: 'config', patch: { flags: { previewSend: false } } });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    expect(refused(await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' })))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    // «Новые» is switched in the pages' own rows (the pilot names it there); X8 for everyone, through `"*"`.
    hub.control({ op: 'config', patch: { flags: { previewSend: true }, ...pilotPageFlags({ newcomers: false }) } });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    expect(refused(await post(a, lease('renew')))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    const reply = await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' }));
    expect({ status: reply.status, flagRevision: reply.state.flagRevision }).toEqual({ status: 200, flagRevision: WORLD.configRevision + 3 });
    expect((await post(a, lease('release'))).state.lease.state).toBe('released');
  });

  it('X8 off → «Open and insert» → the human pressed Send: registerNativeSend confirms exactly, idempotently, with no flag', async () => {
    hub.control({ op: 'config', patch: { flags: { previewSend: false } } });
    const id = attempt();
    const first = await post(a, native(id, 0, '4100'));
    expect(first.state).toMatchObject({ greeting: { state: 'confirmed', messageRef: '4100', source: 'native-register' }, custody: { attemptId: id, state: 'sent', ticket: null }, group: { sentParts: [0] } });
    expect((await post(a, native(id, 0, '4100'))).state.custody?.attemptId).toBe(id);
    // The same message under another attempt id is the same registration.
    expect((await post(a, native(attempt(), 0, '4100'))).state.custody?.attemptId).toBe(id);
    expect(refused(await post(a, native(id, 1, '4101')))).toEqual({ status: 409, error: 'attempt_conflict', reason: null });
    expect(refused(await post(a, native(attempt(), 0, '4102')))).toEqual({ status: 409, error: 'part_already_sent', reason: null });
    // It gives no right to send anything else.
    expect(refused(await post(a, dispatch(attempt(), 1)))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
  });

  it('a late native registration releases nobody’s custody', async () => {
    await post(b, lease('claim', B_LEASE, B_INSTANCE));
    const bAttempt = attempt();
    await post(b, dispatch(bAttempt, 0, { leaseToken: B_LEASE, instanceId: B_INSTANCE }));
    await post(a, native(attempt(), 1, '4300'));
    expect(hub.status().claims.find((claim) => claim.fanRef === FAN)?.attempts.map((item) => item.state)).toEqual(['dispatching', 'sent']);
  });

  it('the desktop’s unresolved new-follower command blocks a greeting dispatch, not a preview reply', async () => {
    await post(a, lease('claim'));
    hub.control({ op: 'desktopHold', pageLabel: PAGE, fanRef: FAN, held: true });
    expect(refused(await post(a, dispatch(attempt(), 0)))).toEqual({ status: 409, error: 'custody_held', reason: null });
    expect((await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' }))).status).toBe(200);
  });

  it('preview sends are rate-limited per chatter (previewSendPerMinute) with Retry-After', async () => {
    for (let fan = 0; fan < 6; fan += 1) {
      expect((await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' }), String(3000 + fan))).status).toBe(200);
      advance(1_000);
    }
    const limited = await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' }), '3010');
    expect({ ...refused(limited), retryAfter: limited.retryAfter }).toEqual({ status: 429, error: 'preview_send_rate_limited', reason: null, retryAfter: '54' });
    expect((await post(b, dispatch(attempt(), 0, { purpose: 'preview-reply', instanceId: B_INSTANCE }), '3011')).status).toBe(200);
    advance(55_000);
    expect((await post(a, dispatch(attempt(), 0, { purpose: 'preview-reply' }), '3012')).status).toBe(200);
  });

  it('a desktop-confirmed greeting closes the fan for everyone', async () => {
    hub.control({ op: 'desktopGreeting', pageLabel: PAGE, fanRef: FAN });
    expect((await status(a)).greeting).toMatchObject({ state: 'confirmed', source: 'desktop-outbox', messageRef: null });
    expect(refused(await post(a, lease('claim')))).toEqual({ status: 409, error: 'greeting_done', reason: null });
  });
});
