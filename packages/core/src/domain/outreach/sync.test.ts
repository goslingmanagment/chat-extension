// «Рассылки» on the hub, the pure part: what a save sends (only what changed since the hub's copy), what of the hub's
// copy the window takes (what the window did not change since; a send never undone), and what the hub is told of a send.

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONDITIONS } from './audience';
import { textKey, type SavedFan, type SavedOutreach, type SavedSend } from './saved';
import { furtherSend } from './saved';
import { adoptPlan, fromHub, mergeSaves, patchOf, reportOf, settingsOf, splitSave, withLocalSends } from './sync';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');

const send = (patch: Partial<SavedSend> = {}): SavedSend => ({ state: 'sent', code: null, clickedAt: NOW - 60_000, at: NOW - 59_000, text: 'hey you', media: null, attemptId: '0b9b1b54-6f7e-4a52-9a0c-3b2f7d1e5a10', claimed: true, reported: true, by: null, messageId: null, ...patch });
const fan = (fanRef: string, patch: Partial<SavedFan> = {}): SavedFan => ({ fanRef, name: null, version: `hey ${fanRef}`, basis: textKey('the set'), versionAt: NOW - 120_000, edit: null, editedBy: null, send: null, outcome: null, ...patch });
const outreach = (patch: Partial<SavedOutreach> = {}): SavedOutreach => ({
  id: '0b9b1b54-6f7e-4a52-9a0c-3b2f7d1e5a10',
  owner: 'hub|7|13',
  createdAt: NOW - 600_000,
  updatedAt: NOW - 60_000,
  text: 'the set',
  textRevision: 1,
  textChangedAt: null,
  source: { kind: 'tiers', on: ['shelf-600-plus'] },
  conditions: DEFAULT_CONDITIONS,
  amountTyped: '1,000',
  locked: ['11', '12'],
  unticked: [],
  items: [],
  picked: [],
  media: null,
  fans: [fan('11'), fan('12')],
  folded: false,
  author: null,
  synced: true,
  pending: null,
  ...patch,
});

