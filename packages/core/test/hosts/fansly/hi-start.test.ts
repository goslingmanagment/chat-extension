// Hi without the tab's proof of the start (a cold load, a new socket): the background reads the history to its empty
// page and proves the start as the pass does; more than ten personal messages among the newest 30 is a dialog.

import { describe, expect, it } from 'vitest';

import { HI_START_PAGES, readHiStart, type HiStartPort } from '../../../src/services/hosts/fansly/hi-start';

const CREATOR = '700000000000000017';
const FAN = '920000000000000003';
const GROUP = '810000000000000053';
const NOW = Date.parse('2026-10-20T12:00:00Z');

/** Messages oldest first; `fan` — the fan's, else the creator's personal ones. */
function history(sides: readonly ('fan' | 'model')[]): Record<string, unknown>[] {
  return sides.map((side, index) => ({ id: String(830000000000000000n + BigInt(index + 1)), groupId: GROUP, senderId: side === 'fan' ? FAN : CREATOR, type: 1, correlationId: '0', inReplyTo: null, createdAt: 1_791_000_000 + index, content: `m${index + 1}`, attachments: [] }));
}

/** Fansly's `GET /message`: pages of 25, newest first, `before` an id. */
function port(messages: readonly Record<string, unknown>[], calls: string[] = []): HiStartPort {
  return {
    automated: () => Promise.resolve([]),
    history(query) {
      calls.push(query['before'] ?? 'fresh');
      const before = query['before'];
      const older = before === undefined ? messages : messages.filter((m) => BigInt(m['id'] as string) < BigInt(before));
      return Promise.resolve({ messages: older.slice(-25).reverse() });
    },
  };
}

const chat = { creatorId: CREATOR, fanId: FAN, groupId: GROUP };

describe('readHiStart', () => {
  it('a short chat: read to the empty page, the start proven from its first message', async () => {
    const messages = history(['fan', 'model', 'fan', 'model', 'fan']);
    const calls: string[] = [];
    const read = await readHiStart(port(messages, calls), chat, NOW);
    expect(calls).toEqual(['fresh', messages[0]?.['id']]);
    expect(read).toEqual({ kind: 'proof', proof: expect.objectContaining({ source: 'pass-empty-page', groupId: GROUP, startWitnessId: messages[0]?.['id'], coveredCount: 5, personalCount: 5 }) });
  });

  it('more than ten personal messages: a dialog, without walking further', async () => {
    const calls: string[] = [];
    const read = await readHiStart(port(history(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'fan' : 'model'))), calls), chat, NOW);
    expect(read).toEqual({ kind: 'dialog' });
    expect(calls).toHaveLength(1);
  });

  it('a long chat the walk does not get to the start of: unproven, never a proof', async () => {
    // Automated messages (type 2) count for nobody: the walk goes on to its page limit.
    const automated = Array.from({ length: 25 * HI_START_PAGES + 5 }, (_, index) => ({ ...history(['model'])[0], id: String(830000000000000000n + BigInt(index + 1)), type: 2 }));
    expect(await readHiStart(port(automated), chat, NOW)).toEqual({ kind: 'unproven' });
  });

  it('a page of another chat proves nothing', async () => {
    const stranger = history(['fan']).map((m) => ({ ...m, senderId: '920000000000000099' }));
    expect(await readHiStart(port(stranger), chat, NOW)).toEqual({ kind: 'unproven' });
  });
});
