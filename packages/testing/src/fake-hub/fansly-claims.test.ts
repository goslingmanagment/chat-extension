// R20 P6c3, HF-3 (#582) + HF-2 (#606), deployed hub bd3eec065.
// FS-NEW-3/6: the custody of a greeting the person wrote or an AI generated.
// Requests AND responses pass the vendored SDK. No live platform, AI or browser is needed for this boundary.
import { ClaimStateSchema, type ClaimState, type HubClaimBody } from '@cg/contracts';
import { createClient, routeSchemas } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { WORLD, uuid } from '../scenarios/hub';
import { fanslyPageFlags, PILOT_CAPABILITIES } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall } from './kit';

const PAGE = WORLD.pages.fansly.pageLabel;
const OF = WORLD.pages.one.pageLabel;
const FAN = WORLD.fansly.chats.a.fan;
const INSTANCE = WORLD.instanceId;
const LEASE = uuid(0xc301);
const GROUP = { kind: 'manual', textFingerprint: 'a'.repeat(64) } as const;
const AI_GROUP = { generationRef: uuid(0xc302), variant: 0, partCount: 1 };
const STORED = { generationRef: `manual:${GROUP.textFingerprint}`, variant: 0, partCount: 1 };
type Dispatch = Extract<HubClaimBody, { action: 'dispatch' }>;
type Native = Extract<HubClaimBody, { action: 'registerNativeSend' }>;
type Sdk = Record<'clientFanClaim' | 'clientFanClaimStatus' | 'clientBootstrap', (input?: Record<string, unknown>) => Promise<unknown>>;
let hub: FakeHub;
let a: Sdk;
let b: Sdk;
let token: string;
let seq = 0;
const next = (): string => uuid(0xc400 + ++seq);
const lease = (action: 'claim' | 'renew' | 'release' = 'claim', instanceId = INSTANCE, leaseToken = LEASE): HubClaimBody => ({ action, instanceId, leaseToken });
const dispatch = (over: Partial<Dispatch> = {}): Dispatch => ({ action: 'dispatch', attemptId: next(), instanceId: INSTANCE, purpose: 'greeting', group: GROUP, partIndex: 0, textRevision: 1, flagRevision: WORLD.configRevision, leaseToken: LEASE, ...over });
const native = (over: Partial<Native> = {}): Native => ({ action: 'registerNativeSend', attemptId: next(), instanceId: INSTANCE, purpose: 'greeting', group: GROUP, partIndex: 0, platformMessageId: '900000000000000017', ...over });
const sent = (attemptId: string, platformMessageId = '900000000000000018'): HubClaimBody => ({ action: 'sent', attemptId, instanceId: INSTANCE, platformMessageId, evidence: 'receipt+echo' });
const post = async (body: HubClaimBody, fanRef: string = FAN, as = a, pageLabel: string = PAGE): Promise<ClaimState> => {
  const state = await as.clientFanClaim({ params: { pageLabel, fanRef }, body });
  return ClaimStateSchema.parse(state);
};
const status = async (fanRef: string = FAN, as = a): Promise<ClaimState> => ClaimStateSchema.parse(await as.clientFanClaimStatus({ params: { pageLabel: PAGE, fanRef } }));
const off = (reason: string) => ({ status: 409, code: 'client_feature_disabled', body: { reason } });
const refused = async (body: HubClaimBody, code: string, fanRef: string = FAN, as = a): Promise<void> => {
  await expect(post(body, fanRef, as)).rejects.toMatchObject({ status: 409, code });
};
const advance = (ms: number): void => { hub.control({ op: 'clock', advanceMs: ms }); };

beforeEach(() => {
  hub = createFakeHub({ routeSchemas, config: fanslyPageFlags({ newcomers: true }) });
  token = hub.issueToken();
  const client = (bearer: string): Sdk => createClient({ baseUrl: hub.origin, fetch: hub.fetch, auth: { mode: 'bearer', token: () => bearer } }) as unknown as Sdk;
  a = client(token);
  b = client(hub.issueToken({ username: WORLD.otherUser.username }));
});

