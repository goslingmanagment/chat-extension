// The audio of the fake hub's voice notes: three takes of its synthetic voice
// script (ai.ts, «[warmly] Hey you, it is lovely to hear from you.»), spoken by
// macOS `say` in one voice at three paces, so takes that follow one another
// sound and look different (the studio draws each take's waveform). Made once
// and kept as files in ./audio:
//
//   say -v Samantha -r 135 -o take-1.aiff "Hey you, [[slnc 300]] it is lovely to hear from you. [[slnc 150]]"
//   say -v Samantha -r 120 -o take-2.aiff "[[pbas -2]] Hey you... [[slnc 550]] it is lovely to hear from you. [[slnc 150]]"
//   say -v Samantha -r 160 -o take-3.aiff "[[pbas +2]] Hey, you! [[slnc 400]] It is lovely [[slnc 180]] to hear from you. [[slnc 150]]"
//   ffmpeg -i take-N.aiff -ac 1 -ar 22050 -b:a 48k -map_metadata -1 -fflags +bitexact -flags:a +bitexact take-N.mp3
//
// Mono MP3, 22.05 kHz, 48 kbit/s, 2.9–3.5 s and 17–22 KB each: what the hub's
// audio route serves (`audio/mpeg`). Read on first use, in Node only (the fake
// hub never runs in a page).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface VoiceAudioSample {
  /** The file's name in ./audio. */
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** Lower-case hex, as the hub reports it (`audioSha256`). */
  readonly sha256: string;
}

let samples: readonly VoiceAudioSample[] | null = null;

const sample = (name: string, url: URL): VoiceAudioSample => {
  const bytes = new Uint8Array(readFileSync(url));
  return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
};

/** The three takes, in order: the n-th render of the lane speaks take n (round robin). */
export function voiceAudioSamples(): readonly VoiceAudioSample[] {
  samples ??= [
    sample('take-1.mp3', new URL('./audio/take-1.mp3', import.meta.url)),
    sample('take-2.mp3', new URL('./audio/take-2.mp3', import.meta.url)),
    sample('take-3.mp3', new URL('./audio/take-3.mp3', import.meta.url)),
  ];
  return samples;
}
