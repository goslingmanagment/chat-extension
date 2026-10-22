// The Recap and voice controllers over the tab's AI workspace (R11, 1.47.0):
// the views `recap.picker`, `recap.view` and `voice`. Review is a turn of
// Coach's dialog since 1.51.0 (`ai-coach`).
// Loaded right after the dock is on screen.

export { createRecapController, type RecapController } from '@cg/core/application/ai';
export { createVoiceController } from '@cg/core/application/voice';
