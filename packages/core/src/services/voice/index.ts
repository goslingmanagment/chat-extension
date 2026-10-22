// Voice notes of the background (1.46.0): the shared driver of the voice
// script and the service of the chats' sessions and paid takes.
export { VOICE_SCRIPT_DRIVER, readVoiceOpView } from './script-driver';
export { VOICE_SESSIONS_KEY, VoiceService, voiceChatKey, type VoiceFailure, type VoiceHubPort, type VoicePageLookup, type VoiceServiceDeps } from './service';
