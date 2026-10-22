// The fan's newest photos on ChatSpace: a Reply, Fix or Coach start draws the photos of the fan's latest turn — their
// messages after the model's last personal one — and the request carries them only to a hub that lists
// `live-images-v1`.

import { describe, expect, it } from 'vitest';

import type { OpenChatMessage, OpenChatPage } from '@cg/contracts/host';
import { liveImageRefsOf } from '@cg/core/application/hosts/chatspace/ai';

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 22, 6, minute)).toISOString();
const photo = (id: string) => ({ mediaId: id, url: `https://pw365.ompcdn.com/cdn/v1/of/m/${id}.jpg?exp=1&sig=2` });

function msg(id: string, direction: 'fan' | 'model', minute: number, extra: Partial<OpenChatMessage> = {}): OpenChatMessage {
  return { platformMessageId: id, direction, sentAt: at(minute), text: '', price: null, isFree: true, isOpened: null, mediaCount: 0, tip: false, automatic: false, ...extra };
}

const page = (items: OpenChatMessage[]): OpenChatPage => ({ capturedAt: at(30), items, hasMore: false, cursor: null });

describe('liveImageRefsOf', () => {
  it('takes the photos of the fan\'s latest turn, past a queued message, never what the model already answered', () => {
    const refs = liveImageRefsOf(page([
      msg('906', 'fan', 6, { text: 'like it?' }),
      msg('905', 'model', 5, { automatic: true, photos: [photo('50')] }),
      msg('904', 'fan', 4, { photos: [photo('40'), photo('41')] }),
      msg('903', 'model', 3, { text: 'hey' }),
      msg('902', 'fan', 2, { photos: [photo('20')] }),
    ]));
    expect(refs.map((ref) => [ref.platformMessageId, ref.mediaId])).toEqual([['904', '40'], ['904', '41']]);
    expect(refs[0]?.sentAt).toBe(at(4));
  });

  it('keeps at most three, each media once', () => {
    const refs = liveImageRefsOf(page([
      msg('903', 'fan', 3, { photos: [photo('30'), photo('31')] }),
      msg('902', 'fan', 2, { photos: [photo('30'), photo('20'), photo('21')] }),
    ]));
    expect(refs.map((ref) => ref.mediaId)).toEqual(['30', '31', '20']);
  });
});
