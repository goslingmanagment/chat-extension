// The future voice panel's application port. It neither renders UI nor starts
// a paid attempt; the strict start contains a group and a fan separately.
import { VoiceScriptStartSchema } from '@cg/contracts/ops-fansly';
import type { VoiceScriptStart, SiteOpView, Admission, OpState } from '@cg/contracts/ops';


export interface VoiceScriptPort {
  start(input: VoiceScriptStart): Promise<Admission>;
  read(opId: string): Promise<SiteOpView | null>;
  cancel(opId: string): Promise<OpState | null>;
}

export function createVoiceScript(port: VoiceScriptPort): VoiceScriptPort {
  return { ...port, start: (input) => port.start(VoiceScriptStartSchema.parse(input)) };
}

/** Streaming text is preview only; the paid step must use this completed script and its source. */
export function voiceScriptResult(view: SiteOpView | null): { readonly script: string; readonly generationRef: string } | null {
  return view?.feature === 'voice-script' && view.state === 'done' && view.result?.kind === 'voice-script' && view.generationRef !== undefined
    ? { script: view.result.script, generationRef: view.generationRef } : null;
}