describe('«Рассылки» on the hub: the save and the take', () => {
  it('names a text the same on every computer', () => {
    expect(textKey('the set')).toBe(textKey('the set'));
    expect(textKey('the set')).not.toBe(textKey('the set!'));
  });

  it('a save of an outreach the hub has not seen carries all of it; then only what changed', () => {
    const local = outreach();
    expect(patchOf(null, local)).toMatchObject({ text: 'the set', withMedia: false, order: ['11', '12'], fans: [{ fanRef: '11', version: 'hey 11' }, { fanRef: '12', version: 'hey 12' }] });
    expect(patchOf(local, local)).toBeNull();
    expect(patchOf(local, outreach({ text: 'the set!' }))).toEqual({ text: 'the set!' });
    expect(patchOf(local, outreach({ fans: [fan('11', { edit: 'my words' }), fan('12')] }))).toEqual({ fans: [{ fanRef: '11', edit: 'my words' }] });
    // «Очистить»: a fan let go here is let go at the hub too; one whose send was claimed is never touched.
    const sent = outreach({ fans: [fan('11', { send: send() }), fan('12')] });
    expect(patchOf(sent, outreach({ locked: ['11'], fans: [fan('11', { send: send() })] }))).toEqual({ order: ['11'], fans: [{ fanRef: '12', version: null, edit: null }] });
  });

  it('a save of many fans goes in parts the hub takes', () => {
    const fans = Array.from({ length: 120 }, (_, at) => ({ fanRef: String(100 + at), version: 'v', basis: 'b' }));
    const parts = splitSave({ text: 't', fans });
    expect(parts.map((part) => [part.text, part.fans?.length])).toEqual([
      ['t', 50],
      [undefined, 50],
      [undefined, 20],
    ]);
  });

  it('the hub\'s copy reads back as it was saved: an unchanged outreach sends nothing', () => {
    const local = outreach();
    const hub = {
      outreachId: local.id,
      author: { name: 'dmitriy', isMe: true },
      createdAt: new Date(local.createdAt).toISOString(),
      updatedAt: new Date(local.updatedAt).toISOString(),
      updatedBy: { name: 'dmitriy', isMe: true },
      text: local.text,
      withMedia: false,
      settings: settingsOf(local),
      order: ['11', '12'],
      fans: local.fans.map((one) => ({ fanRef: one.fanRef, version: one.version, basis: one.basis, versionAt: null, edit: null, editedBy: null, editedAt: null, send: null, outcome: null })),
      serverNow: new Date(NOW).toISOString(),
    };
    const remote = fromHub(hub, local.owner, NOW);
    expect(remote).not.toBeNull();
    expect(patchOf(remote, local)).toBeNull();
  });

  it('takes what the window did not change since the hub\'s copy it saw, and a colleague\'s send; never undoes the window\'s own', () => {
    const base = outreach();
    const remote = outreach({ text: 'the set, part two', fans: [fan('11', { send: send({ by: 'grisha' }) }), fan('12', { version: 'a better one', basis: textKey('the set, part two') })] });
    const plan = adoptPlan(base, base, remote);
    expect(plan.text?.text).toBe('the set, part two');
    expect(plan.fans).toMatchObject([{ fanRef: '11', send: { by: 'grisha', state: 'sent' } }, { fanRef: '12', version: { text: 'a better one' } }]);
    // The window changed the text and the version itself: its word stands (its save goes next).
    const mine = outreach({ text: 'my text', fans: [fan('11'), fan('12', { version: 'my version' })] });
    const kept = adoptPlan(base, mine, remote);
    expect(kept.text).toBeNull();
    expect(kept.fans.find((one) => one.fanRef === '12')?.version).toBeUndefined();
    // A send that went here is never undone by a copy that says it may have.
    const went = outreach({ fans: [fan('11', { send: send({ reported: false }) }), fan('12')] });
    const unsure = outreach({ fans: [fan('11', { send: send({ state: 'uncertain' }) }), fan('12')] });
    expect(adoptPlan(base, went, unsure).fans.find((one) => one.fanRef === '11')?.send).toBeUndefined();
  });

  it('keeps the save the hub has not taken with what changed since, and a send this computer made that the hub has not heard of', () => {
    expect(mergeSaves({ text: 'a', fans: [{ fanRef: '11', version: 'v1', basis: 'b1', edit: 'e' }] }, { fans: [{ fanRef: '11', version: 'v2', basis: 'b2' }, { fanRef: '12', edit: null }] })).toEqual({
      text: 'a',
      fans: [{ fanRef: '11', version: 'v2', basis: 'b2', edit: 'e' }, { fanRef: '12', edit: null }],
    });
    const remote = outreach({ fans: [fan('11'), fan('12')] });
    const local = outreach({ fans: [fan('11', { send: send({ claimed: false, reported: false }) }), fan('12')] });
    expect(withLocalSends(remote, local).fans.find((one) => one.fanRef === '11')?.send?.state).toBe('sent');
    // Of one attempt, a proven refusal settles «may have gone»; of two, one that went outranks a refusal.
    expect(furtherSend(send({ state: 'uncertain', reported: false }), send({ state: 'failed', reported: false }))?.state).toBe('failed');
    expect(furtherSend(send({ state: 'failed' }), send({ state: 'uncertain', attemptId: '1b9b1b54-6f7e-4a52-9a0c-3b2f7d1e5a10' }))?.state).toBe('uncertain');
  });

  it('tells the hub how a claimed send ended, records one made without a claim, and nothing of a refused one never claimed', () => {
    expect(reportOf('11', send({ reported: false, messageId: '901' }))).toEqual({ action: 'sent', fanRef: '11', attemptId: send().attemptId, platformMessageId: '901' });
    expect(reportOf('11', send({ reported: false, state: 'uncertain', claimed: false }))).toMatchObject({ action: 'record', state: 'uncertain', text: 'hey you' });
    expect(reportOf('11', send({ reported: false, state: 'failed', claimed: false }))).toBeNull();
    expect(reportOf('11', send())).toBeNull();
  });
});
