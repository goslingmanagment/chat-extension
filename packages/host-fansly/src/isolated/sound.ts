// What a Fansly tab heard for the sound (R20 P14a; docs/project-unite/
// architecture.md §8.12, §10.3; FS-SND-1): MAIN's new messages (`fx.incoming`,
// ours too) and new subscribers (`fx.follow`), gathered per batch of its
// stream and said as ONE report — never a request per fact — with the
// creator the batch came under. The tab decides nothing about the sound: the
// background's one arbiter does, for every tab and site.
//
// A report waits for its reader only a little: the tab's port to the
// background comes one task after document_start, and what the page heard
// before it — a few batches at most — goes to it then; beyond that the oldest
// go (a sound is news only for 180 s anyway). A batch under no known creator
// (before `/account/me`) says nothing: none of its messages is a fan's, and
// its follows have no account of this tab to ring for.

import type { FromMainFansly } from '@cg/contracts/bridge-messages-fansly';
import type { Unsubscribe } from '@cg/contracts/host';
import type { FanslySoundFacts, FanslySoundFollow, FanslySoundMessage } from '@cg/contracts/tab-messages-fansly';

/** Reports kept for the first reader; the oldest go beyond it. */
export const SOUND_REPORTS_WAITING = 8;

/** The sound's facts of Fansly's page, as the tab reports them to the background. */
export interface FanslySoundSource {
  /** One report per batch of MAIN that carried a message or a follow; what came before the first reader is handed to it. */
  onReport(cb: (facts: FanslySoundFacts) => void): Unsubscribe;
}

export interface FanslySoundCollector extends FanslySoundSource {
  /** A fact of the batch now being read. */
  take(event: Extract<FromMainFansly, { readonly t: 'fx.incoming' | 'fx.follow' }>): void;
  /** The batch was read whole: its facts go as one report. */
  end(): void;
  dispose(): void;
}

export function createSoundCollector(creator: () => string | null): FanslySoundCollector {
  let messages: FanslySoundMessage[] = [];
  let follows: FanslySoundFollow[] = [];
  const waiting: FanslySoundFacts[] = [];
  const readers = new Set<(facts: FanslySoundFacts) => void>();
  let disposed = false;

  return {
    take(event) {
      if (disposed) return;
      if (event.t === 'fx.incoming') messages.push(event.p);
      else follows.push(event.p);
    },
    end() {
      if (messages.length + follows.length === 0) return;
      const creatorId = creator();
      const taken = { messages, follows };
      messages = [];
      follows = [];
      if (disposed || creatorId === null) return;
      const facts: FanslySoundFacts = { creatorId, ...taken };
      if (readers.size === 0) {
        waiting.push(facts);
        if (waiting.length > SOUND_REPORTS_WAITING) waiting.shift();
        return;
      }
      for (const reader of [...readers]) reader(facts);
    },
    onReport(cb) {
      readers.add(cb);
      if (waiting.length > 0) {
        const early = waiting.splice(0);
        queueMicrotask(() => {
          if (readers.has(cb)) for (const facts of early) cb(facts);
        });
      }
      return () => {
        readers.delete(cb);
      };
    },
    dispose() {
      disposed = true;
      messages = [];
      follows = [];
      waiting.length = 0;
      readers.clear();
    },
  };
}
