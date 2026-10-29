import { describe, expect, it } from 'vitest';

import { HubStreamRequestSchema, type HubStreamRequest } from '../src/hub/ai';

const telegramReply: HubStreamRequest = {
  feature: 'fast-reply',
  body: {
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    pageLabel: 'model-tg',
    platform: 'telegram',
    conversationRef: '2002',
    fanRef: '2002',
    clientContext: {
      transcript: 'Fan: Tell me about your new set.',
      messageCount: 1,
      fanDisplayName: 'Jamie',
      transcriptCoverage: 'window',
    },
  },
  capabilities: [],
};

describe('Telegram AI request schema', () => {
  it.each(['none', 'casual', 'flirty', 'upsell', 'spicy'] as const)('accepts Reply with the %s tone and the open chat context', (replyTone) => {
    const request = { ...telegramReply, body: { ...telegramReply.body, replyTone } };
    expect(HubStreamRequestSchema.safeParse(request)).toEqual({ success: true, data: request });
  });

  it('accepts a normal Fix but still refuses an outreach Fix, as the hub does', () => {
    const request: HubStreamRequest = {
      ...telegramReply,
      feature: 'improve-draft',
      body: { ...telegramReply.body, draftText: 'Want to see my new set?' },
    };
    expect(HubStreamRequestSchema.safeParse(request).success).toBe(true);
    expect(HubStreamRequestSchema.safeParse({ ...request, body: { ...request.body, draftPurpose: 'outreach' } }).success).toBe(false);
  });

  it.each([
    { clientContext: undefined },
    { fanRef: undefined },
    { fanRef: null },
  ])('still requires the chat context and fan for a selling Reply: %j', (missing) => {
    expect(HubStreamRequestSchema.safeParse({
      ...telegramReply,
      body: { ...telegramReply.body, replyTone: 'upsell', ...missing },
    }).success).toBe(false);
  });
});
