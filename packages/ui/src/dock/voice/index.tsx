// @cg/ui/dock/voice — the voice studio of the dock's sheet (1.47.0), a lazy
// part of the dock: the script, the takes with their player, the handover
// into the chat's field. Loaded the first time the person opens Voice.

import { type LazyPart, type VoiceProps } from '../lazy-part';
import { VoiceStudio } from './Studio';
import { VOICE_STYLE } from './styles';

export const voicePart: LazyPart<VoiceProps> = { view: VoiceStudio, styles: [VOICE_STYLE] };

export { VoiceStudio } from './Studio';
export { VOICE_CSS, VOICE_STYLE } from './styles';
