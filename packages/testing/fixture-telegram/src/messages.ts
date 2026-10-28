// A chat's message list as Web A draws it (telegram-tt components/middle/MessageList*.tsx, message/Message.tsx,
// message/helpers/buildContentClassName.ts, message/ActionMessage.tsx, message/MessageMeta.tsx):
//
//   .MessageList.custom-scroll > .messages-container
//     .message-date-group > .sticky-date > span[dir=auto] «Today»
//                         > .Message.message-list-item[data-message-id] (.own, .has-reply, .was-edited, .is-album)
//                             > .message-content-wrapper > .message-content.<kind> > .content-inner > …
//                         > .ActionMessage.message-list-item[data-message-id]   (a service line)
//     .list-bottom-marker            only while the newest messages are rendered (Web A: isViewportNewest)
//
// In a chat with one person the messages sit in their date group directly (no sender groups: no avatars there).
// A message being sent has a fractional id (`3139.000001`, Web A's local id). CSS-module classes of Web A are hashed
// in its build; where the stand needs one it uses a hashed-looking name, never an anchor.

import { dayLabel, timeText } from './dates';
import { cn, h, ICONS, scenery, svgIcon } from './dom';
import { emojiPicture, renderText } from './emoji';
import { type MessageKind } from './world';

export interface ChatMessage {
  /** Web A's message id: an integer, or a fractional local id while it is being sent. */
  id: string;
  readonly own: boolean;
  readonly at: Date;
  readonly kind: MessageKind;
  /** The text, a caption, a service line's words; '' — none. */
  text: string;
  readonly reply: { readonly sender: string; readonly text: string } | null;
  edited: boolean;
  readonly alt?: string | null;
  readonly length?: string;
}

export interface ListOptions {
  readonly clock: '24h' | '12h';
  readonly now: Date;
  /** Whether the newest messages are in the viewport: the bottom marker is rendered only then. */
  readonly newest: boolean;
}

/** Media kinds Web A counts as `isMedia` (the content gets `media`). */
const MEDIA_KINDS: readonly MessageKind[] = ['photo', 'video', 'album', 'round'];

function contentClass(message: ChatMessage, lastInGroup: boolean): string {
  const media = MEDIA_KINDS.includes(message.kind);
  const custom = message.kind === 'sticker' || message.kind === 'round';
  const hasText = message.text !== '' && message.kind !== 'emoji-only' && message.kind !== 'call';
  const typeClass = message.kind === 'emoji-only' ? 'emoji-only emoji-only-1' : hasText ? 'text' : 'no-text';
  const kindClass = media ? cn('media', !custom && 'has-adaptive-width') : message.kind === 'voice' ? 'voice' : null;
  return cn(
    'message-content',
    typeClass,
    custom && 'custom-shape',
    message.kind === 'round' && 'round',
    kindClass,
    !custom && 'has-shadow',
    !custom && (hasText || !media) && 'has-solid-background',
    !custom && lastInGroup && (message.kind === 'photo' || hasText || !media) && 'has-appendix',
    hasText ? 'has-footer' : 'no-footer',
  );
}

function meta(message: ChatMessage, clock: '24h' | '12h'): HTMLElement {
  const time = `${message.edited ? 'edited ' : ''}${timeText(message.at, clock)}`;
  const sending = !Number.isInteger(Number(message.id));
  return h('span', { class: 'MessageMeta', dir: 'ltr' }, [
    h('span', { class: 'message-time' }, [time]),
    // Web A's icons are a font: no text of their own (the stand draws them in CSS), so nothing joins the time.
    message.own ? h('div', { class: 'MessageOutgoingStatus' }, [h('i', { class: `icon ${sending ? 'icon-message-pending' : 'icon-message-read'}` })]) : null,
  ]);
}

function embedded(reply: NonNullable<ChatMessage['reply']>): HTMLElement {
  return h('div', { class: 'message-subheader' }, [
    h('div', { class: 'EmbeddedMessage no-selection', dir: 'auto' }, [
      h('div', { class: 'hover-effect' }),
      h('div', { class: 'message-text' }, [
        h('p', { class: 'embedded-text-wrapper' }, renderText(reply.text)),
        h('div', { class: 'message-title' }, [h('span', { class: 'embedded-sender-wrapper' }, [h('span', { class: 'embedded-sender' }, [reply.sender])])]),
      ]),
    ]),
  ]);
}

function picture(seed: number, className = 'media-inner interactive', width = 320, height = 240): HTMLElement {
  return h('div', { class: className, style: `width: ${width}px; height: ${height}px` }, [
    h('img', { class: 'full-media', src: scenery(seed, width, height), alt: '', draggable: 'false' }),
  ]);
}

function voice(message: ChatMessage): HTMLElement {
  const bars = Array.from({ length: 34 }, (_, index) => h('span', { style: `height: ${4 + ((index * 7 + Number(message.id)) % 15)}px` }));
  return h('div', { class: cn('Audio', 'inline', message.own && 'own') }, [
    h('button', { class: 'Button toggle-play primary round', type: 'button', 'aria-label': 'Play audio' }, [svgIcon(ICONS.play, 26)]),
    h('div', { class: 'content' }, [h('div', { class: 'waveform' }, bars), h('p', { class: 'voice-duration', dir: 'auto' }, [message.length ?? '0:05'])]),
  ]);
}

