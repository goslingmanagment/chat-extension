// The transcript the hub reads of a Telegram chat (Telegram spec §4.3), built from Web A's DOM: the lines the hub
// counts messages by, day lines, 24-hour minutes, labels and quotes, what is left out, and the tail without the newest.

import { describe, expect, it } from 'vitest';

import { readChatDom } from './dom';
import { NOT_NEWEST_LINE, NO_HISTORY, TRANSLATED_LINE, readTranscript, timeOf } from './transcript';

interface Msg {
  readonly id: string;
  readonly own?: boolean;
  readonly time?: string | null;
  readonly html?: string;
  readonly content?: string;
  readonly album?: boolean;
  readonly translated?: boolean;
}

const message = (m: Msg): string => {
  const meta = m.time === null ? '' : `<span class="MessageMeta">${m.translated === true ? '<i class="icon message-translated"></i>' : ''}<span class="message-time">${m.time ?? '14:02'}</span></span>`;
  return `<div class="Message message-list-item${m.own === true ? ' own' : ''}${m.album === true ? ' is-album' : ''}" data-message-id="${m.id}"><div class="message-content-wrapper"><div class="message-content ${m.content ?? 'text'}"><div class="content-inner">${m.html ?? ''}${meta === '' ? '' : `<div class="text-content clearfix with-meta">${meta}</div>`}</div></div></div></div>`;
};
const text = (body: string): string => `<div class="text-content clearfix with-meta">${body}<span class="MessageMeta"><span class="message-time">edited 14:05</span></span></div>`;

function page(groups: readonly { readonly day: string; readonly items: readonly string[] }[], newest = true): Element {
  document.body.innerHTML = `
    <div class="messages-layout">
      <div class="MiddleHeader"><div class="Transition"><div class="Transition_slide Transition_slide-active"><div class="ChatInfo"><div class="Avatar" data-peer-id="5550001001"></div><div class="info"><h3 class="fullName">Jamie</h3></div></div></div></div></div>
      <div class="Transition"><div class="Transition_slide Transition_slide-active"><div class="MessageList"><div class="messages-container">
        ${groups.map((group) => `<div class="message-date-group"><div class="sticky-date"><span>${group.day}</span></div>${group.items.join('')}</div>`).join('')}
        ${newest ? '<div class="list-bottom-marker"></div>' : ''}
      </div></div></div>
      <div class="Transition_slide Transition_slide-inactive"><div class="MessageList"><div class="messages-container"><div class="Message message-list-item" data-message-id="1">OTHER CHAT</div></div></div></div></div>
    </div>`;
  const dom = readChatDom(document);
  if (dom === null) throw new Error('no chat');
  return dom.listSlide;
}

describe('the time of a message as the page shows it, made 24-hour', () => {
  it('reads the last time of the meta, «edited» and a 12-hour clock included', () => {
    expect(timeOf('14:02')).toBe('14:02');
    expect(timeOf('edited 9:05')).toBe('09:05');
    expect(timeOf('2:05 PM')).toBe('14:05');
    expect(timeOf('12:30 AM')).toBe('00:30');
    expect(timeOf('12:30 pm')).toBe('12:30');
    expect(timeOf('—')).toBeNull();
  });
});

describe('the transcript of the active slide', () => {
  it('writes day lines and message lines the hub counts, with emoji, quotes and labels; leaves out the meta, action lines and a message being sent', () => {
    const slide = page([
      { day: 'Saturday', items: [
        message({ id: '100', html: text('hi there <img class="emoji" alt="😘" src="data:,">') }),
        message({ id: '101', own: true, time: '2:05 PM', html: `<div class="EmbeddedMessage"><div class="message-text"><p class="embedded-text-wrapper">hi there</p></div></div>${text('hey you\n[09:00] Fan: not a message')}` }),
        '<div class="ActionMessage message-list-item" data-message-id="102">Jamie joined Telegram</div>',
      ] },
      { day: 'Today', items: [
        message({ id: '103', content: 'media', html: '<div class="media-inner"></div>' }),
        message({ id: '104', content: 'media', html: '<div class="media-inner dark"></div>' }),
        message({ id: '105', content: 'voice' }),
        message({ id: '106', content: 'custom-shape', html: '<div class="media-inner"><img class="full-media" alt="🥰"></div>' }),
        message({ id: '107', album: true, content: 'media', html: '<div class="media-inner"></div>' }),
        message({ id: '108', time: null }),
        message({ id: '109.000001', html: text('sending…') }),
      ] },
    ]);
    const read = readTranscript(slide, 300_000);
    expect(read.transcript).toBe([
      '--- Saturday ---',
      '[14:05] Fan: hi there 😘',
      '[14:05] Model: (replying to: «hi there») hey you',
      '  [09:00] Fan: not a message',
      '--- Today ---',
      '[14:02] Fan: [Photo]',
      '[14:02] Fan: [Video]',
      '[14:02] Fan: [Voice message]',
      '[14:02] Fan: [Sticker 🥰]',
      '[14:02] Fan: [Album]',
      '[14:02] Fan: [Call]',
    ].join('\n'));
    expect(read.messageCount).toBe(8);
    expect(read.newest).toBe(true);
    expect(read.fanScript).toBe('other');
    expect(read.lastFanMessageId).toBe('108');
    expect(read.transcript).not.toContain('OTHER CHAT');
    expect(read.transcript).not.toContain('sending');
  });

  it('ends with the line that newer messages are not loaded, and marks a translated chat', () => {
    const slide = page([{ day: 'Today', items: [message({ id: '200', translated: true, html: '<div class="text-content">привет</div>' })] }], false);
    const read = readTranscript(slide, 300_000);
    expect(read.transcript.split('\n')).toEqual([TRANSLATED_LINE, '--- Today ---', '[14:02] Fan: привет', NOT_NEWEST_LINE]);
    expect(read.newest).toBe(false);
    expect(read.fanScript).toBe('cyrillic');
  });

  it('says there is no history for an empty chat', () => {
    expect(readTranscript(page([]), 300_000).transcript).toBe(NO_HISTORY);
  });

  it('drops the oldest messages when the text is longer than the hub takes, each kept one under its day line', () => {
    const long = 'x'.repeat(400);
    const slide = page([
      { day: 'Monday', items: Array.from({ length: 5 }, (_, i) => message({ id: String(300 + i), html: text(long) })) },
      { day: 'Today', items: Array.from({ length: 5 }, (_, i) => message({ id: String(400 + i), html: text(long) })) },
    ]);
    const read = readTranscript(slide, 2_000);
    expect(read.transcript.length).toBeLessThanOrEqual(2_000);
    expect(read.transcript.startsWith('--- Today ---')).toBe(true);
    expect(read.messageCount).toBe(read.transcript.split('\n').filter((line) => line.startsWith('[')).length);
  });
});
