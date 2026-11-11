// The words of the chat's length in Fansly's chat header (2026-11-08; contracts chat-length.ts). Since 2026-11-11 the
// words of both sites are one catalog's (domain/chat-length/texts.ts, the owner of ChatSpace: «там же все то же самое
// нужно»); Fansly's own is the day its hub began to record who wrote each message, 24 October 2026.
import { chatLengthTexts } from '../../../chat-length/texts';

export const CHAT_LENGTH_TEXTS = chatLengthTexts({ ru: '24 октября 2026', en: 'October 24, 2026' });
