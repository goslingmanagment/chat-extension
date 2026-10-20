// The Fansly bridge (R20, 1.15.0; docs/project-unite/architecture.md §5.5–§6): MAIN on Fansly writes nothing, its
// events carry no message text and its health counts sends only; ids are snowflake strings and never numbers, so two
// neighbouring fans or messages are never merged.

import { describe, expect, it } from 'vitest';

import * as F from '../src/bridge-fansly';
import * as M from '../src/bridge-messages-fansly';
import * as H from '../src/fansly';
import { FANSLY_MSG, fanslyChatWire, fanslyHealth, fanslyIdentityWire, fanslyReplySnapshot } from './fixtures/index';

describe('Fansly bridge registry (§6)', () => {
  it('MAIN on Fansly writes nothing: no request is a write, all have the ordinary timeout', () => {
    expect(F.FANSLY_BRIDGE_WRITE_REQUESTS).toEqual([]);
    for (const t of F.TO_MAIN_FANSLY_TYPES) expect(M.TO_MAIN_FANSLY[t], t).toMatchObject({ write: false, timeout: 'call' });
  });

  it('fx.health (R20 P7f) counts the person’s sends — counts only, no id or text — and the order of each attributed send’s echo and receipt', () => {
    const { sends } = fanslyHealth;
    expect(sends.echoFirst + sends.receiptFirst).toBe(sends.sent);
    expect(Object.values(sends).every((value) => typeof value === 'number')).toBe(true);
    const counted = { ...sends, echoFirst: sends.echoFirst + 1 };
    expect(M.FanslyHealthSchema.safeParse({ ...fanslyHealth, sends: counted }).success).toBe(false);
    expect(M.FanslyHealthSchema.safeParse({ ...fanslyHealth, sends: { ...counted, sent: sends.sent + 1 } }).success).toBe(true);
  });

  it('MAIN events carry no message text; only the snapshot does, for a draft function', () => {
    const shapes: Array<[string, unknown]> = [...Object.entries(M.FROM_MAIN_FANSLY), ...Object.entries(M.FANSLY_WIRE_EVENTS)];
    for (const [t, schema] of shapes) {
      const shape = (schema as { def?: { shape?: Record<string, unknown> } }).def?.shape ?? {};
      for (const key of ['text', 'plainText', 'html', 'body', 'content', 'tail']) expect(Object.keys(shape), `${t}.${key}`).not.toContain(key);
    }
    expect(Object.keys(H.FanslySnapshotSchema.def.shape)).toContain('tail');
  });
});

describe('Fansly ids: snowflake strings, never numbers', () => {
  it('above 2^53 a number would merge neighbours, so every id field takes a string only', () => {
    expect(Number(FANSLY_MSG.m1)).toBe(Number(FANSLY_MSG.m2));
    const numeric = Number(FANSLY_MSG.m1);
    expect(M.FROM_MAIN_FANSLY['fx.sent'].safeParse({ groupId: '700000000000000003', msgId: numeric, contentDigest: 'deadbeef', gestureAt: 1 }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.deleted'].safeParse({ groupId: '700000000000000003', ids: [numeric] }).success).toBe(false);
    expect(M.TO_MAIN_FANSLY['fx.windowMeta'].payload.safeParse({ groupId: numeric }).success).toBe(false);
    expect(H.FanslySnapshotSchema.safeParse({ ...fanslyReplySnapshot, knownFanMessageIds: [numeric] }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.chat'].safeParse({ ...fanslyChatWire, fanId: Number(fanslyChatWire.fanId) }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.identity'].safeParse({ ...fanslyIdentityWire, creatorId: Number(fanslyIdentityWire.creatorId) }).success).toBe(false);
  });
});