/** The inside of `.content-inner` by the message's kind. */
function body(message: ChatMessage, seed: number): Node[] {
  switch (message.kind) {
    case 'photo':
      return [picture(seed)];
    case 'video':
      return [h('div', { class: 'media-inner dark interactive', style: 'width: 320px; height: 200px' }, [
        h('img', { class: 'full-media', src: scenery(seed + 1, 320, 200), alt: '', draggable: 'false' }),
        h('div', { class: 'message-media-duration' }, [message.length ?? '0:10']),
        h('button', { class: 'stand-play', type: 'button', 'aria-label': 'Play' }, [svgIcon(ICONS.play, 30)]),
      ])];
    case 'album':
      return [h('div', { class: 'Album', style: 'width: 320px' }, [0, 1, 2].map((index) => h('div', { class: 'album-item-select-wrapper' }, [picture(seed + index, 'media-inner interactive', index === 0 ? 320 : 159, index === 0 ? 180 : 120)])))];
    case 'voice':
      return [voice(message)];
    case 'sticker':
      return [h('div', { class: 'media-inner', style: 'width: 160px; height: 160px' }, [
        h('img', { class: 'full-media', src: emojiPicture(message.alt ?? '🐻', 160), ...(message.alt === null || message.alt === undefined ? {} : { alt: message.alt }), draggable: 'false' }),
      ])];
    case 'round':
      return [h('div', { class: 'RoundVideo' }, [
        h('div', { class: 'thumbnail-wrapper' }, [h('img', { class: 'thumbnail', src: scenery(seed + 2, 240, 240), alt: '', draggable: 'false' })]),
        h('div', { class: 'message-media-duration' }, [message.length ?? '0:05']),
      ])];
    case 'emoji-only': {
      // An animated emoji: a canvas of the sticker player, no text and no alt anywhere.
      const canvas = h('canvas', { width: '224', height: '224', style: 'width: 112px; height: 112px' });
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.font = '170px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('❤️', 112, 124);
      }
      return [h('div', { class: 'AnimatedEmoji media-inner', style: 'width: 112px; height: 112px' }, [canvas])];
    }
    case 'call':
      // MessagePhoneCall: CSS-module classes only (hashed in Web A's build), and no `.MessageMeta` at all.
      return [h('div', { class: 'qQ8bYjHn' }, [
        h('button', { class: 'Button default translucent round', type: 'button', 'aria-label': 'Call' }, [svgIcon(ICONS.phone, 22)]),
        h('div', { class: 'Z3pXcO2s' }, [
          h('div', { class: 'Wm2JtD0r' }, [message.text]),
          h('div', { class: 'eM0fVb6c' }, [svgIcon(ICONS.callIn, 14, 'stand-svg call-arrow'), h('span', {}, [`${timeText(message.at, '24h')}, ${message.length ?? ''}`])]),
        ]),
      ])];
    case 'text':
    case 'action':
      return [];
  }
}

export function renderMessage(message: ChatMessage, clock: '24h' | '12h', place: { readonly first: boolean; readonly last: boolean }): HTMLElement {
  if (message.kind === 'action') {
    return h('div', { class: 'ActionMessage message-list-item UkP9nrAm', id: `message-${message.id}`, 'data-message-id': message.id }, [
      h('span', { class: 'Bt4JbLv1', dir: 'auto' }, renderText(message.text)),
    ]);
  }
  const seed = Number.parseInt(message.id, 10);
  const hasText = message.text !== '' && message.kind !== 'emoji-only' && message.kind !== 'call';
  const inner = h('div', { class: 'content-inner', dir: 'auto' }, [message.reply === null ? null : embedded(message.reply), ...body(message, seed)]);
  // Meta in the text when there is text; standalone after the content otherwise; none for a call.
  if (hasText) inner.append(h('div', { class: 'text-content clearfix with-meta', dir: 'auto' }, [...renderText(message.text), meta(message, clock)]));
  const content = h('div', { class: contentClass(message, place.last), dir: 'auto' }, [inner, !hasText && message.kind !== 'call' ? meta(message, clock) : null]);
  return h(
    'div',
    {
      class: cn(
        'Message message-list-item',
        place.first && 'first-in-group',
        'allow-selection',
        place.last && 'last-in-group',
        message.own && 'own',
        message.edited && 'was-edited',
        message.reply !== null && 'has-reply',
        message.kind === 'album' && 'is-album',
      ),
      id: `message-${message.id}`,
      'data-message-id': message.id,
    },
    [
      h('div', { class: 'bottom-marker', 'data-message-id': message.id }),
      h('div', { class: 'message-select-control no-selection' }),
      h('div', { class: cn('message-content-wrapper', hasText && 'can-select-text') }, [content]),
    ],
  );
}

/** The `.messages-container` of these messages (oldest first), by date groups; the marker only at the newest. */
export function renderContainer(messages: readonly ChatMessage[], options: ListOptions): HTMLElement {
  const container = h('div', { class: 'messages-container' }, [h('div', { class: 'backwards-trigger' })]);
  let group: HTMLElement | null = null;
  let label = '';
  messages.forEach((message, index) => {
    const day = dayLabel(message.at, options.now);
    if (group === null || day !== label) {
      label = day;
      group = h('div', { class: cn('message-date-group', container.querySelector('.message-date-group') === null && 'first-message-date-group') }, [
        h('div', { class: 'sticky-date interactive' }, [h('span', { dir: 'auto' }, [day])]),
      ]);
      container.append(group);
    }
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const sameDay = (other: ChatMessage | undefined): boolean => other !== undefined && dayLabel(other.at, options.now) === day;
    const first = previous === undefined || previous.own !== message.own || previous.kind === 'action' || !sameDay(previous);
    const last = next === undefined || next.own !== message.own || next.kind === 'action' || !sameDay(next);
    group.append(renderMessage(message, options.clock, { first, last }));
  });
  container.append(h('div', { class: 'forwards-trigger' }), h('div', { class: 'fab-trigger' }));
  if (options.newest) container.append(h('div', { class: 'list-bottom-marker' }));
  return container;
}