describe('[host:fansly] HF-3 custody through the deployed SDK', () => {
  it('manual greeting: claim → renew → one ticket → sent, with previewSend off, no AI request and the old response shape', async () => {
    const boot = await a.clientBootstrap() as { limits: Record<string, number>; pages: Array<{ pageLabel: string; features: Record<string, unknown> }> };
    expect(boot.limits).toMatchObject({ previewSendPerMinute: 6, greetingSendPerMinute: 30 });
    expect(boot.pages.find((p) => p.pageLabel === PAGE)?.features).toMatchObject({ newcomers: { available: true }, previewSend: { available: false, reason: 'platform_unsupported' } });
    expect((await status()).greeting.state).toBe('none');
    expect((await post(lease())).lease.state).toBe('owned');
    expect((await post(lease('renew'))).lease.state).toBe('owned');
    const body = dispatch();
    const ticket = await post(body);
    expect(ticket.group).toEqual({ ...STORED, sentParts: [], heldParts: [] });
    expect(ticket.custody?.state).toBe('dispatching');
    expect(ticket.custody?.ticket).toMatch(/^tkt-/);
    expect((await post(body)).custody?.ticket).toBeNull();
    const done = await post(sent(body.attemptId));
    expect(done.group).toEqual({ ...STORED, sentParts: [0], heldParts: [] });
    expect(done.greeting).toMatchObject({ state: 'confirmed', source: 'preview-send', messageRef: '900000000000000018' });
    await refused(dispatch(), 'part_already_sent');
    await refused(dispatch({ group: { ...GROUP, textFingerprint: 'b'.repeat(64) } }), 'generation_mismatch');
    await refused(lease(), 'greeting_done', FAN, b);
    expect((await post(lease('release'))).lease.state).toBe('released');
    expect(hub.journal.read().entries.some((entry) => entry.route === 'aiFeatureStream')).toBe(false);
  });

  it('an AI greeting uses the same custody and newcomers admission', async () => {
    await post(lease());
    const body = dispatch({ group: AI_GROUP });
    expect((await post(body)).group).toMatchObject(AI_GROUP);
    expect((await post(sent(body.attemptId))).greeting.state).toBe('confirmed');
  });

  it('the page’s own newcomers row alone admits claim, renew and dispatch; status and native records need no feature flag', async () => {
    hub.control({ op: 'config', patch: { flags: { newcomers: true, previewSend: true }, ...fanslyPageFlags({ newcomers: false }) } });
    for (const body of [lease(), lease('renew'), dispatch()]) await expect(post(body)).rejects.toMatchObject(off('flag_off'));
    expect((await status()).greeting.state).toBe('none');
    expect((await post(native())).greeting).toMatchObject({ state: 'confirmed', source: 'native-register' });
    hub.control({ op: 'reset' });
    hub.control({ op: 'preset', name: 'pilot-pages' });
    // Reset removes the page's own row; even '*' with everything on cannot open Fansly.
    token = hub.issueToken();
    hub.control({ op: 'config', patch: { flags: { newcomers: true, previewSend: true } } });
    const response = await hubCall(hub.fetch, hub.origin, 'clientFanClaim', { pageLabel: PAGE, fanRef: FAN, body: lease() }, { token });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'client_feature_disabled', reason: 'flag_off' });
  });

  it('manual-greeting-v1 is needed by newcomers, audience-new-v1 is not; status and native reports are still available', async () => {
    hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((c) => c !== 'audience-new-v1') } });
    await post(lease());
    hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((c) => c !== 'manual-greeting-v1') } });
    for (const body of [lease(), lease('renew'), dispatch()]) await expect(post(body)).rejects.toMatchObject(off('hub_not_ready'));
    expect((await status()).lease.state).toBe('held');
    expect((await post(native())).greeting.state).toBe('confirmed');
  });

  it('preview-reply is 409 for dispatch and native registration, even with every switch on or the master off (deployed order, not HF-15)', async () => {
    for (const master of [true, false]) {
      hub.control({ op: 'config', patch: { master, flags: { previewSend: true }, ...fanslyPageFlags({ previewSend: true }) } });
      for (const body of [dispatch({ purpose: 'preview-reply', group: AI_GROUP }), native({ purpose: 'preview-reply', group: AI_GROUP })]) {
        await expect(post(body)).rejects.toMatchObject(off('platform_unsupported'));
      }
    }
    expect(hub.status().claims.every((row) => row.attempts.length === 0)).toBe(true);
  });

  it('OnlyFans refuses manual groups for dispatch and native registration', async () => {
    hub.control({ op: 'config', patch: { flags: { previewSend: true } } });
    for (const body of [dispatch(), native()]) await expect(post(body, WORLD.newFan, a, OF)).rejects.toMatchObject(off('platform_unsupported'));
    expect(hub.status().claims.every((row) => row.attempts.length === 0)).toBe(true);
  });

  it('a repeat belongs to its page and exact fan: an OnlyFans attempt cannot bypass Fansly admission', async () => {
    hub.control({ op: 'config', patch: { flags: { previewSend: true } } });
    const reply = dispatch({ group: AI_GROUP, purpose: 'preview-reply' });
    await post(reply, FAN, a, OF);
    await refused(reply, 'attempt_conflict');
    const body = native();
    await post(body);
    await refused(body, 'attempt_conflict', WORLD.fansly.twinFan);
    expect((await status(WORLD.fansly.twinFan)).greeting.state).toBe('none');
  });

  it('a repeat reads its ticketless state after shutdown; sent, failed, release and native registration finish with the master and flags off', async () => {
    await post(lease());
    const body = dispatch();
    await post(body);
    hub.control({ op: 'config', patch: { master: false, minVersion: '99.0.0', ...fanslyPageFlags({ newcomers: false }) } });
    expect((await post(body)).custody).toMatchObject({ state: 'dispatching', ticket: null });
    await expect(status()).rejects.toMatchObject(off('disabled'));
    await expect(post(lease('renew'))).rejects.toMatchObject(off('disabled'));
    await expect(post(dispatch())).rejects.toMatchObject(off('disabled'));
    expect((await post({ action: 'failed', attemptId: body.attemptId, instanceId: INSTANCE, reason: 'not_enqueued' })).custody?.state).toBe('failed');
    expect((await post(lease('release'))).lease.state).toBe('released');
    expect((await post(native())).greeting.state).toBe('confirmed');
  });

  it('two clients race for one fan: one lease and one dispatch, while a second install reads held without a lease token', async () => {
    const leases = await Promise.allSettled([post(lease()), post(lease('claim', WORLD.otherInstanceId, next()), FAN, b)]);
    expect(leases.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await status()).lease).toMatchObject({ state: 'held', heldBy: 'you-elsewhere', leaseToken: null });
    expect((await status(FAN, b)).lease).toMatchObject({ state: 'held', heldBy: 'someone-else', leaseToken: null });
    await refused(lease('claim', WORLD.otherInstanceId, next()), 'claim_busy');
    const tickets = await Promise.allSettled([post(dispatch()), post(dispatch()), post(dispatch({ instanceId: WORLD.otherInstanceId }), FAN, b)]);
    expect(tickets.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(hub.status().claims.find((row) => row.fanRef === FAN)?.attempts).toHaveLength(1);
  });

  it('uncertain custody survives a new client and lease expiry: no failure or second ticket, until late proof while switches are off', async () => {
    await post(lease());
    const body = dispatch();
    await post(body);
    advance(121_000);
    expect((await status(FAN, b)).custody).toMatchObject({ state: 'uncertain-held', ticket: null });
    await refused({ action: 'failed', attemptId: body.attemptId, instanceId: INSTANCE, reason: 'not_enqueued' }, 'custody_held');
    await post(lease('claim', WORLD.otherInstanceId, next()), FAN, b);
    await refused(dispatch({ instanceId: WORLD.otherInstanceId }), 'custody_held', FAN, b);
    hub.control({ op: 'config', patch: { master: false } });
    expect((await post(sent(body.attemptId))).greeting.state).toBe('confirmed');
  });

  it('owner resolve ends uncertain custody; native confirmation never frees someone else’s open attempt', async () => {
    await post(lease());
    const body = dispatch();
    await post(body);
    await post(native({ group: AI_GROUP }), FAN, b);
    expect((await status()).custody?.state).toBe('dispatching');
    advance(11_000);
    hub.control({ op: 'resolveCustody', pageLabel: PAGE, fanRef: FAN, attemptId: body.attemptId, outcome: 'not_sent' });
    expect((await status()).custody?.state).toBe('resolved-not-sent');
    expect((await status()).greeting).toMatchObject({ state: 'confirmed', source: 'native-register' });
  });

  it('native registration is idempotent by attempt and page/message, and needs neither lease nor AI generation', async () => {
    const body = native();
    const first = await post(body);
    expect(first.custody).toEqual({ attemptId: body.attemptId, state: 'sent', ticket: null, ticketExpiresAt: null });
    expect((await post(body)).custody).toEqual(first.custody);
    expect((await post({ ...body, attemptId: next() })).custody).toEqual(first.custody);
    await refused({ ...body, platformMessageId: '900000000000000019' }, 'attempt_conflict');
    expect((await status()).group).toMatchObject(STORED);
  });

  it('18/19-digit neighbours that round to the same number remain different fans and message ids', async () => {
    for (const [one, two] of [[FAN, WORLD.fansly.twinFan], ['9000000000000000017', '9000000000000000018']] as const) {
      expect(Number(one)).toBe(Number(two));
      await post(lease('claim', INSTANCE, next()), one);
      await post(lease('claim', INSTANCE, next()), two);
      await post(native({ platformMessageId: one }), one);
      expect((await status(two)).greeting.state).toBe('none');
      await post(native({ platformMessageId: two }), two);
      expect((await status(one)).greeting.messageRef).toBe(one);
      expect((await status(two)).greeting.messageRef).toBe(two);
    }
  });

  it('the 31st greeting is 429 with the correct Retry-After; native reports, repeats and other users do not consume its window', async () => {
    for (let i = 0; i < 30; i++) {
      const fan = String(800000000000000000n + BigInt(i));
      const leaseToken = next();
      await post(lease('claim', INSTANCE, leaseToken), fan);
      const body = dispatch({ leaseToken });
      await post(body, fan);
      await post(body, fan); // no second rate slot
      await post({ action: 'failed', attemptId: body.attemptId, instanceId: INSTANCE, reason: 'not_enqueued' }, fan);
      advance(1000);
    }
    await post(lease());
    const body = dispatch();
    await expect(post(body)).rejects.toMatchObject({ status: 429, code: 'preview_send_rate_limited' });
    const response = await hubCall(hub.fetch, hub.origin, 'clientFanClaim', { pageLabel: PAGE, fanRef: FAN, body }, { token });
    expect(response.headers.get('retry-after')).toBe('30');
    const bLease = next();
    await post(lease('claim', INSTANCE, bLease), WORLD.fansly.chats.b.fan, b);
    expect((await post(dispatch({ leaseToken: bLease }), WORLD.fansly.chats.b.fan, b)).custody?.ticket).toBeTruthy();
    advance(30_000);
    expect((await post(body)).custody?.ticket).toBeTruthy();
  });

  it('rate windows are separate by platform; OnlyFans’ greetings and replies still share six per person across pages', async () => {
    hub.control({ op: 'config', patch: { flags: { previewSend: true } } });
    for (let i = 0; i < 6; i++) {
      const fan = String(3000 + i);
      const page = i % 2 === 0 ? OF : WORLD.pages.vip.pageLabel;
      const leaseToken = next();
      if (i < 3) await post(lease('claim', INSTANCE, leaseToken), fan, a, page);
      await post(dispatch({ group: AI_GROUP, purpose: i < 3 ? 'greeting' : 'preview-reply', leaseToken }), fan, a, page);
    }
    await expect(post(dispatch({ group: AI_GROUP, purpose: 'preview-reply' }), '3099', a, OF)).rejects.toMatchObject({ status: 429, code: 'preview_send_rate_limited' });
    for (let i = 0; i < 30; i++) {
      const fan = String(810000000000000000n + BigInt(i));
      // Native sends spend no slots.
      await post(native({ platformMessageId: fan }), `${fan}1`);
      const leaseToken = next();
      await post(lease('claim', INSTANCE, leaseToken), fan);
      expect((await post(dispatch({ leaseToken }), fan)).custody?.ticket).toBeTruthy();
    }
  });

  it.each([
    ['upper-case fingerprint', { group: { ...GROUP, textFingerprint: 'A'.repeat(64) } }],
    ['short fingerprint', { group: { ...GROUP, textFingerprint: 'abc' } }],
    ['raw text', { group: { ...GROUP, text: 'private greeting' } }],
    ['mixed group', { group: { ...GROUP, ...AI_GROUP } }],
    ['second part', { partIndex: 1 }],
    ['manual reply', { purpose: 'preview-reply' }],
    ['forged AI ref', { group: { ...AI_GROUP, generationRef: STORED.generationRef } }],
  ])('the SDK and fake refuse %s before custody, including without the injected schema', async (_name, over) => {
    const body = { ...dispatch(), ...over };
    expect(routeSchemas.clientFanClaim.body.safeParse(body).success).toBe(false);
    for (const on of [hub, createFakeHub()]) {
      const response = await hubCall(on.fetch, on.origin, 'clientFanClaim', { pageLabel: PAGE, fanRef: FAN, body }, { token: on.issueToken() });
      expect(response.status).toBe(400);
      expect(on.status().claims).toEqual([]);
    }
  });

  it.each([200, 401, 500])('HTTP %i proves no non-delivery: refused by SDK schema, custody stays held', async (httpStatus) => {
    await post(lease());
    const body = dispatch();
    await post(body);
    const failed = { action: 'failed', attemptId: body.attemptId, instanceId: INSTANCE, reason: 'native_rejected', httpStatus } as const;
    expect(routeSchemas.clientFanClaim.body.safeParse(failed).success).toBe(false);
    const response = await hubCall(hub.fetch, hub.origin, 'clientFanClaim', { pageLabel: PAGE, fanRef: FAN, body: failed }, { token });
    expect(response.status).toBe(400);
    advance(11_000);
    expect((await status()).custody?.state).toBe('uncertain-held');
  });
});
