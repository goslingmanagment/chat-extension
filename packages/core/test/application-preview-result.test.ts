// The error buttons of a preview's result card follow the dock's rules (ui-design §4.8): a «Повторить» that waits for
// a deadline says «через N с» and the card turns it on at it (final-7c); the day's quota offers no «Повторить» and no
// «Настройки» (final-7a).

import { describe, expect, it } from 'vitest';

import { type CgErrorWire } from '@cg/contracts/errors';
import { type OpView } from '@cg/contracts/ops';
import { reason } from '@cg/core/application/boards';
import { previewResult, type PreviewResultInput } from '@cg/core/application/preview';
import { createI18n } from '@cg/core/domain/i18n';
import { type OpMirror } from '@cg/core/domain/ops';

import { NOW_MS, target, uuid } from './support/world';

const OP = uuid(0x100);

function failed(error: CgErrorWire, regenerate: PreviewResultInput['regenerate'] = { allowed: true, reason: null }) {
  const view: OpView = { opId: OP, feature: 'reply', surface: 'preview', target, state: 'failed', phase: { name: 'settled', since: NOW_MS }, startedAt: NOW_MS - 5_000, endedAt: NOW_MS, toneUsed: null, error };
  const mirror: OpMirror = { opId: OP, seq: 1, state: 'failed', phase: view.phase, text: '', firstChunkAt: null, done: view };
  return previewResult({
    mirror,
    feature: 'reply',
    surface: 'preview',
    startedAt: view.startedAt,
    now: NOW_MS,
    targetName: null,
    toneUsed: null,
    splitRequested: false,
    expanded: false,
    cachedAt: null,
    fixSource: null,
    unusable: false,
    i18n: createI18n({ language: 'ru', now: () => NOW_MS, timeZone: 'Europe/Moscow' }),
    rows: () => ({ order: null, openInsert: { s: 'hidden' } }),
    copy: () => 'idle',
    progress: null,
    sendStarted: false,
    regenerate,
  }).errorActions;
}

describe('the error buttons of a preview result', () => {
  it('a rate limit waits «через N с» for its deadline, as the dock\'s does; what holds the result stays off with its own reason', () => {
    const limited: CgErrorWire = { code: 'CG-PROVIDER-RATE-LIMIT', retryAt: NOW_MS + 20_000 };
    expect(failed(limited)).toEqual([expect.objectContaining({ action: { type: 'Regenerate', operationId: OP }, enabled: false, reason: { id: 'wait-until', code: null, text: { key: 'cg.retryIn', params: { n: 20 } } } })]);
    const sending = reason('parts-sending');
    expect(failed(limited, { allowed: false, reason: sending })).toEqual([expect.objectContaining({ enabled: false, reason: sending })]);
  });

  it.each(['CG-AI-LIMIT', 'CG-QUOTA-DAILY'] as const)('%s offers no «Повторить» and no «Настройки»: the card counts down and copies the code', (code) => {
    expect(failed({ code, retryAt: NOW_MS + 3 * 3_600_000 })).toEqual([]);
  });
});
